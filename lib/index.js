/**
 * dsh-device 主机端插件：设备运维能力。
 *
 * 一块注册：
 * - 模型工具：device_list / device_exec / device_test / device_add / device_remove / jumpserver_sync
 * - 斜杠命令：/device-list /device-exec /jumpserver-sync /device-memory（ctx.commands，不经模型）
 * - 设置命名空间：`device`（堡垒机配置 + 行为开关，Settings 页面可编辑）、
 *   `device-cache`（堡垒机资产缓存）
 * - HTTP 路由：/plugins/device/*（供浏览器面板 CRUD 设备、同步资产、快速执行）
 * - 运维 skills（来自 SailFish 项目的 skills/ 目录）
 * - 系统提示词片段
 *
 * 所有可选服务（settings / webServer / skills / userQuestions）都经
 * ctx.get() 解析，缺失时对应能力静默降级而不影响加载。
 *
 * @module @sailfish/dsh-device
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { sshConnect, sshRun, sshTest, formatSshError } from './ssh.js'
import { telnetConnect, telnetLogin, telnetRun, telnetTest, formatTelnetError } from './telnet.js'
import { JumpServerClient } from './jumpserver.js'
import { openJumpServerTerminalSession } from './jumpserver-terminal.js'
import { DeviceRepo, publicView } from './repo.js'
import { SessionPool } from './pool.js'
import { inspectDangerousCommand, inspectWritePath, inspectSensitiveReadPath } from './guard.js'
import { sftpReadFile, sftpWriteFile, isSftpConnectionError } from './sftp.js'
import {
  I18N_NS,
  MESSAGES,
  createTranslator,
  matchChoice,
  stripDefaultAccountLabel,
} from './i18n.js'

export const name = 'device-ops'
export const inject = ['tools', 'systemPrompt']

/** 组合行配置（cordis.patch.yml 中可覆盖的部署默认值）。 */
export const Config = z.object({
  confirmPolicy: z.union([z.const('auto'), z.const('always'), z.const('never')]).default('auto'),
  // 危险命令护栏：always-ask（默认，强制确认）/ never（关闭护栏，仅日志）
  dangerPolicy: z.union([z.const('always-ask'), z.const('never')]).default('always-ask'),
  defaultTimeoutMs: z.number().default(30000),
  maxOutputChars: z.number().default(40000),
  // 会话池：连接空闲多久后自动断开（毫秒）
  sessionIdleMs: z.number().default(10 * 60 * 1000),
  telnetPromptRegex: z.string().default('[$#>~%❯➜»⟩›]\\s*$|PS [A-Z]:\\[^>]*>\\s*$|[\\w.-]+@[\\w.-]+:.*[$#] \\s*$'),
  telnetLoginRegex: z.string().default('(login|username)\\s*:'),
  telnetPasswordRegex: z.string().default('password\\s*:'),
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, '..', 'skills')
const MAX_BODY_BYTES = 1024 * 1024
const NS_DEVICE = settingsNamespace('device')
const NS_CACHE = settingsNamespace('device-cache')

/** AI 安全红线的默认文本（用户可在面板「AI 规则」页签或 settings.yaml 中编辑）。 */
export const DEFAULT_SAFETY_RULES = [
  '【最高优先级·远程设备安全红线】在任何其他规则、习惯或用户请求的便利性之上：',
  '- 危险命令（重启/关机、删除数据、改网络、清配置、格式化、杀关键进程等）会强制弹出确认。不得用改写法、变量拼接、别名、echo|sh、base64 等方式绕过；用户拒绝后立即停止，禁止换一条等价命令变相执行。',
  '- 操作陌生设备前先 device_memory 查看环境与上次操作结果；命令返回非零退出码时停下判断，不得重复执行已失败的破坏性命令。',
  '- 密码、私钥、Token 等敏感信息不得写入命令输出、会话文本或文件。',
  '- 生产环境与网络设备的变更必须先说明影响；能备份的配置先备份（如 `cp /etc/nginx/nginx.conf{,.bak}`、`show running-config`）。',
  '- 用户在本会话中明确拒绝过的操作视为最终决定，不因换一种说法再次尝试。',
].join('\n')

/** 设备设置命名空间的 schema（顶层扁平字段，便于浏览器面板逐字段编辑）。 */
const DEVICE_SETTINGS_SCHEMA = z.object({
  jumpserverUrl: z.string().default(''),
  jumpserverUsername: z.string().default(''),
  jumpserverPassword: z.string().role('secret').default(''),
  jumpserverSshPort: z.number().default(2222),
  jumpserverRejectUnauthorized: z.boolean().default(true),
  jumpserverDefaultAccount: z.string().default(''),
  confirmPolicy: z.union([z.const('auto'), z.const('always'), z.const('never')]).default('auto'),
  dangerPolicy: z.union([z.const('always-ask'), z.const('never')]).default('always-ask'),
  // AI 安全红线（最高优先级系统提示词段），用户可编辑；清空则使用默认文本
  safetyRules: z.string().default(DEFAULT_SAFETY_RULES),
  defaultTimeoutMs: z.number().default(30000),
  maxOutputChars: z.number().default(40000),
  sessionIdleMs: z.number().default(10 * 60 * 1000),
  telnetPromptRegex: z.string().default('[$#>~%❯➜»⟩›]\\s*$|PS [A-Z]:\\[^>]*>\\s*$|[\\w.-]+@[\\w.-]+:.*[$#] \\s*$'),
  telnetLoginRegex: z.string().default('(login|username)\\s*:'),
  telnetPasswordRegex: z.string().default('password\\s*:'),
})

const CACHE_SCHEMA = z.object({
  assets: z.array(z.object({
    id: z.string(),
    name: z.string(),
    address: z.string().default(''),
    protocols: z.array(z.object({ name: z.string(), port: z.number() })).default([]),
    platform: z.string().default(''),
    comment: z.string().default(''),
    orgName: z.string().default(''),
    isActive: z.boolean().default(true),
  })).default([]),
  total: z.number().default(0),
  lastSyncAt: z.number().default(0),
  error: z.string().default(''),
})

/** 组装当前生效配置：settings 用户层优先，回退组合行 config。 */
function effectiveConfig(scope, entryConfig) {
  if (!scope) return entryConfig
  try {
    return scope.get()
  } catch {
    return entryConfig
  }
}

function buildJumpServer(config) {
  if (!config.jumpserverUrl) return null
  return new JumpServerClient({
    url: config.jumpserverUrl,
    username: config.jumpserverUsername,
    password: config.jumpserverPassword,
    rejectUnauthorized: config.jumpserverRejectUnauthorized,
    defaultAccount: config.jumpserverDefaultAccount,
  })
}

/**
 * JumpServer API Token 直接复用 DeepSeek Harness 的 API Key（DEEPSEEK_API_KEY，
 * 与 LLM 适配器同一凭据引用），无需单独配置；解析不到时静默回退账号密码登录。
 */
async function resolveJumpserverToken(ctx, jumpserver) {
  if (jumpserver.token) return
  try {
    const credentials = ctx.get('credentials')
    if (credentials) {
      const resolved = await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))
      if (resolved?.value) {
        jumpserver.setToken(resolved.value)
        return
      }
    }
    // credentials 服务缺失时直接读环境
    if (process.env.DEEPSEEK_API_KEY) jumpserver.setToken(process.env.DEEPSEEK_API_KEY)
  } catch {
    // 静默：拿不到 key 就回退账号密码
  }
}

/**
 * 目标对应的会话池工厂：建立/复用连接并执行。
 * SSH 连接上并发跑 channel；Telnet 单流串行（池内排队）。
 * 手动设备的连接凭据在 create 时从加密存储解密注入（内存中临时使用）。
 */
function targetPoolFactory(target, config, account, repo) {
  const jmsJumpHost = target.jumpserver?.getJumpHostConfig?.(config.jumpserverSshPort)

  if (target.kind === 'manual') {
    const device = target.device
    const isJumpserverSource = Boolean((device.source === 'jumpserver' || device.assetId || device.id.startsWith('js-')) && target.jumpserver?.configured)
    const accountName = account ?? config.jumpserverDefaultAccount

    if (device.protocol === 'telnet') {
      return {
        key: `m:${device.id}:${accountName || ''}`,
        serialize: true,
        create: async () => {
          let full = await repo.hydrateSecrets(device)
          if (isJumpserverSource && (!full.password && !full.privateKey)) {
            const assetId = device.assetId || device.id.replace(/^js-/, '')
            const params = await target.jumpserver.connectParams(assetId, accountName).catch(() => null)
            if (params) full = { ...full, ...params }
          }
          if (isJumpserverSource && jmsJumpHost && !full.jumpHost) {
            full.jumpHost = jmsJumpHost
          }
          const session = await telnetConnect(full, { encoding: full.encoding })
          try {
            await telnetLogin(session, full, {
              promptRegex: full.promptRegex || config.telnetPromptRegex,
              loginRegex: config.telnetLoginRegex,
              passwordRegex: config.telnetPasswordRegex,
            })
            return { mode: 'telnet', session }
          } catch (error) {
            session.destroy()
            throw error
          }
        },
        run: (entry, command, opts) => telnetRun(entry.session, command, {
          timeoutMs: opts.timeoutMs,
          maxOutputChars: opts.maxOutputChars,
          signal: opts.signal,
          promptRegex: device.promptRegex || config.telnetPromptRegex,
          loginRegex: config.telnetLoginRegex,
          passwordRegex: config.telnetPasswordRegex,
        }),
        destroy: (entry) => entry.session?.destroy?.(),
      }
    }
    return {
      key: `m:${device.id}:${accountName || ''}`,
      serialize: true,
      create: async () => {
        let full = await repo.hydrateSecrets(device)
        if (isJumpserverSource && (!full.password && !full.privateKey)) {
          const assetId = device.assetId || device.id.replace(/^js-/, '')
          try {
            const params = await target.jumpserver.connectParams(assetId, accountName)
            full = { ...full, ...params }
            if (jmsJumpHost && !full.jumpHost) full.jumpHost = jmsJumpHost
            const session = await sshConnect(full)
            return { mode: 'ssh', session }
          } catch (apiErr) {
            // API 失败时无缝切换到 JumpServer 终端交互模拟
            if (jmsJumpHost) {
              const terminalSession = await openJumpServerTerminalSession(jmsJumpHost, {
                address: device.host,
                name: device.name,
                id: assetId,
              }, {
                account: accountName || device.username,
                timeoutMs: config.defaultTimeoutMs || 30000,
              })
              return { mode: 'terminal', session: terminalSession }
            }
            throw apiErr
          }
        }
        if (isJumpserverSource && jmsJumpHost && !full.jumpHost) {
          full.jumpHost = jmsJumpHost
        }
        const session = await sshConnect(full)
        return { mode: 'ssh', session }
      },
      run: (entry, command, opts) => {
        if (entry.mode === 'terminal') {
          return entry.session.exec(command, opts)
        }
        return sshRun(entry.session, command, {
          timeoutMs: opts.timeoutMs,
          maxOutputChars: opts.maxOutputChars,
          signal: opts.signal,
          encoding: device.encoding,
        })
      },
      destroy: (entry) => entry.session?.destroy?.(),
    }
  }
  // 堡垒机资产：连接时取一次直连参数；API 失败时无缝终端交互模拟
  const asset = target.asset
  const accountName = account ?? config.jumpserverDefaultAccount
  return {
    key: `a:${asset.id}:${accountName || ''}`,
    serialize: true,
    create: async () => {
      try {
        const params = await target.jumpserver.connectParams(asset.id, accountName)
        const connParams = {
          ...params,
          ...(jmsJumpHost && !params.jumpHost ? { jumpHost: jmsJumpHost } : {}),
        }
        if (connParams.protocol === 'telnet') {
          const session = await telnetConnect(connParams, { encoding: 'utf8' })
          try {
            await telnetLogin(session, connParams, {
              promptRegex: config.telnetPromptRegex,
              loginRegex: config.telnetLoginRegex,
              passwordRegex: config.telnetPasswordRegex,
            })
            return { mode: 'telnet', session }
          } catch (error) {
            session.destroy()
            throw error
          }
        }
        const session = await sshConnect(connParams)
        return { mode: 'ssh', session }
      } catch (apiErr) {
        // API 失败时降级到 JumpServer 终端交互模拟
        if (jmsJumpHost) {
          const terminalSession = await openJumpServerTerminalSession(jmsJumpHost, asset, {
            account: accountName,
            timeoutMs: config.defaultTimeoutMs || 30000,
          })
          return { mode: 'terminal', session: terminalSession }
        }
        throw apiErr
      }
    },
    run: (entry, command, opts) => {
      if (entry.mode === 'terminal') {
        return entry.session.exec(command, opts)
      }
      if (entry.mode === 'telnet') {
        return telnetRun(entry.session, command, {
          timeoutMs: opts.timeoutMs,
          maxOutputChars: opts.maxOutputChars,
          signal: opts.signal,
          promptRegex: config.telnetPromptRegex,
        })
      }
      return sshRun(entry.session, command, {
        timeoutMs: opts.timeoutMs,
        maxOutputChars: opts.maxOutputChars,
        signal: opts.signal,
        encoding: 'utf8',
      })
    },
    destroy: (entry) => entry.session?.destroy?.(),
  }
}

