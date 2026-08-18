/**
 * JumpServer 堡垒机 API 对接。
 *
 * 参考 SailFish 的 bastion.service.ts 实现，并补充连接令牌
 * （connection-token）API 以获取直连参数：
 *
 * 1. 认证：POST /api/v1/authentication/auth/ {username,password} → token
 *    （也支持直接配置 API Token 作为 Bearer）
 * 2. 资产：GET /api/v1/perms/users/assets/（回退 /api/v1/perms/users/self/assets/）
 *    分页拉取，兼容 v2/v3/v4 字段
 * 3. 连接参数：POST /api/v1/authentication/connection-token/?asset=<id>[&account=<name>]
 *    → GET /api/v1/authentication/connection-token/<id>/ → connect_params
 *    （host/port/protocol/username/password/private_key）
 *
 * @module @sailfish/dsh-device/jumpserver
 */

import https from 'node:https'
import http from 'node:http'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const TIMEOUT_MS = 20000

/**
 * JumpServer 客户端。
 * @param {object} config - { url, username, password, token, rejectUnauthorized, defaultAccount }
 */
export class JumpServerClient {
  constructor(config) {
    this.url = (config.url || '').trim().replace(/\/+$/, '')
    this.username = config.username || ''
    this.password = config.password || ''
    this.token = config.token || ''
    this.rejectUnauthorized = config.rejectUnauthorized !== false
    this.defaultAccount = config.defaultAccount || ''
    this.assetsApiPath = ''
    this.authToken = ''
    this.tokenFailed = false
  }

  get configured() {
    return this.url !== ''
  }

  get hostname() {
    try {
      if (!this.url.startsWith('http://') && !this.url.startsWith('https://')) return ''
      return new URL(this.url).hostname
    } catch {
      return ''
    }
  }

