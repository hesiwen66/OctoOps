/**
 * 设备仓库：手动添加的设备持久化在 DSH 存储（storage KV，json 后端，
 * $DSH_HOME/storages/device_store.json），内存缓存 + 串行写链。
 *
 * @module @sailfish/dsh-device/repo
 */

import { randomUUID } from 'node:crypto'
import { SecretStore } from './secrets.js'

export const UNIT_NAME = 'device_store'
export const TABLE = 'devices'
export const HISTORY_TABLE = 'history'
export const ENV_TABLE = 'env'
export const BASTION_TABLE = 'bastions'

/** 每台设备保留的操作历史条数上限。 */
export const HISTORY_LIMIT = 50
/** 历史记录中保存的输出摘要上限（字符）。 */
export const HISTORY_OUTPUT_CHARS = 2000
/** 环境探针缓存有效期（毫秒），24 小时（对齐 SailFish 重探测周期）。 */
export const ENV_TTL_MS = 24 * 3600 * 1000

/**
 * 校验并规范化一个设备记录。敏感字段（密码/私钥/口令）不进入设备记录，
 * 由 SecretStore 加密保存；本函数只接受不含秘密的输入。
 */
export function normalizeDevice(input) {
  const protocol = input.protocol === 'telnet' ? 'telnet' : 'ssh'
  const host = String(input.host || '').trim()
  if (!host) throw new Error('host 不能为空')
  const port = Number(input.port) || (protocol === 'telnet' ? 23 : 22)
  const username = String(input.username ?? '').trim()
  const authType = input.authType === 'privateKey' ? 'privateKey' : 'password'
  const jumpHost = input.jumpHost && input.jumpHost.host
    ? {
      host: String(input.jumpHost.host),
      port: Number(input.jumpHost.port) || 22,
      username: String(input.jumpHost.username ?? ''),
      authType: input.jumpHost.authType === 'privateKey' ? 'privateKey' : 'password',
    }
    : undefined
  const flags = input.secretFlags ?? {}
  return {
    id: String(input.id || randomUUID()),
    name: String(input.name || host),
    group: String(input.group || ''),
    protocol,
    host,
    port,
    username,
    authType,
    // 内网 IP：供 AI 在跨机排查时按 IP 精确匹配目标（可手动填写，探针会自动回填）
    lanIp: String(input.lanIp || '').trim(),
    // 秘密只存"是否已配置"标志，值在 SecretStore
    secretFlags: {
      password: Boolean(flags.password),
      privateKey: Boolean(flags.privateKey),
      passphrase: Boolean(flags.passphrase),
      jumpPassword: Boolean(flags.jumpPassword),
      jumpPrivateKey: Boolean(flags.jumpPrivateKey),
      jumpPassphrase: Boolean(flags.jumpPassphrase),
    },
    encoding: ['utf8', 'gbk', 'latin1', 'utf16le'].includes(input.encoding) ? input.encoding : 'utf8',
    ...(input.promptRegex ? { promptRegex: String(input.promptRegex) } : {}),
    jumpHost,
    source: input.source === 'jumpserver' ? 'jumpserver' : 'manual',
    ...(input.assetId !== undefined ? { assetId: String(input.assetId) } : {}),
    comment: String(input.comment || ''),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 对外的脱敏视图：密码/私钥以 hasSecret 标记替代；不含 undefined 字段（工具输出要求 lossless JSON）。 */
export function publicView(device) {
  const flags = device.secretFlags ?? {}
  return {
    id: device.id,
    name: device.name,
    group: device.group,
    protocol: device.protocol,
    host: device.host,
    port: device.port,
    username: device.username,
    authType: device.authType,
    ...(device.lanIp ? { lanIp: device.lanIp } : {}),
    hasPassword: Boolean(flags.password),
    hasPrivateKey: Boolean(flags.privateKey),
    encoding: device.encoding,
    ...(device.jumpHost ? {
      jumpHost: {
        host: device.jumpHost.host,
        port: device.jumpHost.port,
        username: device.jumpHost.username,
        authType: device.jumpHost.authType,
        hasPassword: Boolean(flags.jumpPassword),
        hasPrivateKey: Boolean(flags.jumpPrivateKey),
      },
    } : {}),
    source: device.source,
    ...(device.assetId !== undefined ? { assetId: device.assetId } : {}),
    comment: device.comment,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  }
}

/**
 * 打开设备仓库（惰性打开 KV 单元）。
 * @param {object} ctx - cordis context（读 ctx.storage）
 */
export class DeviceRepo {
  constructor(ctx, secretsDir) {
    this.ctx = ctx
    this.unit = null
    this.cache = new Map() // id → device
    this.history = new Map() // deviceId → 记录数组（倒序，最新在前）
    this.env = new Map() // deviceId → 环境探针
    this.bastions = new Map() // id → bastionProfile
    this.loaded = false
    this.tail = Promise.resolve() // 串行写链
    this.secrets = new SecretStore(secretsDir)
  }

  /** 惰性打开并载入全量。没有 storage 后端时退化为纯内存。 */
  async #ensure() {
    if (this.loaded) return
    const storage = this.ctx.get('storage')
    if (storage) {
      try {
        const backend = storage.backend.get('json')
        this.unit = await backend.kv.open({
          name: UNIT_NAME,
          version: 1,
          tables: [TABLE, HISTORY_TABLE, ENV_TABLE, BASTION_TABLE],
          hasGlobal: false,
        })
        const snapshot = await this.unit.loadAll()
        const records = snapshot.tables[TABLE] ?? {}
        let migrated = false
        for (const [id, value] of Object.entries(records)) {
          const result = await this.#migrateLegacySecrets(value)
          if (result.changed) {
            records[id] = result.device
            migrated = true
          }
          this.cache.set(id, result.device)
        }
        if (migrated && this.unit) {
          // 迁移后的记录（秘密已加密、明文已剥离）写回存储
          for (const [id, device] of Object.entries(records)) {
            await this.unit.putRecord(TABLE, id, device)
          }
        }
        const historyRecords = snapshot.tables[HISTORY_TABLE] ?? {}
        for (const [id, value] of Object.entries(historyRecords)) {
          const deviceId = value.deviceId
          if (!deviceId) continue
          const list = this.history.get(deviceId) ?? []
          list.push(value)
          this.history.set(deviceId, list)
        }
        for (const list of this.history.values()) {
          list.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
        }
        const envRecords = snapshot.tables[ENV_TABLE] ?? {}
        for (const [deviceId, value] of Object.entries(envRecords)) this.env.set(deviceId, value)
        const bastionRecords = snapshot.tables[BASTION_TABLE] ?? {}
        for (const [id, value] of Object.entries(bastionRecords)) this.bastions.set(id, value)
      } catch (error) {
        this.ctx.logger?.warn('dsh-device: 存储后端不可用，设备列表仅保存在内存中：%s', error?.message ?? error)
        this.unit = null
      }
    }
    this.loaded = true
  }

  /**
   * 旧版本明文秘密迁移：设备记录里带有 password/privateKey/passphrase 或
   * jumpHost 内的秘密时，把它们写进 SecretStore（加密落盘）并剥离明文字段，
   * 同步刷新 secretFlags。返回 {device, changed}。
   */
  async #migrateLegacySecrets(value) {
    const device = { ...value }
    let changed = false
    for (const field of ['password', 'privateKey', 'passphrase']) {
      if (typeof device[field] === 'string' && device[field] !== '') {
        await this.secrets.setField(device.id, field, device[field])
        changed = true
      }
      if (field in device) {
        delete device[field]
        changed = true
      }
    }
    if (device.jumpHost) {
      const jump = { ...device.jumpHost }
      for (const field of ['password', 'privateKey', 'passphrase']) {
        if (typeof jump[field] === 'string' && jump[field] !== '') {
          await this.secrets.setField(device.id, `jump:${field}`, jump[field])
          changed = true
        }
        if (field in jump) {
          delete jump[field]
          changed = true
        }
      }
      device.jumpHost = jump
    }
    if (changed) {
      const existingFlags = device.secretFlags ?? {}
      const stored = await this.secrets.get(device.id)
      device.secretFlags = {
        password: Boolean(stored.password),
        privateKey: Boolean(stored.privateKey),
        passphrase: Boolean(stored.passphrase),
        jumpPassword: Boolean(stored['jump:password']),
        jumpPrivateKey: Boolean(stored['jump:privateKey']),
        jumpPassphrase: Boolean(stored['jump:passphrase']),
        // 与既有标志合并（迁移前的标志可能已存在）
        ...existingFlags,
      }
    }
    return { device, changed }
  }

  /** 全量列表（升序按 name）。 */
  async list() {
    await this.#ensure()
    return [...this.cache.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  /** 按 id 或名称/主机查找（名称支持前缀匹配）。 */
  async find(selector) {
    await this.#ensure()
    const key = String(selector).trim()
    if (!key) return undefined
    for (const device of this.cache.values()) {
      if (device.id === key) return device
    }
    for (const device of this.cache.values()) {
      if (device.name === key || device.host === key) return device
    }
    // 部分匹配只在关键字足够长时生效，避免短关键字（如资产 id "1"）
    // 误匹配到主机地址里包含该字符的设备
    if (key.length >= 3) {
      const partial = [...this.cache.values()].filter(
        (device) => device.name.includes(key) || device.host.includes(key),
      )
      if (partial.length === 1) return partial[0]
    }
    return undefined
  }

  /**
   * 给一台设备附上解密后的连接凭据（内存中临时使用，不落盘）。
   * @returns {Promise<object>} 带 password/privateKey/passphrase 字段的设备副本。
   */
  async hydrateSecrets(device) {
    const secrets = await this.secrets.get(device.id)
    const out = { ...device }
    for (const field of ['password', 'privateKey', 'passphrase']) {
      if (secrets[field] !== undefined) out[field] = secrets[field]
      if (secrets[`${field}Corrupt`]) {
        throw new Error(`设备「${device.name}」的${field === 'password' ? '密码' : field === 'privateKey' ? '私钥' : '口令'}密文已损坏，请重新填写`)
      }
    }
    if (device.jumpHost) {
      out.jumpHost = { ...device.jumpHost }
      for (const field of ['password', 'privateKey', 'passphrase']) {
        if (secrets[`jump:${field}`] !== undefined) out.jumpHost[field] = secrets[`jump:${field}`]
        if (secrets[`jump:${field}Corrupt`]) {
          throw new Error(`设备「${device.name}」跳板机的${field === 'password' ? '密码' : field === 'privateKey' ? '私钥' : '口令'}密文已损坏，请重新填写`)
        }
      }
    }
    return out
  }

  /** 新增或更新（upsert），串行写链保证落盘顺序。
   *  敏感字段语义：undefined 保留已有秘密；空字符串清除；有值则覆盖（加密落盘）。 */
  async upsert(input) {
    await this.#ensure()
    const existing = typeof input.id === 'string' ? this.cache.get(input.id) : undefined
    const merged = { ...input }
    const secretsInput = {}
    for (const field of ['password', 'privateKey', 'passphrase']) {
      if (merged[field] !== undefined) {
        secretsInput[field] = merged[field]
        delete merged[field]
      }
    }
    if (merged.jumpHost) {
      const jump = { ...merged.jumpHost }
      for (const field of ['password', 'privateKey', 'passphrase']) {
        if (jump[field] !== undefined) {
          secretsInput[`jump:${field}`] = jump[field]
          delete jump[field]
        }
      }
      merged.jumpHost = jump
    }
    // 保留语义：undefined → 沿用已有标志
    const flags = { ...(existing?.secretFlags ?? {}) }
    for (const [key, field] of [['password', 'password'], ['privateKey', 'privateKey'], ['passphrase', 'passphrase'], ['jump:password', 'jumpPassword'], ['jump:privateKey', 'jumpPrivateKey'], ['jump:passphrase', 'jumpPassphrase']]) {
      if (secretsInput[key] !== undefined) flags[field] = secretsInput[key] !== ''
    }
    merged.secretFlags = flags
    const device = normalizeDevice(merged)
    const task = this.tail.then(async () => {
      // 秘密写加密存储（按字段：空=清除，有值=覆盖）
      for (const [key, value] of Object.entries(secretsInput)) {
        if (value === '') await this.secrets.setField(device.id, key, '')
        else if (typeof value === 'string') await this.secrets.setField(device.id, key, value)
      }
      this.cache.set(device.id, device)
      if (this.unit) await this.unit.putRecord(TABLE, device.id, device)
    })
    this.tail = task.catch(() => undefined)
    await task
    return device
  }

  /** 删除（幂等）。 */
  async remove(id) {
    await this.#ensure()
    const task = this.tail.then(async () => {
      this.cache.delete(id)
      await this.secrets.remove(id)
      if (this.unit) {
        await this.unit.deleteRecord(TABLE, id)
        // 清理该设备的记忆记录
        for (const record of this.history.get(id) ?? []) {
          await this.unit.deleteRecord(HISTORY_TABLE, record.id)
        }
        this.history.delete(id)
        await this.unit.deleteRecord(ENV_TABLE, id)
        this.env.delete(id)
      }
    })
    this.tail = task.catch(() => undefined)
    await task
  }

  /**
   * 追加一条操作历史（倒序保留，每设备最多 HISTORY_LIMIT 条）。
   * @param {object} record - { deviceId, deviceName, protocol, command, exitCode, timedOut, stdout, stderr, source }
   */
  async recordHistory(record) {
    await this.#ensure()
    const startedAt = Date.now()
    const entry = {
      id: randomUUID(),
      ...record,
      stdout: (record.stdout ?? '').slice(0, HISTORY_OUTPUT_CHARS),
      stderr: (record.stderr ?? '').slice(0, HISTORY_OUTPUT_CHARS),
      startedAt,
    }
    const task = this.tail.then(async () => {
      const list = this.history.get(entry.deviceId) ?? []
      list.unshift(entry)
      while (list.length > HISTORY_LIMIT) {
        const dropped = list.pop()
        if (dropped && this.unit) await this.unit.deleteRecord(HISTORY_TABLE, dropped.id)
      }
      this.history.set(entry.deviceId, list)
      if (this.unit) await this.unit.putRecord(HISTORY_TABLE, entry.id, entry)
    })
    this.tail = task.catch(() => undefined)
    await task
    return entry
  }

  /** 读取一台设备的操作历史（倒序，最新在前）。 */
  async historyOf(deviceId) {
    await this.#ensure()
    return [...(this.history.get(deviceId) ?? [])]
  }

  /** 保存环境探针结果。 */
  async saveEnv(deviceId, env) {
    await this.#ensure()
    const entry = { deviceId, probedAt: Date.now(), ...env }
    const task = this.tail.then(async () => {
      this.env.set(deviceId, entry)
      if (this.unit) await this.unit.putRecord(ENV_TABLE, deviceId, entry)
    })
    this.tail = task.catch(() => undefined)
    await task
    return entry
  }

  /** 更新一台设备的内网 IP（探针自动回填；值变化才写盘）。 */
  async updateLanIp(id, lanIp) {
    await this.#ensure()
    const value = String(lanIp || '').trim()
    const device = this.cache.get(id)
    if (!device || device.lanIp === value) return device
    device.lanIp = value
    const task = this.tail.then(async () => {
      if (this.unit) await this.unit.putRecord(TABLE, id, device)
    })
    this.tail = task.catch(() => undefined)
    await task
    return device
  }

  /** 读取环境探针（过期返回 undefined）。 */
  async envOf(deviceId) {
    await this.#ensure()
    const entry = this.env.get(deviceId)
    if (!entry) return undefined
    if (Date.now() - entry.probedAt > ENV_TTL_MS) return undefined
    return entry
  }

  /** 获取堡垒机连接历史列表（按使用时间倒序）。 */
  async listBastions() {
    await this.#ensure()
    return [...this.bastions.values()].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
  }

  /** 保存或更新堡垒机连接配置历史（密码加密落盘）。 */
  async saveBastion(profile) {
    await this.#ensure()
    const url = String(profile.url || '').trim().replace(/\/+$/, '')
    if (!url) throw new Error('url 不能为空')
    const username = String(profile.username || '').trim()
    // 依据 url + username 生成或复用 id
    let id = String(profile.id || '').trim()
    if (!id) {
      for (const existing of this.bastions.values()) {
        if (existing.url === url && existing.username === username) {
          id = existing.id
          break
        }
      }
      if (!id) id = `bastion-${randomUUID()}`
    }

    const existing = this.bastions.get(id)
    let hasPassword = Boolean(existing?.hasPassword)

    if (typeof profile.password === 'string' && profile.password !== '') {
      await this.secrets.setField(`bastion:${id}`, 'password', profile.password)
      hasPassword = true
    } else if (profile.password === '') {
      await this.secrets.setField(`bastion:${id}`, 'password', '')
      hasPassword = false
    }

    const entry = {
      id,
      name: profile.name || (username ? `${url} (${username})` : url),
      url,
      username,
      defaultAccount: String(profile.defaultAccount ?? existing?.defaultAccount ?? ''),
      rejectUnauthorized: profile.rejectUnauthorized !== false,
      hasPassword,
      lastUsedAt: profile.lastUsedAt || Date.now(),
      lastSyncAt: profile.lastSyncAt ?? existing?.lastSyncAt ?? 0,
      totalAssets: profile.totalAssets ?? existing?.totalAssets ?? 0,
    }

    const task = this.tail.then(async () => {
      this.bastions.set(id, entry)
      if (this.unit) await this.unit.putRecord(BASTION_TABLE, id, entry)
    })
    this.tail = task.catch(() => undefined)
    await task
    return entry
  }

  /** 获取指定堡垒机配置及解密后的密码。 */
  async getBastionWithSecret(id) {
    await this.#ensure()
    const entry = this.bastions.get(id)
    if (!entry) return undefined
    const out = { ...entry }
    const secrets = await this.secrets.get(`bastion:${id}`)
    if (secrets?.password) {
      out.password = secrets.password
    }
    return out
  }

  /** 删除指定的堡垒机连接历史。 */
  async deleteBastion(id) {
    await this.#ensure()
    const task = this.tail.then(async () => {
      this.bastions.delete(id)
      if (this.unit) await this.unit.deleteRecord(BASTION_TABLE, id)
      await this.secrets.setField(`bastion:${id}`, 'password', '')
    })
    this.tail = task.catch(() => undefined)
    await task
    return true
  }

  /** 关闭单元。 */
  async close() {
    if (this.unit) await this.unit.close()
    this.unit = null
    this.loaded = false
  }
}