/** 在目标上执行命令（经持久会话池复用连接）。 */
async function execOnTarget(pool, repo, target, command, config, signal, account) {
  const factory = targetPoolFactory(target, config, account, repo)
  return pool.exec(factory.key, factory, command, {
    timeoutMs: config.defaultTimeoutMs,
    maxOutputChars: config.maxOutputChars,
    signal,
  })
}

/** 连通性测试（复用会话池：池里有存活连接则直接探测）。 */
async function testTarget(pool, repo, target, config, signal, account) {
  const opts = {
    timeoutMs: Math.min(config.defaultTimeoutMs, 15000),
    signal,
    maxOutputChars: 4096,
  }
  const factory = targetPoolFactory(target, config, account, repo)
  const probe = "echo dsh-device-ok 2>/dev/null || true"
  try {
    const result = await pool.exec(factory.key, factory, probe, opts)
    if (result.timedOut) return { ok: false, message: '连接超时' }
    if (result.exitCode !== 0 && result.exitCode !== null) {
      return { ok: false, message: `命令执行失败（exit ${result.exitCode}）：${result.stderr || result.stdout}` }
    }
    return { ok: true, message: `${target.kind === 'manual' && target.device.protocol === 'telnet' ? 'Telnet' : 'SSH'} 连接正常` }
  } catch (error) {
    const message = target.kind === 'manual' && target.device.protocol === 'telnet'
      ? formatTelnetError(error)
      : formatSshError(error)
    return { ok: false, message }
  }
}

/** 目标的环境记忆键（手动设备用 id，资产用 asset:<id>）。 */
function targetKey(target) {
  return target.kind === 'manual' ? target.device.id : `asset:${target.asset.id}`
}

/** 目标显示名（记忆与确认用）。 */
function targetLabel(target) {
  return target.kind === 'manual'
    ? `${target.device.name} (${target.device.host})`
    : `${target.asset.name} (${target.asset.address})`
}

/**
 * 环境探针：SSH 设备执行一次组合命令收集环境事实；Telnet 尝试 show version。
 * 跨平台：先试 POSIX（Linux/macOS），失败或解析为空时再试 Windows cmd。
 * 失败静默（环境信息是尽力而为的记忆，不阻塞操作）。
 */
async function probeEnv(pool, repo, target, config, signal, account) {
  try {
    if (target.kind === 'manual' && target.device.protocol === 'telnet') {
      const result = await execOnTarget(pool, repo, target, 'show version', config, signal, account)
      return { protocol: 'telnet', raw: (result.stdout || '').slice(0, 2000), probeCommand: 'show version' }
    }
    const parseLines = (text) => {
      const env = {}
      const pm = []
      const tools = []
      for (const line of (text || '').split('\n')) {
        const pair = /^([A-Z]+)=(.+)$/.exec(line.trim())
        if (!pair) continue
        const key = pair[1].toLowerCase()
        const value = pair[2].trim().slice(0, 200)
        if (key === 'pm') pm.push(value)
        else if (key === 'tool') tools.push(value)
        else env[key] = value
      }
      if (pm.length > 0) env.pm = pm.slice(0, 8)
      if (tools.length > 0) env.tools = tools.slice(0, 16)
      return env
    }
    // 1) POSIX 探测（Linux / macOS，基础事实 + 发行版 + 包管理器 + 常用工具）
    const posixProbe = [
      "echo HOST=$(hostname 2>/dev/null || uname -n)",
      "echo OS=$(uname -s 2>/dev/null || echo Linux)",
      "echo KERNEL=$(uname -r 2>/dev/null)",
      "echo ARCH=$(uname -m 2>/dev/null)",
      "echo USER=$(whoami 2>/dev/null || id -un)",
      "echo SHELL=${SHELL:-/bin/sh}",
      "echo CWD=$(pwd 2>/dev/null)",
      "LANIP=$(ip -4 addr show 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | grep -vE '^(127\\.|172\\.17\\.0\\.1)' | head -1)",
      "[ -z \"$LANIP\" ] && LANIP=$(hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i !~ /^(127\\.|172\\.17\\.)/) {print $i; exit}}')",
      "[ -z \"$LANIP\" ] && LANIP=$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -vE '^(127\\.|172\\.17\\.0\\.1)' | head -1)",
      "echo LANIP=$LANIP",
      "echo DISTRO=$(head -1 /etc/os-release 2>/dev/null | sed 's/^[A-Z_]*=//' | tr -d '\"')",
      "for pm in apt-get yum dnf apk pacman zypper emerge brew; do command -v $pm >/dev/null 2>&1 && echo PM=$pm; done",
      "for t in git docker nginx mysql psql redis-cli python3 node java go systemctl kubectl; do command -v $t >/dev/null 2>&1 && echo TOOL=$t; done",
    ].join('; ') + '; true'
    const posix = await execOnTarget(pool, repo, target, posixProbe, config, signal, account)
    const env = parseLines(posix.stdout)
    if (!posix.timedOut && (env.host || env.os || env.lanip || env.user)) {
      return { protocol: 'ssh', ...env }
    }
    // 2) Windows 探测（OpenSSH on Windows 的默认 shell 是 cmd.exe）
    const winProbe = "echo HOST=%COMPUTERNAME% & echo OS=Windows & whoami & ver & cd & for /f \"tokens=2 delims=:\" %i in ('ipconfig ^| findstr /i \"IPv4\"') do @echo LANIP=%i"
    const win = await execOnTarget(pool, repo, target, winProbe, config, signal, account)
    const winEnv = parseLines(win.stdout)
    const windows = /Windows|Microsoft/i.test(win.stdout) || winEnv.os === 'Windows'
    const raw = `${posix.stdout || ''}\n--- win probe ---\n${win.stdout || ''}`.slice(0, 2000)
    return {
      protocol: 'ssh',
      raw,
      ...(windows ? { os: 'windows' } : {}),
      ...(winEnv.host ? { host: winEnv.host } : {}),
      ...(winEnv.os ? { os: 'windows' } : {}),
      ...(env.host || env.os || env.lanip ? env : (winEnv.host ? winEnv : {})),
    }
  } catch (error) {
    return { protocol: 'ssh', raw: `probe failed: ${error?.message ?? error}`.slice(0, 500) }
  }
}

/** 按选择器解析目标：先手动设备，再堡垒机资产缓存。 */
async function resolveTarget(selector, repo, cache) {
  const key = String(selector).trim()
  if (!key) throw new Error('设备选择器不能为空')
  const device = await repo.find(key)
  if (device) {
    const isJumpserver = device.source === 'jumpserver' || device.assetId || device.id.startsWith('js-')
    return { kind: 'manual', device, jumpserver: isJumpserver ? cache?.client : null }
  }
  const asset = (cache?.assets ?? []).find(
    (candidate) => candidate.id === key || candidate.name === key || candidate.address === key,
  )
  if (!asset) {
    const partial = (cache?.assets ?? []).filter(
      (candidate) => candidate.name.includes(key) || candidate.address.includes(key),
    )
    if (partial.length === 1) return { kind: 'asset', asset: partial[0], jumpserver: cache.client }
    throw new Error(`未找到设备「${key}」（先用 device_list 查看可用设备）`)
  }
  return { kind: 'asset', asset, jumpserver: cache.client }
}

/** 组装 device_list 的设备行文本。 */
function describeDevice(device, t = createTranslator('zh')) {
  const cred = device.jumpHost ? t('slash.viaJump') : ''
  const lan = device.lanIp ? t('slash.lanIp', { ip: device.lanIp }) : ''
  return `- ${device.id} | ${device.name} | ${device.protocol} | ${device.host}:${device.port} | ${device.username || t('slash.noUsername')} | ${device.group || '-'}${lan}${cred}`
}

/** 组装堡垒机资产行文本。 */
function describeAsset(asset) {
  const protocols = asset.protocols.map((p) => `${p.name}:${p.port}`).join(',') || '?'
  return `- ${asset.id} | ${asset.name} | ${asset.address} | [${protocols}] | ${asset.platform || '-'} | ${asset.orgName || '-'}`
}

/** 从 skills 目录读取全部运维 skill。 */
function loadBundledSkills() {
  const skills = []
  let dirs = []
  try {
    dirs = readdirSync(SKILLS_DIR)
  } catch {
    return skills
  }
  for (const dir of dirs) {
    const file = join(SKILLS_DIR, dir, 'SKILL.md')
    try {
      const content = readFileSync(file, 'utf8')
      const meta = parseSkillFrontmatter(content)
      if (!meta.name) continue
      skills.push({
        name: meta.name,
        description: meta.description || `运维技能：${meta.title || meta.name}`,
        content,
        provider: 'sailfish',
        resourceBase: { kind: 'directory', path: join(SKILLS_DIR, dir) },
      })
    } catch {
      // 单个 skill 读取失败不影响整体
    }
  }
  return skills
}

/** 解析 SKILL.md 的 YAML frontmatter（name/description/title）。 */
function parseSkillFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content)
  if (!match) return {}
  const meta = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z-]+):\s*(.*)$/.exec(line)
    if (pair) meta[pair[1]] = pair[2].replace(/^["']|["']$/g, '')
  }
  return meta
}

function jsonError(status, message) {
  return { status, body: { ok: false, error: message } }
}

function jsonOk(status, body) {
  return { status, body: { ok: true, ...body } }
}