  static validateUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '')
    if (!trimmed) throw new Error('JumpServer 地址不能为空')
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new Error('JumpServer 地址必须以 http:// 或 https:// 开头（例如 http://192.168.1.100:8080）')
    }
    try {
      new URL(trimmed)
    } catch {
      throw new Error('JumpServer 地址格式无效，请检查是否填写正确')
    }
    return trimmed
  }

  #request(method, path, body, retriedAfterTokenFailure = false) {
    return new Promise((resolve, reject) => {
      if (!this.url) return reject(new Error('JumpServer 地址未配置'))
      if (!this.url.startsWith('http://') && !this.url.startsWith('https://')) {
        return reject(new Error('JumpServer 地址必须以 http:// 或 https:// 开头（例如 http://192.168.1.100:8080）'))
      }
      let target
      try {
        target = new URL(path, this.url.endsWith('/') ? this.url : `${this.url}/`)
      } catch (err) {
        return reject(new Error(`JumpServer 地址格式无效：${err?.message || err}`))
      }
      const lib = target.protocol === 'https:' ? https : http
      const payload = body === undefined ? null : JSON.stringify(body)
      // 本次请求是否携带了复用的 Harness Key（只有这种情况才允许回退重试）
      const usingHarnessKey = Boolean(this.authToken && this.authToken === this.token && this.token)
      const headers = {
        Accept: 'application/json',
        'User-Agent': UA,
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      }
      const req = lib.request({
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        rejectUnauthorized: this.rejectUnauthorized,
        timeout: TIMEOUT_MS,
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data
          try {
            data = text ? JSON.parse(text) : {}
          } catch {
            return reject(new Error(`HTTP ${res.statusCode}：响应不是 JSON`))
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data)
          // 复用的 Harness Key 被堡垒机拒绝（401）时：改走账号密码登录后重试一次
          if (res.statusCode === 401
            && !retriedAfterTokenFailure
            && usingHarnessKey
            && !this.tokenFailed
            && this.username
            && this.password) {
            this.tokenFailed = true
            this.authToken = ''
            // 先完成密码认证，再重放原请求
            this.authenticate().then(
              () => resolve(this.#request(method, path, body, true)),
              (error) => reject(error),
            )
            return
          }
          const detailMsg = data?.detail || data?.message || data?.msg || (data && typeof data === 'object' ? JSON.stringify(data) : '')
          const errSuffix = detailMsg && detailMsg !== '{}' ? `：${detailMsg}` : ''
          reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage} [${method} ${target.pathname}]${errSuffix}`))
        })
      })
      req.on('timeout', () => req.destroy(new Error('连接超时')))
      req.on('error', (error) => reject(error))
      if (payload !== null) req.write(payload)
      req.end()
    })
  }

  /** 认证：优先复用 Harness API Key（Bearer），被拒或未配置时账号密码登录。 */
  async authenticate() {
    if (this.authToken) return this.authToken
    if (this.token && !this.tokenFailed) {
      this.authToken = this.token
      return this.authToken
    }
    if (!this.username || !this.password) {
      throw new Error('JumpServer 认证失败：未配置用户名/密码（复用的 API Key 不可用）')
    }
    const data = await this.#request('POST', '/api/v1/authentication/auth/', {
      username: this.username,
      password: this.password,
    })
    if (!data.token) throw new Error('认证失败：未返回 token（可能需要 MFA 或账号密码错误）')
    this.authToken = data.token
    return data.token
  }

  /** 注入外部解析的 API Token（Harness 的 DEEPSEEK_API_KEY）。 */
  setToken(token) {
    this.token = token || ''
  }

  /**
   * 获取堡垒机自身的 SSH 跳板机/网关连接配置（通过堡垒机作为网络入口中转连接私网资产）。
   * @param {number} [sshPort=2222]
   * @returns {{host: string, port: number, username: string, password?: string}|null}
   */
  getJumpHostConfig(sshPort = 2222) {
    if (!this.url) return null
    try {
      const parsed = new URL(this.url)
      if (!parsed.hostname) return null
      return {
        host: parsed.hostname,
        port: Number(sshPort) || 2222,
        username: this.username || '',
        ...(this.password ? { password: this.password } : {}),
      }
    } catch {
      return null
    }
  }

  /**
   * 拉取一个资产可用的登录账号列表。
   * 依次尝试 JumpServer 各版本（v4/v3/v2，含当前用户 perms 接口与 assets 接口）的候选端点；
   * 全部不可用返回空数组（调用方回退到 defaultAccount / connection-token 自动选择）。
   * @returns {Promise<{id?: string, name: string, username: string}[]>}
   */
  async accounts(assetId) {
    await this.authenticate()
    const candidates = [
      `/api/v1/perms/users/assets/${encodeURIComponent(assetId)}/accounts/`,
      `/api/v1/perms/users/self/assets/${encodeURIComponent(assetId)}/accounts/`,
      `/api/v1/perms/users/assets/${encodeURIComponent(assetId)}/system-users/`,
      `/api/v1/perms/users/self/assets/${encodeURIComponent(assetId)}/system-users/`,
      `/api/v1/assets/assets/${encodeURIComponent(assetId)}/accounts/`,
      `/api/v1/assets/assets/${encodeURIComponent(assetId)}/system-users/`,
      `/api/v1/assets/accounts/?asset_id=${encodeURIComponent(assetId)}&limit=100`,
      `/api/v1/assets/system-users/?asset_id=${encodeURIComponent(assetId)}&limit=100`,
    ]
    for (const path of candidates) {
      try {
        const data = await this.#request('GET', path)
        const rows = data?.results ?? data
        if (!Array.isArray(rows) || rows.length === 0) continue
        const accounts = rows
          .map((row) => {
            if (typeof row === 'string') return { id: row, name: row, username: row }
            const name = String(row.name || row.username || row.alias || row.id || '')
            const username = String(row.username || row.name || '')
            const id = String(row.id || name)
            return { id, name, username }
          })
          .filter((row) => row.name)
        if (accounts.length > 0) return accounts
      } catch {
        // 端点不存在（404）或无权限（403）等 → 尝试下一个
      }
    }
    return []
  }

  /** 测试连接：认证 + 拉取第一页资产。 */
  async test() {
    const token = await this.authenticate()
    const firstPage = await this.#fetchAssetsPage(10, 0)
    return {
      ok: true,
      message: `连接成功（当前可见资产 ${firstPage.count ?? '?'} 个）`,
      token,
    }
  }

  async #fetchAssetsPage(limit, offset) {
    const qs = `?limit=${limit}&offset=${offset}`
    if (this.assetsApiPath) {
      return this.#request('GET', `${this.assetsApiPath}${qs}`)
    }
    const candidates = ['/api/v1/perms/users/assets/', '/api/v1/perms/users/self/assets/']
    let lastError
    for (const path of candidates) {
      try {
        const result = await this.#request('GET', `${path}${qs}`)
        this.assetsApiPath = path
        return result
      } catch (error) {
        lastError = error
        if (!error.message.includes('404')) throw error
      }
    }
    throw lastError
  }

  /** 拉取全部资产（分页，上限 100 页）。 */
  async fetchAllAssets() {
    const pageSize = 100
    const all = []
    let offset = 0
    for (let page = 0; page < 100; page++) {
      const resp = await this.#fetchAssetsPage(pageSize, offset)
      if (!resp.results?.length) break
      all.push(...resp.results)
      if (resp.count !== undefined && all.length >= resp.count) break
      if (resp.results.length < pageSize) break
      offset += pageSize
    }
    return all
  }

  /** 把 JumpServer 资产规范化为内部结构。 */
  normalizeAsset(asset) {
    const protocols = []
    if (Array.isArray(asset.protocols)) {
      for (const p of asset.protocols) {
        if (typeof p === 'string') {
          const [name, port] = p.split('/')
          protocols.push({ name, port: parseInt(port) || 22 })
        } else if (p && typeof p === 'object' && p.name) {
          protocols.push({ name: p.name, port: p.port || 22 })
        }
      }
    } else if (asset.protocol) {
      protocols.push({ name: asset.protocol, port: asset.port || 22 })
    }

    // 提取资产随接口下发的所有可用账号信息
    const accounts = []
    const rawAccounts = asset.accounts || asset.system_users || asset.systemUsers || asset.all_accounts || []
    if (Array.isArray(rawAccounts)) {
      for (const a of rawAccounts) {
        if (typeof a === 'string') accounts.push({ id: a, name: a, username: a })
        else if (a && typeof a === 'object') {
          const name = String(a.name || a.username || a.alias || a.id || '')
          const username = String(a.username || a.name || '')
          const id = String(a.id || name)
          if (name) accounts.push({ id, name, username })
        }
      }
    }

    return {
      id: String(asset.id),
      name: asset.name || asset.hostname || asset.address || asset.ip || String(asset.id),
      address: asset.address || asset.ip || asset.hostname || '',
      protocols,
      accounts,
      platform: typeof asset.platform === 'object' ? asset.platform?.name : asset.platform,
      comment: asset.comment || '',
      orgName: asset.org_name || '',
      isActive: asset.is_active !== false,
    }
  }

  /** 同步资产：认证 + 拉全量 + 规范化。 */
  async syncAssets() {
    await this.authenticate()
    const assets = await this.fetchAllAssets()
    return assets.map((asset) => this.normalizeAsset(asset)).filter((asset) => asset.isActive)
  }

  /**
   * 通过 connection-token API 获取资产的直连参数。
   * 优先使用指定的 accountName 或配置的 defaultAccount；
   * 必须在 POST body 与 URL query 中同时传递参数，兼容各类 JumpServer 版本。
   * @returns {Promise<{host, port, protocol, username, password?, privateKey?}>}
   */
  async connectParams(assetId, accountName) {
    await this.authenticate()
    const foundAccounts = await this.accounts(assetId).catch(() => [])

    // 组装所有可能的候选账号标识（按优先级尝试）
    const candidateAccounts = []
    if (accountName) candidateAccounts.push(accountName)
    if (this.defaultAccount) candidateAccounts.push(this.defaultAccount)
    for (const a of foundAccounts) {
      if (a.id && !candidateAccounts.includes(a.id)) candidateAccounts.push(a.id)
      if (a.name && !candidateAccounts.includes(a.name)) candidateAccounts.push(a.name)
      if (a.username && !candidateAccounts.includes(a.username)) candidateAccounts.push(a.username)
    }
    // 通用回退候选（当前配置用户名及标准系统管理员）
    const fallbackCommon = [this.username, 'root', 'admin'].filter(Boolean)
    for (const fb of fallbackCommon) {
      if (!candidateAccounts.includes(fb)) candidateAccounts.push(fb)
    }
    if (!candidateAccounts.includes(undefined)) candidateAccounts.push(undefined)

    let lastError
    for (const account of candidateAccounts) {
      // 针对每个账号尝试不同的参数字段名称
      const payloadVariations = account !== undefined
        ? [
          { qs: `?asset=${encodeURIComponent(assetId)}&account=${encodeURIComponent(account)}`, body: { asset: String(assetId), account: String(account) } },
          { qs: `?asset=${encodeURIComponent(assetId)}&system_user=${encodeURIComponent(account)}`, body: { asset: String(assetId), system_user: String(account) } },
          { qs: `?asset=${encodeURIComponent(assetId)}&account_id=${encodeURIComponent(account)}`, body: { asset: String(assetId), account_id: String(account) } },
        ]
        : [
          { qs: `?asset=${encodeURIComponent(assetId)}`, body: { asset: String(assetId) } },
        ]

      for (const variation of payloadVariations) {
        try {
          const created = await this.#request('POST', `/api/v1/authentication/connection-token/${variation.qs}`, variation.body)
          const id = created?.id ?? created?.token ?? created?.key
          if (!id) throw new Error('connection-token 响应缺少 id')
          const detail = await this.#request('GET', `/api/v1/authentication/connection-token/${encodeURIComponent(id)}/`)
          const params = detail?.connect_params ?? detail?.connectParams ?? detail?.data?.connect_params ?? {}
          if (!params || !params.host) throw new Error('connection-token 响应缺少连接参数')
          return {
            host: params.host,
            port: params.port || 22,
            protocol: (params.protocol || 'ssh').toLowerCase(),
            username: params.username || '',
            ...(params.password !== undefined ? { password: params.password } : {}),
            ...(params.private_key !== undefined && params.private_key !== '' ? { privateKey: params.private_key } : {}),
          }
        } catch (error) {
          lastError = error
        }
      }
    }
    throw new Error(`获取资产连接参数失败：${lastError?.message || '未知错误'}（可尝试在堡垒机配置里填写默认账号，或在多账号弹窗中选择具体登录账号）`)
  }

  /** 错误信息人性化。 */
  static formatError(error) {
    const message = error?.message || String(error)
    if (/Invalid URL|ERR_INVALID_URL/i.test(message)) {
      return 'JumpServer 地址格式无效，必须以 http:// 或 https:// 开头（例如 http://192.168.1.100:8080）'
    }
    if (/必须以 http:\/\/ 或 https:\/\//.test(message)) return message
    if (/连接超时/.test(message)) return '连接 JumpServer 超时'
    if (/ECONNREFUSED/.test(message)) return '连接被拒绝，请检查堡垒机地址与端口'
    if (/ENOTFOUND|EAI_AGAIN/.test(message)) return 'DNS 解析失败，请检查堡垒机地址'
    if (/self-signed|certificate/i.test(message)) return 'SSL 证书验证失败（自签名证书可关闭「校验 SSL 证书」）'
    if (/401/.test(message)) return '认证失败，请检查用户名和密码'
    if (/403/.test(message)) return '权限不足'
    if (/404/.test(message)) return 'API 路径不存在（404），请检查 JumpServer 地址与版本'
    return message
  }
}