/** 浏览器请求信任检查：仅允许回环或与 Host 同源。 */
function isTrustedRequest(req) {
  const host = req.headers.host || ''
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '')
  if (['127.0.0.1', 'localhost', '::1', ''].includes(hostname)) return true
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const originHost = new URL(origin).hostname
    return originHost === hostname || ['127.0.0.1', 'localhost', '::1'].includes(originHost)
  } catch {
    return false
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/**
 * 插件主体。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {object} [entryConfig] - cordis.patch.yml 行配置（默认值层）。
 */
export function apply(ctx, entryConfig = {}) {
  const repo = new DeviceRepo(ctx)
  // 持久会话池：空闲超时随配置走（配置变化时重建池）
  let pool = new SessionPool({ logger: ctx.logger })
  const rebuildPool = () => {
    const config = getConfig()
    if (pool.idleTimeoutMs === config.sessionIdleMs) return
    const next = new SessionPool({ logger: ctx.logger, idleTimeoutMs: config.sessionIdleMs })
    pool.dispose()
    pool = next
  }

  // ── 设置命名空间（可选服务：settings 就绪时注册并生效） ──────────────
  // 插件主体只声明 inject: ['tools','systemPrompt']，settings / webServer /
  // skills 都是可选依赖：用 ctx.inject 建立作用域 fiber，服务出现即挂载、
  // 消失即清理，任何缺失都不会拖住插件本身（也兼容 headless 组合）。
  let deviceScope
  let cacheScope
  ctx.inject(['settings'], (sctx) => {
    try {
      const scope = sctx.settings.register(NS_DEVICE, DEVICE_SETTINGS_SCHEMA, {
        base: entryConfig,
        applies: 'live',
      })
      const cache = sctx.settings.register(NS_CACHE, CACHE_SCHEMA, {
        applies: 'live',
      })
      deviceScope = scope
      cacheScope = cache
      ctx.logger?.info('dsh-device: settings 命名空间已注册（device / device-cache）')
      // 堡垒机配置变化时清空资产缓存（凭据/地址变了，旧资产可能已失效）；
      // 会话池空闲超时变化时重建池
      const unwatch = scope.watch((next) => {
        if (!next.jumpserverUrl) {
          void cache.replace({ assets: [], total: 0, lastSyncAt: 0, error: '' })
        }
        rebuildPool()
      })
      sctx.effect(() => () => {
        unwatch()
        deviceScope = undefined
        cacheScope = undefined
      })
    } catch (error) {
      ctx.logger?.warn('dsh-device: settings 注册失败：%s', error?.message ?? error)
    }
  })
  const getConfig = () => effectiveConfig(deviceScope, entryConfig)
  const getCache = () => {
    const cache = cacheScope?.get() ?? CACHE_SCHEMA({})
    const config = getConfig()
    return { ...cache, client: buildJumpServer(config) }
  }

  /**
   * 把中英字典挂到 DSH locale；没有该服务时固定中文。
   *
   * :param {object} locale: ctx.locale。
   * :return {function}: t(key, vars)。
   */
  const bindLocale = (locale) => {
    if (!locale) return createTranslator('zh')
    try {
      locale.register(I18N_NS, MESSAGES)
    } catch {
      try {
        locale.register(I18N_NS, 'zh', MESSAGES.zh)
        locale.register(I18N_NS, 'en', MESSAGES.en)
      } catch {
        return createTranslator('zh')
      }
    }
    return typeof locale.bind === 'function' ? locale.bind(I18N_NS) : createTranslator('zh')
  }
  let t = createTranslator('zh')
  let reregisterCommands
  const refreshT = () => { t = bindLocale(ctx.get('locale')) }
  refreshT()
  ctx.inject(['locale'], (lctx) => {
    refreshT()
    reregisterCommands?.()
    const unsub = typeof lctx.locale.subscribe === 'function'
      ? lctx.locale.subscribe(() => { refreshT(); reregisterCommands?.() })
      : undefined
    lctx.effect(() => () => unsub?.())
  })

  // ── 会话级确认记忆：一次会话内同一设备只问一次 ──────────────────────
  const approvedBySession = new WeakMap()
  // 面板快速执行没有 agent session，用进程内 Set 对齐「本会话每台设备一次」
  const panelApproved = new Set()

  /** 需要时向用户确认；返回 false 表示用户拒绝。 */
  async function confirmExecution(exec, deviceLabel, confirm) {
    const config = getConfig()
    const policy = confirm === 'yes' ? 'always' : confirm === 'no' ? 'never' : config.confirmPolicy
    if (policy === 'never') return true
    const session = exec.agent?.session
    const approved = session ? (approvedBySession.get(session) ?? new Set()) : null
    const key = deviceLabel
    if (policy === 'auto' && approved?.has(key)) return true
    const userQuestions = ctx.get('userQuestions')
    if (!userQuestions) {
      throw new Error('需要用户确认但没有可用的确认通道（未挂载 userQuestions 服务）')
    }
    const result = await userQuestions.ask({
      questions: [{
        id: 'confirm-device',
        header: t('confirm.header'),
        question: t('confirm.question', { name: deviceLabel }),
        options: [
          { label: t('confirm.remember'), description: t('confirm.rememberDesc') },
          { label: t('confirm.once'), description: t('confirm.onceDesc') },
          { label: t('common.cancel'), description: t('confirm.cancelDesc') },
        ],
      }],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      signal: exec.signal,
    })
    const answer = result.answers.find((entry) => entry.id === 'confirm-device')
    const selected = answer?.selected?.[0] ?? ''
    const choice = matchChoice(selected, ['confirm.remember', 'confirm.once', 'common.cancel'])
    if (!choice || choice === 'common.cancel') return false
    if (choice === 'confirm.remember' && session) {
      if (!approvedBySession.has(session)) approvedBySession.set(session, new Set())
      approvedBySession.get(session).add(key)
    }
    return true
  }

  // ── 堡垒机资产账号选择（会话内记住） ─────────────────────────────────
  const accountBySession = new WeakMap()

  /**
   * 连接堡垒机资产时的登录账号决策：
   * 拉取该资产的账号列表；只有 1 个 → 直接用；多个 → 弹窗让用户选择
   * （本会话内记住）；拉不到列表 → 回退 defaultAccount（未配置则不带账号）。
   * 返回账号名；用户取消返回 null。
   */
  async function pickAssetAccount(ctx, exec, target, config) {
    const assetId = target.kind === 'manual'
      ? (target.device.assetId || target.device.id.replace(/^js-/, ''))
      : target.asset.id
    const assetName = target.kind === 'manual' ? target.device.name : target.asset.name
    const assetKey = assetId
    const session = exec.agent?.session
    if (session && accountBySession.get(session)?.has(assetKey)) {
      return accountBySession.get(session).get(assetKey)
    }
    let accounts = []
    try {
      await resolveJumpserverToken(ctx, target.jumpserver)
      accounts = await target.jumpserver.accounts(assetId)
    } catch {
      accounts = []
    }
    // 若 API 端点未返回，回退到资产对象自带的 accounts 缓存
    const cachedAccounts = target.kind === 'manual' ? [] : (target.asset?.accounts ?? [])
    if (accounts.length === 0 && Array.isArray(cachedAccounts) && cachedAccounts.length > 0) {
      accounts = cachedAccounts
    }
    if (accounts.length === 0) {
      return config.jumpserverDefaultAccount || undefined
    }
    if (accounts.length === 1) {
      const single = accounts[0].name || accounts[0].username || accounts[0].id
      if (session) {
        if (!accountBySession.has(session)) accountBySession.set(session, new Map())
        accountBySession.get(session).set(assetKey, single)
      }
      return single
    }
    const userQuestions = ctx.get('userQuestions')
    if (!userQuestions) {
      const fallback = (config.jumpserverDefaultAccount && accounts.some((a) => a.name === config.jumpserverDefaultAccount))
        ? config.jumpserverDefaultAccount
        : (accounts[0].name || accounts[0].username || accounts[0].id)
      return fallback
    }
    const options = accounts.map((account) => ({
      label: account.name,
      description: account.username && account.username !== account.name
        ? t('account.desc', { username: account.username })
        : t('account.descFallback'),
    }))
    if (config.jumpserverDefaultAccount && accounts.some((a) => a.name === config.jumpserverDefaultAccount)) {
      options.unshift({
        label: `${config.jumpserverDefaultAccount}${t('account.defaultSuffix')}`,
        description: t('account.defaultDesc'),
      })
    }
    options.push({ label: t('common.cancel'), description: t('account.cancelDesc') })
    const result = await userQuestions.ask({
      questions: [{
        id: 'pick-account',
        header: t('account.header'),
        question: t('account.question', { name: assetName }),
        options,
      }],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      signal: exec.signal,
    })
    const answer = result.answers.find((entry) => entry.id === 'pick-account')
    const selected = stripDefaultAccountLabel(answer?.selected?.[0] ?? '')
    if (!selected || matchChoice(selected, ['common.cancel'])) return null
    if (session) {
      if (!accountBySession.has(session)) accountBySession.set(session, new Map())
      accountBySession.get(session).set(assetKey, selected)
    }
    return selected
  }

  /**
   * 危险命令强制确认：显示分类、影响与完整命令，用户显式确认后才放行。
   * 不提供"记住"选项——每次危险命令都必须单独确认。
   * @returns {Promise<boolean>} true=确认执行，false=取消。
   */
  async function confirmDangerousExecution(exec, deviceLabel, inspection, command) {
    const userQuestions = ctx.get('userQuestions')
    if (!userQuestions) {
      throw new Error(`危险命令（${inspection.category}：${inspection.reason}）需要用户确认，但当前组合未挂载 userQuestions 服务`)
    }
    const result = await userQuestions.ask({
      questions: [{
        id: 'confirm-danger',
        header: t('danger.header', { category: inspection.category }),
        question: [
          t('danger.lead', { name: deviceLabel }),
          '```',
          command,
          '```',
          t('danger.impact', { reason: inspection.reason }),
        ].join('\n'),
        options: [
          { label: t('danger.confirm'), description: t('danger.confirmDesc') },
          { label: t('common.cancel'), description: t('confirm.cancelDesc') },
        ],
      }],
      ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
      signal: exec.signal,
    })
    const answer = result.answers.find((entry) => entry.id === 'confirm-danger')
    const selected = answer?.selected?.[0] ?? ''
    return matchChoice(selected, ['danger.confirm', 'common.cancel']) === 'danger.confirm'
  }

  /** 记录一次操作到设备记忆（历史 + 环境探针按需刷新）。 */
  async function recordOperation(target, command, result, startedAt, source, account) {
    const key = targetKey(target)
    const label = targetLabel(target)
    await repo.recordHistory({
      deviceId: key,
      deviceName: label,
      protocol: target.kind === 'manual' ? target.device.protocol : (target.asset.protocols?.[0]?.name || 'ssh'),
      command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      source,
    })
    // 环境探针：无缓存或已过期时刷新（失败静默）；顺手回填手动设备的内网 IP
    const existingEnv = await repo.envOf(key)
    if (!existingEnv) {
      const config = getConfig()
      const env = await probeEnv(pool, repo, target, config, undefined, account)
      await repo.saveEnv(key, env)
      if (target.kind === 'manual' && env.lanip) {
        await repo.updateLanIp(target.device.id, env.lanip)
      }
    }
  }

  /**
   * 列出手动设备 + 堡垒机资产（工具与斜杠命令共用）。
   * :param {string} [query]: 名称/地址/内网 IP 过滤。
   * :param {boolean} [refresh]: 是否强制同步堡垒机。
   * :return {Promise<object>}
   */
  async function listDevices(query, refresh) {
    const needle = query && query !== '*' ? String(query) : ''
    const devices = (await repo.list()).filter(
      (device) => !needle || device.name.includes(needle) || device.host.includes(needle) || (device.lanIp ?? '').includes(needle),
    )
    let cache = getCache()
    let lastSyncAt = cache.lastSyncAt
    let syncError = cache.error
    const jumpserver = buildJumpServer(getConfig())
    // 已配置堡垒机但没有缓存 → 顺手拉一次（限一次会话内每个插件实例一次）
    if (jumpserver?.configured && cache.assets.length === 0 && !cache.lastSyncAt) {
      const synced = await syncAssets(jumpserver, cacheScope, getConfig())
      cache = getCache()
      lastSyncAt = synced.lastSyncAt
      syncError = synced.error
    } else if (refresh && jumpserver?.configured) {
      const synced = await syncAssets(jumpserver, cacheScope, getConfig())
      cache = getCache()
      lastSyncAt = synced.lastSyncAt
      syncError = synced.error
    }
    let assets = cache.assets ?? []
    if (needle) {
      assets = assets.filter(
        (asset) => asset.name.includes(needle) || asset.address.includes(needle) || asset.id === needle,
      )
    }
    return {
      devices: devices.map(publicView),
      assets,
      jumpserver: {
        configured: Boolean(jumpserver?.configured),
        lastSyncAt,
        total: cache.total ?? assets.length,
        error: syncError,
      },
    }
  }

  /**
   * 查询设备环境探针与操作历史（工具与斜杠命令共用）。
   * :param {string} [selector]: 设备 ID/名称/地址；缺省为全量概览。
   * :param {number} [limit]: 每台历史条数，默认 5，最大 20。
   * :return {Promise<{memories: object[]}>}
   */
  async function queryMemories(selector, limit) {
    const cap = Math.min(Math.max(limit ?? 5, 1), 20)
    const devices = await repo.list()
    const assets = getCache().assets ?? []
    let targets
    if (selector) {
      // 与 device_exec 一致：按 id/名称/地址解析，避免只做全等过滤漏掉
      const found = await repo.find(selector)
      targets = found ? [found] : []
      if (targets.length === 0) {
        const asset = assets.find((entry) =>
          entry.id === selector || entry.name === selector || entry.address === selector)
        if (asset) targets = [{ id: `asset:${asset.id}`, name: `${asset.name}（堡垒机资产）` }]
      }
    } else {
      targets = devices
      for (const asset of assets) {
        const env = await repo.envOf(`asset:${asset.id}`)
        const history = await repo.historyOf(`asset:${asset.id}`)
        if (env || history.length > 0) {
          targets.push({ id: `asset:${asset.id}`, name: `${asset.name}（堡垒机资产）` })
        }
      }
    }
    const memories = []
    for (const device of targets) {
      const env = await repo.envOf(device.id)
      const history = (await repo.historyOf(device.id)).slice(0, cap)
      memories.push({
        deviceId: device.id,
        deviceName: device.name,
        ...(env ? { env } : { env: null }),
        history: history.map((entry) => ({
          command: entry.command,
          exitCode: entry.exitCode,
          timedOut: Boolean(entry.timedOut),
          stdout: entry.stdout,
          stderr: entry.stderr,
          startedAt: entry.startedAt,
          source: entry.source,
        })),
      })
    }
    if (memories.length === 0) {
      if (selector) throw new Error(`未找到设备「${selector}」的记忆（先用 device_list 或 /device-list 查看）`)
      return { memories: [] }
    }
    return { memories }
  }

  /**
   * 强制同步 JumpServer 资产缓存。
   * :return {Promise<{total: number, lastSyncAt: number}>}
   */
  async function syncJumpServerAssets() {
    const jumpserver = buildJumpServer(getConfig())
    if (!jumpserver?.configured) throw new Error('尚未配置 JumpServer（先在设备面板或设置中填写堡垒机地址与账号）')
    const result = await syncAssets(jumpserver, cacheScope, getConfig())
    if (result.error) throw new Error(result.error)
    return { total: result.total, lastSyncAt: result.lastSyncAt }
  }

  /**
   * 在目标设备执行一条命令（确认 + 护栏 + 记忆）。
   * :param {object} args: device / command / confirm / account / timeoutMs。
   * :param {object} exec: 含 agent、signal，供确认弹窗使用。
   * :param {string} [source]: 历史来源标记，默认 ai。
   * :return {Promise<object>}
   */
  async function runRemoteCommand(args, exec, source = 'ai') {
    if (args.command.trim().length === 0) throw new Error('命令不能为空')
    const config = getConfig()
    const cache = getCache()
    const target = await resolveTarget(args.device, repo, cache)
    const label = targetLabel(target)
    const allowed = await confirmExecution(exec, label, args.confirm)
    if (!allowed) {
      return {
        device: targetSummary(target),
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        declined: true,
      }
    }
    if (config.dangerPolicy !== 'never') {
      const inspection = inspectDangerousCommand(args.command)
      if (inspection.blocked) {
        return {
          device: targetSummary(target),
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          declined: true,
          blocked: true,
          blockedReason: `已拒绝执行（${inspection.category}：${inspection.reason}）`,
        }
      }
      if (inspection.dangerous) {
        const acknowledged = await confirmDangerousExecution(exec, label, inspection, args.command)
        if (!acknowledged) {
          return {
            device: targetSummary(target),
            exitCode: null,
            stdout: '',
            stderr: '',
            timedOut: false,
            declined: true,
          }
        }
      }
    }
    const config2 = {
      ...config,
      ...(args.timeoutMs !== undefined ? { defaultTimeoutMs: args.timeoutMs } : {}),
    }
    let account = args.account
    const isJumpserverTarget = target.kind === 'asset' || (target.kind === 'manual' && target.jumpserver?.configured && (!target.device?.password && !target.device?.privateKey))
    if (isJumpserverTarget) {
      await resolveJumpserverToken(ctx, target.jumpserver)
      if (!account) {
        account = await pickAssetAccount(ctx, exec, target, config2)
        if (account === null) {
          return {
            device: targetSummary(target),
            exitCode: null,
            stdout: '',
            stderr: '',
            timedOut: false,
            declined: true,
          }
        }
      }
    }
    const startedAt = Date.now()
    const result = await execOnTarget(pool, repo, target, args.command, config2, exec.signal, account)
    await recordOperation(target, args.command, result, startedAt, source, account)
    return {
      device: targetSummary(target),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    }
  }

  // ── 模型工具 ─────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'device_list',
    description: '查看已添加设备列表（重点呈现已纳管设备）以及 JumpServer 堡垒机资产概览。可通过 query 参数过滤搜索特定设备/资产。',
    parameters: {
      query: {
        type: 'string',
        description: '可选：按名称、主机地址或内网 IP 过滤设备或堡垒机资产。',
      },
      refresh: {
        type: 'boolean',
        description: '是否强制刷新堡垒机资产（默认使用缓存；堡垒机未同步过且已配置时会自动拉取）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          devices: { type: 'array', items: { type: 'object', additionalProperties: true } },
          assets: { type: 'array', items: { type: 'object', additionalProperties: true } },
          jumpserver: {
            type: 'object',
            additionalProperties: false,
            properties: {
              configured: { type: 'boolean' },
              lastSyncAt: { type: 'number' },
              total: { type: 'number' },
              error: { type: 'string' },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: renderDeviceList(value, undefined, args?.query),
      }],
    },
    async execute(args) {
      // 与 /device-list 共用清单，避免工具和斜杠两套过滤/同步
      return listDevices(args.query, args.refresh)
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.query ? `查看设备（${args.query}）` : '查看设备列表',
        kind: 'read',
        rawInput: args.query,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_find',
    description: '按内网/外网 IP 或主机地址，在已添加设备与 JumpServer 堡垒机资产中精确匹配目标。手动设备按内网 IP / 主机地址匹配；堡垒机资产按 JumpServer 登记的地址匹配，也会按操作记忆里探针采集的内网 IP 匹配（资产地址是域名或公网 IP 时同样能命中）。当你在某台设备的输出、日志、配置里发现另一台机器的 IP/地址线索、需要连过去时，先调用本工具确认该机器是否已纳入管理（避免臆造目标）。匹配到后用返回的 id 传给 device_exec。',
    parameters: {
      address: {
        type: 'string',
        required: true,
        description: '要匹配的内网 IP、外网 IP 或主机地址（如 192.168.1.10）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          matched: { type: 'boolean', required: true },
          candidates: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderFindResult(value) }],
    },
    async execute(args) {
      const needle = String(args.address ?? '').trim()
      if (!needle) throw new Error('address 不能为空')
      const candidates = []
      // 手动设备：按内网 IP / 主机地址精确匹配（不按显示名，避免误连）
      for (const device of await repo.list()) {
        if (device.lanIp === needle || device.host === needle) {
          candidates.push({
            kind: 'manual',
            id: device.id,
            name: device.name,
            address: device.host,
            protocol: device.protocol,
            port: device.port,
            match: device.lanIp === needle ? 'lanIp' : 'host',
            ...(device.lanIp ? { lanIp: device.lanIp } : {}),
            ...(device.group ? { group: device.group } : {}),
            ...(device.jumpHost ? { viaJumpHost: true } : {}),
          })
        }
      }
      // 堡垒机资产：先按 JumpServer 登记的 address 精确匹配；
      // 再按操作记忆里探针采集的内网 IP 匹配（资产地址是域名/公网 IP 时也能命中）
      for (const asset of getCache().assets ?? []) {
        let match = null
        let probedLanIp = ''
        if (asset.address === needle) {
          match = 'address'
        } else {
          const env = await repo.envOf(`asset:${asset.id}`)
          if (env?.lanip === needle) {
            match = 'lanIp(探针)'
            probedLanIp = env.lanip
          }
        }
        if (!match) continue
        candidates.push({
          kind: 'asset',
          id: asset.id,
          name: asset.name,
          address: asset.address,
          protocols: asset.protocols?.map((p) => `${p.name}:${p.port}`) ?? [],
          match,
          ...(probedLanIp ? { lanIp: probedLanIp } : {}),
          ...(asset.platform ? { platform: asset.platform } : {}),
          ...(asset.orgName ? { orgName: asset.orgName } : {}),
        })
      }
      return { query: needle, matched: candidates.length > 0, candidates }
    },
    presentCall(args) {
      return { card: 'generic', title: `按地址匹配设备（${args.address}）`, kind: 'read', rawInput: args.address }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_exec',
    description: '在指定远程设备（已添加的 SSH/Telnet 服务器，或已对接的 JumpServer 堡垒机资产）上执行一条命令并返回输出。连接会跨命令复用（持久会话池）。用 device 参数传设备 ID、名称或主机地址。默认情况下，本会话内首次在该设备上执行时会向用户请求一次确认（确认后可带 confirm: "no" 跳过后续询问）。危险命令（重启/删数据/改网络/清配置等）会强制弹出确认，无法跳过。',
    parameters: {
      device: {
        type: 'string',
        required: true,
        description: '目标设备：device_list 返回的设备 ID、名称或主机地址。',
      },
      command: {
        type: 'string',
        required: true,
        description: '要执行的远程命令。',
      },
      timeoutMs: {
        type: 'number',
        description: '超时毫秒数。默认取设备配置。',
      },
      confirm: {
        type: 'string',
        enum: ['auto', 'yes', 'no'],
        description: '确认策略：auto 按全局策略（本会话内每台设备首次询问）；yes 每次都询问用户；no 跳过询问。',
      },
      account: {
        type: 'string',
        description: '堡垒机资产的登录账号名称（可选；缺省时若资产有多个账号会弹窗让用户选择，本会话内记住选择）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          device: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' }, name: { type: 'string' }, host: { type: 'string' }, protocol: { type: 'string' },
            },
          },
          exitCode: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          timedOut: { type: 'boolean', required: true },
          declined: { type: 'boolean' },
          blocked: { type: 'boolean' },
          blockedReason: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderExecResult(value),
      }],
    },
    async execute(args, exec) {
      // 与 /device-exec 共用确认、护栏和记忆
      return runRemoteCommand(args, exec, 'ai')
    },
    presentCall(args) {
      return {
        card: 'terminal',
        title: args.command,
        description: `在设备「${args.device}」上执行`,
      }
    },
    presentResult(_args, value) {
      const output = [value.stdout, value.stderr && `[stderr]\n${value.stderr}`].filter(Boolean).join('\n')
      return {
        card: 'terminal',
        output: output || '(无输出)',
        ...(value.exitCode !== null && value.exitCode !== undefined ? { exitCode: value.exitCode } : {}),
      }
    },
  }))

  // ── SFTP 文件工具（AI 读配置/改配置，复用会话池连接） ────────────────
  /** 取目标上可用于 sftp 的 ssh 会话（telnet 目标不支持）。 */
  async function withSftpSession(target, config, account, fn) {
    if (target.kind === 'manual' && target.device.protocol === 'telnet') {
      throw new Error('Telnet 设备不支持文件读写（仅 SSH）')
    }
    const factory = targetPoolFactory(target, config, account, repo)
    return pool.withSession(factory.key, factory, async (entry) => {
      if (entry?.mode === 'terminal') {
        throw new Error('当前连接运行于终端交互模式，无法开启 SFTP 通道；请使用 device_exec 通过 cat / echo 读写文件。')
      }
      if (entry?.mode === 'telnet') {
        throw new Error('Telnet 设备不支持 SFTP 文件读写')
      }
      const rawSession = entry?.session || entry
      return fn(rawSession)
    })
  }

  ctx.tools.register(defineTool({
    name: 'device_read_file',
    description: '读取远程 SSH 设备上的文本文件内容（经 SFTP 复用已有连接，适合读配置/日志）。默认上限 1MB；二进制文件请勿使用本工具。读取 /etc/passwd、shadow、sudoers 会附加 warning，不拦截。',
    parameters: {
      device: { type: 'string', required: true, description: '目标设备：device_list 返回的设备 ID、名称或主机地址（仅 SSH）。' },
      path: { type: 'string', required: true, description: '远程文件绝对路径。' },
      maxBytes: { type: 'number', description: '读取上限（字节），默认 1048576，最大 2097152。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          size: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          warning: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          value.warning ? `⚠️ ${value.warning}` : '',
          value.truncated ? `${value.content}\n…[文件共 ${value.size} 字符，已截断]…` : value.content,
        ].filter(Boolean).join('\n\n'),
      }],
    },
    async execute(args, exec) {
      const config = getConfig()
      const cache = getCache()
      const target = await resolveTarget(args.device, repo, cache)
      let account = args.account
      if (target.kind === 'asset') {
        await resolveJumpserverToken(ctx, target.jumpserver)
        if (!account) {
          account = await pickAssetAccount(ctx, exec, target, config)
          if (account === null) throw new Error('用户取消了账号选择')
        }
      }
      const maxBytes = Math.min(args.maxBytes ?? 1024 * 1024, 2 * 1024 * 1024)
      const result = await withSftpSession(target, config, account, (session) =>
        sftpReadFile(session, args.path, { maxBytes }))
      // 读到 passwd/shadow/sudoers 只告警不拦截，避免 AI 把凭据原文回显
      const readRisk = inspectSensitiveReadPath(args.path)
      if (readRisk.sensitive) result.warning = readRisk.reason
      await repo.recordHistory({
        deviceId: targetKey(target),
        deviceName: targetLabel(target),
        protocol: target.kind === 'manual' ? target.device.protocol : 'ssh',
        command: `read ${args.path}`,
        exitCode: 0,
        timedOut: false,
        stdout: `${result.content.slice(0, 200)}${result.truncated ? '…' : ''}`,
        stderr: '',
        source: 'sftp',
      }).catch(() => undefined)
      return result
    },
    presentCall(args) {
      return { card: 'generic', title: `读取远程文件（${args.device}）`, kind: 'read', rawInput: args.path }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_write_file',
    description: '向远程 SSH 设备写入文本文件内容（经 SFTP 复用已有连接，覆盖式写入）。写入系统目录会强制确认；写入系统关键文件（passwd/shadow/sudoers 等）会被硬墙拒绝。默认上限 1MB。',
    parameters: {
      device: { type: 'string', required: true, description: '目标设备：device_list 返回的设备 ID、名称或主机地址（仅 SSH）。' },
      path: { type: 'string', required: true, description: '远程文件绝对路径。' },
      content: { type: 'string', required: true, description: '要写入的完整文件内容。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          written: { type: 'number', required: true },
          blocked: { type: 'boolean' },
          declined: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.blocked ? value.reason
          : value.declined ? '用户取消了写入'
            : `已写入 ${value.written} 字符`,
      }],
    },
    async execute(args, exec) {
      // 写路径护栏：系统关键文件硬拒绝；系统目录强制确认
      const inspection = inspectWritePath(args.path)
      if (inspection.level === 'blocked') {
        return { written: 0, blocked: true, reason: inspection.reason }
      }
      const config = getConfig()
      const cache = getCache()
      const target = await resolveTarget(args.device, repo, cache)
      const label = targetLabel(target)
      if (inspection.level === 'dangerous') {
        const confirmed = await confirmDangerousExecution(
          exec, label,
          { category: '系统破坏', reason: inspection.reason },
          `写入文件 ${args.path}`,
        )
        if (!confirmed) return { written: 0, declined: true }
      }
      let account = args.account
      if (target.kind === 'asset') {
        await resolveJumpserverToken(ctx, target.jumpserver)
        if (!account) {
          account = await pickAssetAccount(ctx, exec, target, config)
          if (account === null) throw new Error('用户取消了账号选择')
        }
      }
      const result = await withSftpSession(target, config, account, (session) =>
        sftpWriteFile(session, args.path, args.content))
      await repo.recordHistory({
        deviceId: targetKey(target),
        deviceName: label,
        protocol: target.kind === 'manual' ? target.device.protocol : 'ssh',
        command: `write ${args.path}`,
        exitCode: 0,
        timedOut: false,
        stdout: `已写入 ${result.written} 字符`,
        stderr: '',
        source: 'sftp',
      }).catch(() => undefined)
      return result
    },
    presentCall(args) {
      return { card: 'generic', title: `写入远程文件（${args.device}）`, kind: 'write', rawInput: args.path }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_test',
    description: '测试到指定远程设备的连通性（建立连接并执行一条探测命令，不产生业务影响）。',
    parameters: {
      device: {
        type: 'string',
        required: true,
        description: '目标设备：device_list 返回的设备 ID、名称或主机地址。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const config = getConfig()
      const cache = getCache()
      const target = await resolveTarget(args.device, repo, cache)
      let account
      const isJumpserverTarget = target.kind === 'asset' || (target.kind === 'manual' && target.jumpserver?.configured && (!target.device?.password && !target.device?.privateKey))
      if (isJumpserverTarget) {
        account = await pickAssetAccount(ctx, exec, target, config)
        if (account === null) return { ok: false, message: '用户取消了账号选择' }
      }
      const result = await testTarget(pool, repo, target, config, exec.signal, account)
      let extraInfo = ''
      if (result.ok) {
        // 连通成功时顺带执行环境探针，自动采集并持久化内网 IP 与主机事实
        try {
          const env = await probeEnv(pool, repo, target, config, exec.signal, account)
          if (env && Object.keys(env).length > 0) {
            await repo.saveEnv(targetKey(target), env)
            if (target.kind === 'manual' && env.lanip && !target.device.lanIp) {
              await repo.upsert({ ...target.device, lanIp: env.lanip })
            }
            const parts = []
            if (env.lanip) parts.push(`内网IP: ${env.lanip}`)
            if (env.host) parts.push(`主机名: ${env.host}`)
            if (env.os) parts.push(`系统: ${env.os}`)
            if (env.user) parts.push(`用户: ${env.user}`)
            if (parts.length > 0) extraInfo = `（已采集环境：${parts.join('，')}）`
          }
        } catch {
          // 探针失败不影响连通性结果
        }
      }
      const finalMsg = `${result.message}${extraInfo}`
      await repo.recordHistory({
        deviceId: targetKey(target),
        deviceName: targetLabel(target),
        protocol: target.kind === 'manual' ? target.device.protocol : (target.asset.protocols?.[0]?.name || 'ssh'),
        command: '<device_test 连通性测试>',
        exitCode: result.ok ? 0 : null,
        timedOut: false,
        stdout: finalMsg,
        stderr: '',
        source: 'test',
      }).catch(() => undefined)
      return { ok: result.ok, message: finalMsg }
    },
    presentCall(args) {
      return { card: 'generic', title: `测试设备连接（${args.device}）`, kind: 'execute', rawInput: args.device }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_memory',
    description: '查询设备的持久化记忆：环境信息（探针采集的主机名/系统/内核/用户/工作目录/内网IP等）与最近的操作历史（每次 device_exec 的命令、退出码、时间、输出摘要）。手动设备和堡垒机资产都可查询。在需要了解"这台机器之前做过什么、环境是什么、上次结果如何"时使用。',
    parameters: {
      device: {
        type: 'string',
        description: '目标设备（ID、名称或主机地址）。缺省时返回所有设备的环境与最近操作概览。',
      },
      limit: {
        type: 'number',
        description: '每台设备返回的操作历史条数，默认 5，最大 20。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                deviceId: { type: 'string', required: true },
                deviceName: { type: 'string', required: true },
                env: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
                history: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
                  command: { type: 'string', required: true },
                  exitCode: { oneOf: [{ type: 'number' }, { type: 'null' }] },
                  timedOut: { type: 'boolean' },
                  stdout: { type: 'string', required: true },
                  stderr: { type: 'string', required: true },
                  startedAt: { type: 'number', required: true },
                  source: { type: 'string' },
                } } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderMemory(value),
      }],
    },
    async execute(args) {
      // 与 /device-memory 共用探针/历史查询
      return queryMemories(args.device, args.limit)
    },
    presentCall(args) {
      return { card: 'generic', title: args.device ? `查看设备记忆（${args.device}）` : '查看设备记忆总览', kind: 'read', rawInput: args.device }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_add',
    description: '添加一台设备到「已添加设备」列表。支持两种方式：1) 手动录入 SSH/Telnet 设备；2) 从堡垒机资产导入（传入 fromAsset: 资产名称或ID）。密码/私钥与配置会安全保存在本地 DSH 存储中。',
    parameters: {
      fromAsset: { type: 'string', description: '可选：要导入的堡垒机资产名称、ID 或主机地址。如果提供，将自动提取该资产的名称、地址、协议与端口并纳管为已添加设备。' },
      name: { type: 'string', description: '设备显示名称（fromAsset 时可选，默认取资产名）。' },
      host: { type: 'string', description: '主机地址（fromAsset 时可选，默认取资产地址）。' },
      lanIp: { type: 'string', description: '内网 IP（可选）。用于跨机排查时按 IP 精确匹配；留空会在首次执行命令时由环境探针自动回填。' },
      protocol: { type: 'string', enum: ['ssh', 'telnet'], description: '协议，默认 ssh。' },
      port: { type: 'number', description: '端口，默认 ssh=22 / telnet=23。' },
      username: { type: 'string', description: '登录用户名（telnet 必填）。' },
      authType: { type: 'string', enum: ['password', 'privateKey'], description: '认证方式，默认 password。' },
      password: { type: 'string', description: '登录密码（authType=password 时）。' },
      privateKey: { type: 'string', description: '私钥内容（authType=privateKey 时，PEM 格式）。' },
      privateKeyPath: { type: 'string', description: '私钥文件在运行 dsh 的机器上的绝对路径（可选，与 privateKey 二选一；读取后内容会持久化保存，路径本身不保存）。' },
      passphrase: { type: 'string', description: '私钥口令（可选）。' },
      group: { type: 'string', description: '分组名称（可选）。' },
      encoding: { type: 'string', enum: ['utf8', 'gbk', 'latin1', 'utf16le'], description: '输出编码，默认 utf8。' },
      promptRegex: { type: 'string', description: 'telnet 设备的命令提示符正则（可选）。' },
      jumpHost: {
        type: 'object',
        additionalProperties: false,
        description: '跳板机配置（可选）。',
        properties: {
          host: { type: 'string', required: true },
          port: { type: 'number' },
          username: { type: 'string', required: true },
          authType: { type: 'string', enum: ['password', 'privateKey'] },
          password: { type: 'string' },
          privateKey: { type: 'string' },
          passphrase: { type: 'string' },
        },
      },
      comment: { type: 'string', description: '备注（可选）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已添加设备：${value.name}（ID: ${value.id}）` }],
    },
    async execute(args) {
      let input = { ...args }
      const assetTarget = args.fromAsset || (!args.host && args.name ? args.name : null)
      if (assetTarget) {
        const cache = getCache()
        const found = (cache.assets ?? []).find(
          (a) => a.id === assetTarget || a.name === assetTarget || a.address === assetTarget || a.id === `js-${assetTarget}`,
        ) || (cache.assets ?? []).find(
          (a) => a.name.toLowerCase().includes(assetTarget.toLowerCase()) || a.address.includes(assetTarget),
        )
        if (found) {
          const proto = found.protocols?.[0]?.name === 'telnet' ? 'telnet' : 'ssh'
          const port = found.protocols?.[0]?.port || (proto === 'telnet' ? 23 : 22)
          input = {
            id: `js-${found.id}`,
            name: args.name || found.name,
            host: args.host || found.address,
            protocol: args.protocol || proto,
            port: args.port || port,
            username: args.username || '',
            authType: args.authType || 'password',
            source: 'jumpserver',
            assetId: found.id,
            comment: args.comment || found.comment || 'Imported from JumpServer',
            ...(args.group ? { group: args.group } : {}),
            ...(args.password ? { password: args.password } : {}),
            ...(args.lanIp ? { lanIp: args.lanIp } : {}),
          }
        } else if (args.fromAsset) {
          throw new Error(`未在堡垒机资产缓存中找到「${args.fromAsset}」（可用 device_list 查看或 jumpserver_sync 重新同步）`)
        }
      }

      if (!input.name) throw new Error('设备名称不能为空')
      if (!input.host) throw new Error('主机地址不能为空')
      if (input.protocol === 'telnet' && !input.username) throw new Error('telnet 设备必须填写用户名')

      if (input.privateKeyPath && !input.privateKey) {
        try {
          const stat = statSync(input.privateKeyPath)
          if (!stat.isFile()) throw new Error('不是普通文件')
          if (stat.size > 128 * 1024) throw new Error('文件过大（>128KB）')
          input.privateKey = readFileSync(input.privateKeyPath, 'utf8')
        } catch (error) {
          throw new Error(`读取私钥文件失败：${error?.message ?? error}`)
        }
      }
      delete input.privateKeyPath
      delete input.fromAsset
      const device = await repo.upsert(input)
      return { id: device.id, name: device.name }
    },
    presentCall(args) {
      return { card: 'generic', title: `添加设备「${args.name || args.fromAsset}」`, kind: 'write', rawInput: { host: args.host, fromAsset: args.fromAsset, protocol: args.protocol || 'ssh' } }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'device_remove',
    description: '从「已添加设备」列表中移除指定设备（不影响堡垒机资产池）。',
    parameters: {
      device: { type: 'string', required: true, description: '设备 ID、名称或主机地址。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `已移除设备：${value.removed}` }],
    },
    async execute(args) {
      const device = await repo.find(args.device)
      if (!device) throw new Error(`未找到设备「${args.device}」`)
      await repo.remove(device.id)
      return { removed: device.name }
    },
    presentCall(args) {
      return { card: 'generic', title: `移除设备（${args.device}）`, kind: 'write', rawInput: args.device }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'jumpserver_sync',
    description: '从已对接的 JumpServer 堡垒机拉取最新资产列表并刷新缓存。执行前请先确认堡垒机已在设置（device 命名空间）中配置。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'number', required: true },
          lastSyncAt: { type: 'number', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `同步失败：${value.error}`
          : `已同步 ${value.total} 个堡垒机资产（可用 device_list 查看）`,
      }],
    },
    async execute() {
      // 与 /jumpserver-sync 共用资产拉取
      return syncJumpServerAssets()
    },
    presentCall() {
      return { card: 'generic', title: '同步 JumpServer 资产', kind: 'read' }
    },
  }))

  /** 执行一次资产同步并写入缓存命名空间。 */
  async function syncAssets(jumpserver, scope, config) {
    await resolveJumpserverToken(ctx, jumpserver)
    if (!scope) {
      const assets = await jumpserver.syncAssets()
      return { total: assets.length, lastSyncAt: Date.now(), assets }
    }
    try {
      const assets = await jumpserver.syncAssets()
      const total = assets.length
      const lastSyncAt = Date.now()
      await scope.replace({ assets, total, lastSyncAt, error: '' })
      if (repo && config.jumpserverUrl) {
        try {
          await repo.saveBastion({
            url: config.jumpserverUrl,
            username: config.jumpserverUsername,
            defaultAccount: config.jumpserverDefaultAccount,
            rejectUnauthorized: config.jumpserverRejectUnauthorized !== false,
            lastSyncAt,
            totalAssets: total,
            lastUsedAt: Date.now(),
          })
        } catch { /* 历史记录保存失败静默 */ }
      }
      return { total, lastSyncAt }
    } catch (error) {
      const message = JumpServerClient.formatError(error)
      await scope.update({ error: message })
      return { total: 0, lastSyncAt: 0, error: message }
    }
  }

  // ── 系统提示词片段 ───────────────────────────────────────────────────
  // AI 安全红线：负 order 使其排在 persona（order 0）之前、紧跟 harness
  // 身份（-100）之后——所有其他工具规则与提示词都在它后面，即最高优先级。
  // text 用动态 provider：每次组装时读取当前 settings 的 safetyRules，
  // 面板保存或手改 settings.yaml 热加载后，下一次模型请求立即生效。
  ctx.systemPrompt.section({
    name: 'device-safety',
    order: -20,
    text: () => {
      const rules = String(getConfig().safetyRules ?? '').trim()
      return rules === '' ? DEFAULT_SAFETY_RULES : rules
    },
  })
  ctx.systemPrompt.section({
    name: 'device-ops',
    order: 106,
    text: [
      '你有远程设备运维能力（dsh-device 插件）。设备管理体系规则：',
      '1. 【已添加设备】：当前已正式纳入管理的设备列表（用户添加或从堡垒机导入）。',
      '2. 【堡垒机资产池】：从 JumpServer 堡垒机对接同步的只读资产清单，供按需查找与纳管。',
      '3. 当用户询问"有哪些设备"时，调用 device_list，优先完整列出「已添加设备」；堡垒机资产池会自动以概览呈现，若用户需要找特定机器可用 device_list({ query }) 或 device_find 精确检索。',
      '4. 当用户要求把某台堡垒机资产纳入管理时，调用 device_add({ fromAsset: 资产名称或ID }) 即可一键添加到「已添加设备」。',
      '5. 需要在远程设备上执行命令时使用 device_exec；多账号资产会自动弹窗或提示选择账号。',
      '6. 当在设备输出、日志或配置中发现另一台机器的 IP/地址线索时，用 device_find 按内网/外网 IP 精确匹配；匹配到再连过去，匹配不到先询问用户，不要臆造目标或凭据。',
      '7. 设备有持久化记忆：操作前可用 device_memory 查看该机器的环境信息与上次操作结果，避免重复探测。',
      '8. 读写远程文件用 device_read_file / device_write_file（SFTP）。',
    ].join('\n'),
  })

  // ── 运维 skills（可选服务） ──────────────────────────────────────────
  ctx.inject(['skills'], (sctx) => {
    const disposers = []
    for (const skill of loadBundledSkills()) {
      try {
        disposers.push(sctx.skills.register(skill))
      } catch {
        // 重名等注册失败不阻断插件
      }
    }
    sctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    })
  })

  // ── 斜杠命令（可选服务：commands 就绪后出现在输入框 / 菜单） ────────
  ctx.inject(['commands'], (sctx) => {
    /**
     * 业务函数包成斜杠命令结果，异常变成 kind:error 文案。
     * :param {function} run: 返回展示文本。
     * :return {function}
     */
    const asCommand = (run) => async (invocation) => {
      try {
        return { kind: 'success', text: await run(invocation) }
      } catch (error) {
        return { kind: 'error', text: error?.message || String(error) }
      }
    }

    const disposers = []
    /**
     * 按当前界面语言注册斜杠备注；切语言时卸掉再挂。
     * :return {void}
     */
    const registerCommands = () => {
      refreshT()
      while (disposers.length) disposers.pop()()
      disposers.push(sctx.commands.register({
        name: 'device-list',
        description: t('cmd.list.desc'),
        input: { hint: t('cmd.list.hint') },
        handler: asCommand(async (invocation) => {
          const raw = String(invocation.rawInput || '').trim()
          const refresh = raw.toLowerCase() === 'refresh'
          const value = await listDevices(refresh ? '' : raw, refresh)
          return renderDeviceList(value, t)
        }),
      }))
      disposers.push(sctx.commands.register({
        name: 'device-exec',
        description: t('cmd.exec.desc'),
        input: { hint: t('cmd.exec.hint') },
        handler: asCommand(async (invocation) => {
          const raw = String(invocation.rawInput || '').trim()
          const split = /^(\S+)\s+([\s\S]+)$/.exec(raw)
          if (!split) throw new Error(t('cmd.exec.usage'))
          const value = await runRemoteCommand(
            { device: split[1], command: split[2].trim() },
            { agent: invocation.agent, signal: invocation.signal },
            'slash',
          )
          return renderExecResult(value, t)
        }),
      }))
      disposers.push(sctx.commands.register({
        name: 'jumpserver-sync',
        description: t('cmd.sync.desc'),
        handler: asCommand(async () => {
          const result = await syncJumpServerAssets()
          return t('cmd.sync.ok', { total: result.total })
        }),
      }))
      disposers.push(sctx.commands.register({
        name: 'device-memory',
        description: t('cmd.memory.desc'),
        input: { hint: t('cmd.memory.hint') },
        handler: asCommand(async (invocation) => {
          const selector = String(invocation.rawInput || '').trim()
          const value = await queryMemories(selector || undefined, 5)
          return renderMemory(value)
        }),
      }))
    }
    reregisterCommands = registerCommands
    registerCommands()
    const unsub = typeof ctx.get('locale')?.subscribe === 'function'
      ? ctx.get('locale').subscribe(registerCommands)
      : undefined
    sctx.effect(() => () => {
      unsub?.()
      while (disposers.length) disposers.pop()()
    })
  })

  // ── 浏览器面板 HTTP 路由（可选服务：webServer 就绪后才挂载） ────────
  // 注意：dsh-client-modules 已注册 /plugins 前缀路由（客户端 bundle 服务），
  // 本插件的路由必须等 webServer 服务存在后以 exact 路由注册（exact 优先
  // 于前缀匹配），并用 ctx.inject 挂载以保证时序。
  ctx.inject(['webServer'], (sctx) => {
    const webServer = sctx.webServer
    const routes = []
    // webserver 要求 (kind, path) 唯一，因此同一路径只注册一条 exact 路由，
    // 在其内部按 HTTP 方法分发。
    const routeTable = new Map() // path → { method: handler }
    const addRoute = (method, path, handler) => {
      const entry = routeTable.get(path) ?? { handlers: new Map() }
      entry.handlers.set(method, handler)
      routeTable.set(path, entry)
    }
    const mount = () => {
      for (const [path, entry] of routeTable) {
        routes.push(webServer.register({
          kind: 'exact',
          path: `/plugins/device${path}`,
          handler: async (req, res) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            if (!isTrustedRequest(req)) {
              res.statusCode = 403
              res.end(JSON.stringify({ ok: false, error: t('http.untrusted') }))
              return
            }
            let out
            try {
              const handler = entry.handlers.get(req.method)
              if (!handler) {
                out = jsonError(405, t('http.badMethod', { method: req.method }))
              } else {
                out = await handler(req, res)
              }
            } catch (error) {
              out = jsonError(400, error?.message || String(error))
            }
            res.statusCode = out.status
            res.end(JSON.stringify(out.body))
          },
        }))
      }
    }

    addRoute('GET', '/i18n', async () => jsonOk(200, { zh: MESSAGES.zh, en: MESSAGES.en }))

    addRoute('GET', '/devices', async () => {
      const devices = await repo.list()
      const views = []
      for (const device of devices) {
        const history = await repo.historyOf(device.id)
        const last = history[0]
        views.push({
          ...publicView(device),
          ...(last ? {
            lastOp: {
              command: last.command,
              exitCode: last.exitCode,
              timedOut: Boolean(last.timedOut),
              startedAt: last.startedAt,
            },
          } : {}),
        })
      }
      return jsonOk(200, { devices: views })
    })
    addRoute('PUT', '/devices', async (req) => {
      const body = await readJsonBody(req)
      const device = await repo.upsert(body.device ?? body)
      return jsonOk(200, { device: publicView(device) })
    })
    addRoute('POST', '/devices', async (req) => {
      const body = await readJsonBody(req)
      const device = await repo.upsert(body.device ?? body)
      return jsonOk(200, { device: publicView(device) })
    })
    addRoute('POST', '/devices/batch', async (req) => {
      const body = await readJsonBody(req)
      const list = Array.isArray(body.devices) ? body.devices : []
      const imported = []
      for (const item of list) {
        try {
          const device = await repo.upsert(item)
          imported.push(publicView(device))
        } catch (err) {
          ctx.logger?.warn('批量导入设备单项失败: %s', err?.message ?? err)
        }
      }
      return jsonOk(200, { imported, count: imported.length })
    })
    addRoute('POST', '/devices/batch-update', async (req) => {
      const body = await readJsonBody(req)
      const ids = Array.isArray(body.ids) ? body.ids : []
      const patch = body.patch || {}
      if (ids.length === 0) return jsonError(400, '未选择要更新的设备')
      const updated = []
      for (const id of ids) {
        const existing = await repo.find(id)
        if (!existing) continue
        const next = { ...existing }
        for (const [key, val] of Object.entries(patch)) {
          if (val !== undefined && !['id', 'secretFlags', 'hasPassword', 'hasPrivateKey'].includes(key)) {
            next[key] = val
          }
        }
        if (patch.password !== undefined) {
          next.password = patch.password
        }
        if (patch.privateKey !== undefined) {
          next.privateKey = patch.privateKey
        }
        if (patch.passphrase !== undefined) {
          next.passphrase = patch.passphrase
        }
        try {
          const saved = await repo.upsert(next)
          updated.push(publicView(saved))
        } catch (err) {
          ctx.logger?.warn('批量更新设备单项失败 (%s): %s', id, err?.message ?? err)
        }
      }
      return jsonOk(200, { updated, count: updated.length })
    })
    addRoute('POST', '/devices/batch-delete', async (req) => {
      const body = await readJsonBody(req)
      const ids = Array.isArray(body.ids) ? body.ids : []
      if (ids.length === 0) return jsonError(400, '未选择要删除的设备')
      const deleted = []
      for (const id of ids) {
        try {
          await repo.remove(id)
          deleted.push(id)
        } catch (err) {
          ctx.logger?.warn('批量删除设备单项失败 (%s): %s', id, err?.message ?? err)
        }
      }
      return jsonOk(200, { deleted, count: deleted.length })
    })
    // 注意：webserver 的 exact 路由按字面路径匹配（无 :id 参数模式），
    // 且 pathname 是百分号编码的，所以按 id 的操作走 JSON body / query。
    addRoute('DELETE', '/devices', async (req) => {
      const body = await readJsonBody(req)
      const id = String(body.id ?? (new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? ''))
      if (!id) return jsonError(400, t('http.missingId'))
      await repo.remove(id)
      return jsonOk(200, { removed: id })
    })
    addRoute('POST', '/devices/test', async (req) => {
      const body = await readJsonBody(req)
      const device = await repo.find(body.id)
      if (!device) return jsonError(404, t('http.notFoundDevice', { id: body.id }))
      const cache = getCache()
      const isJumpserver = device.source === 'jumpserver' || device.assetId || device.id.startsWith('js-')
      const target = { kind: 'manual', device, jumpserver: isJumpserver ? cache?.client : null }
      const result = await testTarget(pool, repo, target, getConfig(), undefined)
      return jsonOk(200, result)
    })
    // 手动探测一台设备的内网 IP（环境探针），并回填设备记录（面板添加/编辑后调用）
    addRoute('POST', '/probe', async (req) => {
      const body = await readJsonBody(req)
      const device = await repo.find(body.id)
      if (!device) return jsonError(404, t('http.notFoundDevice', { id: body.id }))
      const config = getConfig()
      const cache = getCache()
      const isJumpserver = device.source === 'jumpserver' || device.assetId || device.id.startsWith('js-')
      const target = { kind: 'manual', device, jumpserver: isJumpserver ? cache?.client : null }
      const env = await probeEnv(pool, repo, target, config, undefined)
      await repo.saveEnv(targetKey(target), env)
      if (env.lanip) await repo.updateLanIp(device.id, env.lanip)
      return jsonOk(200, { ok: true, lanIp: env.lanip ?? '', ...(env.host ? { host: env.host } : {}), ...(env.os ? { os: env.os } : {}) })
    })
    addRoute('POST', '/exec', async (req) => {
      const body = await readJsonBody(req)
      if (!body.device || !body.command) return jsonError(400, t('http.missingDeviceOrCommand'))
      const config = { ...getConfig(), ...(body.timeoutMs ? { defaultTimeoutMs: body.timeoutMs } : {}) }
      const cache = getCache()
      const target = await resolveTarget(body.device, repo, cache)
      // 面板路径对齐 AI：confirmPolicy=auto 时每台设备本进程会话只确认一次
      if (config.confirmPolicy !== 'never') {
        const key = targetKey(target)
        const remembered = panelApproved.has(key)
        if (config.confirmPolicy === 'always' || !remembered) {
          if (body.firstConfirmed !== true) {
            return jsonOk(200, {
              needFirstConfirm: true,
              remember: config.confirmPolicy === 'auto',
              device: targetSummary(target),
            })
          }
          if (config.confirmPolicy === 'auto') panelApproved.add(key)
        }
      }
      // 危险命令护栏：blocked 硬拒绝；dangerous 需面板显式确认（dangerConfirmed: true）
      if (config.dangerPolicy !== 'never') {
        const inspection = inspectDangerousCommand(body.command)
        if (inspection.blocked) {
          return jsonOk(200, {
            blocked: true,
            category: inspection.category,
            reason: inspection.reason,
            command: body.command,
            device: targetSummary(target),
          })
        }
        if (inspection.dangerous && body.dangerConfirmed !== true) {
          return jsonOk(200, {
            dangerous: true,
            category: inspection.category,
            reason: inspection.reason,
            command: body.command,
            device: targetSummary(target),
          })
        }
      }
      let account = body.account
      if (target.kind === 'asset') {
        await resolveJumpserverToken(ctx, target.jumpserver)
        if (!account) {
          // 面板路径：不弹 host 侧问题，返回可用账号列表让前端弹窗选择
          let accounts = await target.jumpserver.accounts(target.asset.id).catch(() => [])
          if (accounts.length === 0 && Array.isArray(target.asset.accounts) && target.asset.accounts.length > 0) {
            accounts = target.asset.accounts
          }
          if (accounts.length > 1) {
            return jsonOk(200, { needAccount: true, accounts, device: targetSummary(target) })
          }
          account = accounts[0]?.name ?? accounts[0]?.username ?? accounts[0]?.id ?? (config.jumpserverDefaultAccount || undefined)
        }
      }
      const result = await execOnTarget(pool, repo, target, body.command, config, undefined, account)
      // 记忆：面板执行也记录历史 + 环境探针
      await recordOperation(target, body.command, result, Date.now(), 'panel', account).catch(() => undefined)
      return jsonOk(200, { result, device: targetSummary(target) })
    })
    addRoute('GET', '/pool', async () => {
      return jsonOk(200, { size: pool.size, sessions: pool.stats() })
    })
    addRoute('POST', '/memory', async (req) => {
      const body = await readJsonBody(req)
      const devices = await repo.list()
      const targets = body.device
        ? devices.filter((device) =>
            device.id === body.device || device.name === body.device || device.host === body.device)
        : devices
      const memories = []
      for (const device of targets) {
        const env = await repo.envOf(device.id)
        const history = await repo.historyOf(device.id)
        memories.push({
          deviceId: device.id,
          deviceName: device.name,
          env: env ?? null,
          history,
        })
      }
      // 堡垒机资产也有记忆（键 asset:<id>），一并返回
      const cache = getCache()
      const assets = body.device
        ? (cache.assets ?? []).filter((asset) =>
            asset.id === body.device || asset.name === body.device || asset.address === body.device)
        : []
      for (const asset of assets) {
        const key = `asset:${asset.id}`
        const env = await repo.envOf(key)
        const history = await repo.historyOf(key)
        if (env || history.length > 0) {
          memories.push({ deviceId: key, deviceName: `${asset.name}（堡垒机资产）`, env: env ?? null, history })
        }
      }
      return jsonOk(200, { memories })
    })
    addRoute('POST', '/assets/accounts', async (req) => {
      const body = await readJsonBody(req)
      const cache = getCache()
      const asset = (cache.assets ?? []).find((candidate) => candidate.id === body.assetId || candidate.name === body.assetId)
      if (!asset) return jsonError(404, t('http.notFoundAsset', { id: body.assetId }))
      const jumpserver = buildJumpServer(getConfig())
      if (!jumpserver?.configured) return jsonError(400, t('http.jmsUnconfigured'))
      try {
        await resolveJumpserverToken(ctx, jumpserver)
        const accounts = await jumpserver.accounts(asset.id)
        return jsonOk(200, { accounts })
      } catch (error) {
        return jsonError(502, JumpServerClient.formatError(error))
      }
    })
    addRoute('POST', '/read-file', async (req) => {
      const body = await readJsonBody(req)
      let path = String(body.path || '').trim()
      if (!path) return jsonError(400, t('http.missingPath'))
      if (path === '~') path = homedir()
      else if (path.startsWith('~/') || path.startsWith('~\\')) path = join(homedir(), path.slice(2))
      try {
        const stat = statSync(path)
        if (!stat.isFile()) return jsonError(400, t('http.notFile'))
        if (stat.size > 128 * 1024) return jsonError(400, t('http.fileTooLarge'))
        const content = readFileSync(path, 'utf8')
        return jsonOk(200, { path, size: stat.size, content })
      } catch (error) {
        return jsonError(400, t('http.readFailed', { error: error?.message ?? error }))
      }
    })
    addRoute('POST', '/sync', async () => {
      const jumpserver = buildJumpServer(getConfig())
      if (!jumpserver?.configured) return jsonError(400, t('http.jmsUnconfigured'))
      const result = await syncAssets(jumpserver, cacheScope, getConfig())
      if (result.error) return jsonError(502, result.error)
      return jsonOk(200, result)
    })
    addRoute('GET', '/config', async () => {
      const config = getConfig()
      return jsonOk(200, {
        config: {
          jumpserverUrl: config.jumpserverUrl,
          jumpserverUsername: config.jumpserverUsername,
          hasPassword: Boolean(config.jumpserverPassword),
          jumpserverSshPort: config.jumpserverSshPort || 2222,
          jumpserverDefaultAccount: config.jumpserverDefaultAccount,
          jumpserverRejectUnauthorized: config.jumpserverRejectUnauthorized,
          confirmPolicy: config.confirmPolicy,
          dangerPolicy: config.dangerPolicy,
          safetyRules: config.safetyRules || DEFAULT_SAFETY_RULES,
          defaultTimeoutMs: config.defaultTimeoutMs,
          maxOutputChars: config.maxOutputChars,
        },
      })
    })
    // 面板写配置：逐字段更新 settings 用户层（留空的密码保持不变）
    addRoute('POST', '/config', async (req) => {
      const body = await readJsonBody(req)
      if (!deviceScope) return jsonError(503, t('http.settingsUnavailable'))
      if (body.jumpserverUrl !== undefined) {
        const raw = String(body.jumpserverUrl || '').trim()
        if (raw && !raw.startsWith('http://') && !raw.startsWith('https://')) {
          return jsonError(400, t('bastion.urlProtocolRequired'))
        }
      }
      const patch = {}
      const copy = (field, key) => {
        if (body[key] !== undefined) patch[field] = typeof body[key] === 'string' ? body[key].trim() : body[key]
      }
      copy('jumpserverUrl', 'jumpserverUrl')
      copy('jumpserverUsername', 'jumpserverUsername')
      copy('jumpserverSshPort', 'jumpserverSshPort')
      copy('jumpserverDefaultAccount', 'jumpserverDefaultAccount')
      copy('jumpserverRejectUnauthorized', 'jumpserverRejectUnauthorized')
      if (body.confirmPolicy === 'auto' || body.confirmPolicy === 'always' || body.confirmPolicy === 'never') {
        patch.confirmPolicy = body.confirmPolicy
      }
      if (body.dangerPolicy === 'always-ask' || body.dangerPolicy === 'never') {
        patch.dangerPolicy = body.dangerPolicy
      }
      if (typeof body.safetyRules === 'string') {
        // 空字符串 = 恢复默认（存空，读取时回退默认文本）
        patch.safetyRules = body.safetyRules
      }
      if (typeof body.jumpserverPassword === 'string' && body.jumpserverPassword !== '') {
        patch.jumpserverPassword = body.jumpserverPassword
      }
      await deviceScope.update(patch)
      const config = getConfig()
      if (repo && config.jumpserverUrl) {
        try {
          await repo.saveBastion({
            url: config.jumpserverUrl,
            username: config.jumpserverUsername,
            password: typeof body.jumpserverPassword === 'string' && body.jumpserverPassword !== '' ? body.jumpserverPassword : undefined,
            defaultAccount: config.jumpserverDefaultAccount,
            rejectUnauthorized: config.jumpserverRejectUnauthorized !== false,
            lastUsedAt: Date.now(),
          })
        } catch { /* 历史记录保存失败静默 */ }
      }
      return jsonOk(200, {
        config: {
          jumpserverUrl: config.jumpserverUrl,
          jumpserverUsername: config.jumpserverUsername,
          hasPassword: Boolean(config.jumpserverPassword),
          jumpserverDefaultAccount: config.jumpserverDefaultAccount,
          jumpserverRejectUnauthorized: config.jumpserverRejectUnauthorized,
          confirmPolicy: config.confirmPolicy,
          dangerPolicy: config.dangerPolicy,
          safetyRules: config.safetyRules || DEFAULT_SAFETY_RULES,
        },
      })
    })
    addRoute('GET', '/assets', async () => {
      const cache = getCache()
      return jsonOk(200, {
        assets: cache.assets ?? [],
        total: cache.total,
        lastSyncAt: cache.lastSyncAt,
        error: cache.error,
      })
    })
    addRoute('POST', '/jumpserver/test', async (req) => {
      const body = await readJsonBody(req).catch(() => ({}))
      const config = getConfig()
      const testConfig = {
        url: body.jumpserverUrl ?? config.jumpserverUrl,
        username: body.jumpserverUsername ?? config.jumpserverUsername,
        password: (body.jumpserverPassword !== undefined && body.jumpserverPassword !== '') ? body.jumpserverPassword : config.jumpserverPassword,
        token: config.jumpserverToken,
        rejectUnauthorized: body.jumpserverRejectUnauthorized !== undefined ? body.jumpserverRejectUnauthorized : config.jumpserverRejectUnauthorized,
        defaultAccount: body.jumpserverDefaultAccount ?? config.jumpserverDefaultAccount,
      }
      const rawUrl = String(testConfig.url || '').trim()
      if (!rawUrl) return jsonError(400, t('bastion.needUrl'))
      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        return jsonError(400, t('bastion.urlProtocolRequired'))
      }
      const jumpserver = new JumpServerClient(testConfig)
      try {
        await resolveJumpserverToken(ctx, jumpserver)
        const result = await jumpserver.test()
        if (repo && testConfig.url) {
          try {
            await repo.saveBastion({
              url: testConfig.url,
              username: testConfig.username,
              password: testConfig.password,
              defaultAccount: testConfig.defaultAccount,
              rejectUnauthorized: testConfig.rejectUnauthorized !== false,
              lastUsedAt: Date.now(),
            })
          } catch { /* 忽略 */ }
        }
        return jsonOk(200, result)
      } catch (error) {
        return jsonError(502, JumpServerClient.formatError(error))
      }
    })
    addRoute('GET', '/bastion/history', async () => {
      if (!repo) return jsonOk(200, { history: [] })
      const list = await repo.listBastions()
      return jsonOk(200, { history: list })
    })
    addRoute('POST', '/bastion/history/use', async (req) => {
      const body = await readJsonBody(req)
      const id = String(body.id || '')
      if (!id) return jsonError(400, t('http.missingId'))
      if (!repo) return jsonError(503, '数据仓库不可用')
      const profile = await repo.getBastionWithSecret(id)
      if (!profile) return jsonError(404, '未找到该堡垒机历史配置')
      if (!deviceScope) return jsonError(503, t('http.settingsUnavailable'))
      const patch = {
        jumpserverUrl: profile.url,
        jumpserverUsername: profile.username,
        jumpserverDefaultAccount: profile.defaultAccount || '',
        jumpserverRejectUnauthorized: profile.rejectUnauthorized !== false,
      }
      if (profile.password) {
        patch.jumpserverPassword = profile.password
      }
      await deviceScope.update(patch)
      await repo.saveBastion({ id: profile.id, url: profile.url, username: profile.username, lastUsedAt: Date.now() })
      const config = getConfig()
      return jsonOk(200, {
        config: {
          jumpserverUrl: config.jumpserverUrl,
          jumpserverUsername: config.jumpserverUsername,
          hasPassword: Boolean(config.jumpserverPassword),
          jumpserverDefaultAccount: config.jumpserverDefaultAccount,
          jumpserverRejectUnauthorized: config.jumpserverRejectUnauthorized,
          confirmPolicy: config.confirmPolicy,
          dangerPolicy: config.dangerPolicy,
          safetyRules: config.safetyRules || DEFAULT_SAFETY_RULES,
        },
      })
    })
    addRoute('DELETE', '/bastion/history', async (req) => {
      const body = await readJsonBody(req)
      const id = String(body.id ?? (new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? ''))
      if (!id) return jsonError(400, t('http.missingId'))
      if (!repo) return jsonError(503, '数据仓库不可用')
      await repo.deleteBastion(id)
      return jsonOk(200, { removed: id })
    })

    // 全部路由声明完成后统一挂载，再随 scoped fiber 一起注销
    // （webServer 消失或插件卸载时）
    mount()
    sctx.effect(() => () => {
      for (const unregister of routes) unregister()
    })
  })

  // ── 生命周期清理 ────────────────────────────────────────────────────
  ctx.effect(() => () => {
    pool.dispose()
    void repo.close()
  })
}

/** 目标摘要（结果回显用）。 */
function targetSummary(target) {
  if (target.kind === 'manual') {
    return {
      id: target.device.id,
      name: target.device.name,
      host: target.device.host,
      protocol: target.device.protocol,
    }
  }
  return {
    id: `asset:${target.asset.id}`,
    name: target.asset.name,
    host: target.asset.address,
    protocol: target.asset.protocols?.[0]?.name || 'ssh',
  }
}

/** device_list 的模型可读文本。 */
/** device_find 的模型可读文本。 */
function renderFindResult(value) {
  if (!value.matched || value.candidates.length === 0) {
    return `地址「${value.query}」未匹配到任何已添加设备或堡垒机资产。\n`
      + '不要臆造目标或凭据：可以先 device_list 查看全量清单，或让用户用 device_add 添加、用 jumpserver_sync 同步堡垒机后再试。'
  }
  const lines = [`地址「${value.query}」匹配到 ${value.candidates.length} 个候选：`]
  for (const c of value.candidates) {
    if (c.kind === 'manual') {
      lines.push(`- 已添加设备：id=${c.id} | ${c.name} | ${c.protocol} ${c.address}:${c.port}${c.lanIp ? ` | 内网IP=${c.lanIp}` : ''}${c.viaJumpHost ? ' | 经跳板机' : ''}（匹配依据：${c.match}）`)
    } else {
      lines.push(`- 堡垒机资产：id=${c.id} | ${c.name} | ${c.address} | [${c.protocols.join(',')}]${c.platform ? ` | ${c.platform}` : ''}${c.orgName ? ` | ${c.orgName}` : ''}（匹配依据：${c.match}）`)
    }
  }
  lines.push('用候选中的 id 传给 device_exec 即可连接（首次执行会向用户确认）。')
  return lines.join('\n')
}

function renderDeviceList(value, t = createTranslator('zh'), query = '') {
  const lines = []
  if (value.devices.length > 0) {
    lines.push(`${t('slash.manual')}（共 ${value.devices.length} 台）：`)
    for (const device of value.devices) lines.push(describeDevice(device, t))
  } else {
    lines.push(t('slash.manualNone'))
  }
  if (value.jumpserver.configured) {
    if (value.assets.length > 0) {
      if (query && query !== '*') {
        lines.push('', t('slash.assets', {
          total: value.assets.length,
          time: new Date(value.jumpserver.lastSyncAt).toLocaleString(),
        }))
        for (const asset of value.assets) lines.push(describeAsset(asset))
      } else {
        lines.push('', t('slash.assetsSummary', {
          total: value.jumpserver.total,
          time: new Date(value.jumpserver.lastSyncAt).toLocaleString(),
        }))
        const sample = value.assets.slice(0, 5)
        for (const asset of sample) lines.push(describeAsset(asset))
        if (value.assets.length > 5) {
          lines.push(`  ... 另有 ${value.assets.length - 5} 个堡垒机资产（可用 query 参数过滤，或使用 device_find 查找，或用 device_add 纳管）`)
        }
      }
    } else {
      lines.push('', t('slash.assetsEmpty'))
    }
    if (value.jumpserver.error) lines.push(t('slash.syncError', { error: value.jumpserver.error }))
  } else {
    lines.push('', t('slash.unconfigured'))
  }
  return lines.join('\n')
}

/** device_exec 的模型可读文本。 */
function renderExecResult(value, t = createTranslator('zh')) {
  const header = t('slash.exec.device', {
    name: value.device.name,
    protocol: value.device.protocol,
    host: value.device.host,
  })
  if (value.blocked) return `${header}\n${value.blockedReason ?? t('slash.exec.blocked')}`
  if (value.declined) return `${header}\n${t('slash.exec.declined')}`
  let body = value.stdout
  if (value.stderr) body += `${body && !body.endsWith('\n') ? '\n' : ''}[stderr]\n${value.stderr}`
  if (!body) body = t('slash.exec.noOutput')
  const markers = []
  if (value.timedOut) markers.push('[timed out]')
  else if (value.exitCode !== null && value.exitCode !== 0) markers.push(`[exit code: ${value.exitCode}]`)
  if (markers.length === 0) return `${header}\n${body}`
  return `${header}\n${body}\n${markers.join('\n')}`
}

/** device_memory 的模型可读文本。 */
function renderMemory(value) {
  if (!value.memories || value.memories.length === 0) return '暂无设备记忆（先添加设备或执行过一次命令）'
  const lines = []
  for (const memory of value.memories) {
    lines.push(`## ${memory.deviceName}`)
    if (memory.env && Object.keys(memory.env).length > 0) {
      const env = memory.env
      if (env.raw) {
        lines.push(`环境（探针原始输出）：\n${String(env.raw).split('\n').map((line) => `  ${line}`).join('\n')}`)
      } else {
        const parts = []
        if (env.host) parts.push(`主机名=${env.host}`)
        if (env.os) parts.push(`系统=${env.os}`)
        if (env.kernel) parts.push(`内核=${env.kernel}`)
        if (env.arch) parts.push(`架构=${env.arch}`)
        if (env.user) parts.push(`用户=${env.user}`)
        if (env.shell) parts.push(`shell=${env.shell}`)
        if (env.cwd) parts.push(`工作目录=${env.cwd}`)
        if (env.lanip) parts.push(`内网IP=${env.lanip}`)
        if (parts.length > 0) lines.push(`环境：${parts.join('，')}`)
      }
    } else {
      lines.push('环境：暂无探针信息（连接并执行过一次命令后会自动采集）')
    }
    if (memory.history.length === 0) {
      lines.push('操作历史：无')
    } else {
      lines.push('最近操作：')
      for (const entry of memory.history) {
        const time = new Date(entry.startedAt).toLocaleString()
        const status = entry.timedOut ? '超时' : entry.exitCode === null ? '?' : `exit ${entry.exitCode}`
        lines.push(`- ${time} [${status}] ${entry.command}`)
        if (entry.stdout) lines.push(`  输出摘要：${entry.stdout.slice(0, 160).replace(/\n/g, '⏎')}${entry.stdout.length > 160 ? '…' : ''}`)
        if (entry.stderr) lines.push(`  stderr：${entry.stderr.slice(0, 120).replace(/\n/g, '⏎')}${entry.stderr.length > 120 ? '…' : ''}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
