/**
 * SSH 连接引擎：基于 ssh2 的连接建立与命令执行。
 *
 * 连接与执行分离（配合 lib/pool.js 的持久会话池复用连接）：
 * - sshConnect()：建立一条连接（密码/私钥/跳板机）
 * - sshRun()：在既有连接上执行一条命令（可并发多个 channel）
 * - sshExec()：一次性便捷封装（连 → 跑 → 断）
 *
 * 输出统一经 lib/clean.js 清洗（ANSI 剥离、CRLF 归一）。
 *
 * @module @sailfish/dsh-device/ssh
 */

import { Client } from 'ssh2'
import iconv from 'iconv-lite'
import { cleanTerminalOutput } from './clean.js'

/** 截断输出并附加说明。 */
export function capOutput(text, maxChars) {
  if (maxChars <= 0 || text.length <= maxChars) return text
  const half = Math.floor(maxChars / 2)
  return `${text.slice(0, half)}\n…[输出过长已截断，共 ${text.length} 字符]…\n${text.slice(-half)}`
}

/** 解码原始 Buffer：utf8 直接用 toString，其他编码走 iconv-lite。 */
function decode(buffer, encoding) {
  const enc = encoding === 'utf8' ? 'utf8' : encoding
  try {
    return enc === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, enc)
  } catch {
    return buffer.toString('utf8')
  }
}

/** 组装 ssh2 连接参数。 */
function connectConfigOf(conn, extra) {
  return {
    host: conn.host,
    port: conn.port || 22,
    username: conn.username,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
    ...(conn.password !== undefined && conn.password !== '' ? { password: conn.password } : {}),
    ...(conn.privateKey !== undefined && conn.privateKey !== '' ? {
      privateKey: conn.privateKey,
      ...(conn.passphrase ? { passphrase: conn.passphrase } : {}),
    } : {}),
    ...(extra ?? {}),
  }
}

/**
 * 建立到跳板机的 SSH 连接并打开到目标 host:port 的转发流。
 * @returns {Promise<{client: Client, sock: import('stream').Duplex}>}
 */
function openJumpSock(jump, target, signal) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      try { client.destroy() } catch { /* 已经销毁 */ }
      reject(error)
    }
    const onAbort = () => fail(new Error('连接被取消'))
    signal?.addEventListener('abort', onAbort, { once: true })
    client.on('error', fail)
    client.on('ready', () => {
      client.forwardOut('127.0.0.1', 0, target.host, target.port, (error, sock) => {
        if (error) return fail(error)
        signal?.removeEventListener('abort', onAbort)
        resolve({ client, sock })
      })
    })
    client.connect(connectConfigOf(jump))
  })
}

/**
 * 建立 SSH 连接。
 * @param {object} conn - { host, port, username, password?/privateKey?/passphrase?, jumpHost? }
 * @param {object} opts - { signal }
 * @returns {Promise<{client: Client, destroy(): void}>}
 */
export function sshConnect(conn, opts = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const state = { settled: false, jump: null }
    const cleanup = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      client.removeListener('error', onError)
    }
    const fail = (error) => {
      if (state.settled) return
      state.settled = true
      cleanup()
      try { state.jump?.destroy() } catch { /* 已经销毁 */ }
      try { client.destroy() } catch { /* 已经销毁 */ }
      reject(error)
    }
    const onAbort = () => fail(new Error('连接被取消'))
    const onError = (error) => fail(error)
    client.on('error', onError)
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })
    client.on('ready', () => {
      if (state.settled) return
      state.settled = true
      cleanup()
      resolve({
        client,
        destroy: () => {
          try { client.destroy() } catch { /* 已经销毁 */ }
          try { state.jump?.destroy() } catch { /* 已经销毁 */ }
        },
      })
    })
    if (conn.jumpHost && conn.jumpHost.host) {
      openJumpSock(conn.jumpHost, conn, opts.signal).then(({ client: jump, sock }) => {
        if (state.settled) {
          try { jump.destroy() } catch { /* 已经销毁 */ }
          return
        }
        state.jump = jump
        client.connect(connectConfigOf(conn, { sock }))
      }, (error) => fail(error))
    } else {
      client.connect(connectConfigOf(conn))
    }
  })
}

/**
 * 在既有连接上执行命令（连接层面错误会抛错；命令退出码只是结果字段）。
 * @param {object} session - sshConnect 的返回值。
 * @param {string} command - 命令。
 * @param {object} opts - { timeoutMs, maxOutputChars, encoding, signal }
 * @returns {Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, aborted: boolean}>}
 */
export function sshRun(session, command, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 30000
    const maxChars = opts.maxOutputChars ?? 40000
    const encoding = opts.encoding || 'utf8'
    let settled = false
    let stream

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      // 超时：放弃本 channel（保留连接；销毁 channel 会杀掉远端进程）
      try { stream?.destroy() } catch { /* 已关闭 */ }
      finish(null, { exitCode: null, stdout: '', stderr: '', timedOut: true, aborted: false })
    }, timeoutMs)
    const onAbort = () => {
      try { stream?.destroy() } catch { /* 已关闭 */ }
      finish(null, { exitCode: null, stdout: '', stderr: '', timedOut: false, aborted: true })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      session.client.exec(command, (error, channel) => {
        if (error) return finish(error)
        stream = channel
        const stdoutChunks = []
        const stderrChunks = []
        channel.on('data', (chunk) => stdoutChunks.push(chunk))
        channel.stderr.on('data', (chunk) => stderrChunks.push(chunk))
        channel.on('close', (code) => {
          const stdout = cleanTerminalOutput(decode(Buffer.concat(stdoutChunks), encoding))
          const stderr = cleanTerminalOutput(decode(Buffer.concat(stderrChunks), encoding))
          finish(null, {
            exitCode: code,
            stdout: capOutput(stdout, maxChars),
            stderr: capOutput(stderr, maxChars),
            timedOut: false,
            aborted: false,
          })
        })
      })
    } catch (error) {
      finish(error)
    }
  })
}

/**
 * 一次性执行：连接 → 执行 → 断开（不复用连接时的便捷封装）。
 */
export async function sshExec(conn, command, opts = {}) {
  const session = await sshConnect(conn, opts)
  try {
    return await sshRun(session, command, opts)
  } finally {
    session.destroy()
  }
}

/** 仅测试连通性：连接成功后执行一条极简命令。 */
export async function sshTest(conn, opts = {}) {
  const probe = opts.probe ?? "echo dsh-device-ok 2>/dev/null || true"
  try {
    const session = await sshConnect(conn, opts)
    try {
      const result = await sshRun(session, probe, {
        timeoutMs: opts.timeoutMs ?? 15000,
        maxOutputChars: 4096,
        encoding: opts.encoding || 'utf8',
        signal: opts.signal,
      })
      if (result.timedOut) return { ok: false, message: '连接超时' }
      if (result.exitCode !== 0 && result.exitCode !== null) {
        return { ok: false, message: `命令执行失败（exit ${result.exitCode}）：${result.stderr || result.stdout}` }
      }
      return { ok: true, message: 'SSH 连接正常' }
    } finally {
      session.destroy()
    }
  } catch (error) {
    return { ok: false, message: formatSshError(error) }
  }
}

/** 把 ssh2 常见错误翻译成可读中文（对齐 SailFish 九类错误分类）。 */
export function formatSshError(error) {
  const message = error?.message || String(error)
  const level = error?.level
  if (level === 'client-authentication') return `SSH 认证失败（${message}）`
  if (/All configured authentication methods failed/.test(message)) return 'SSH 认证失败：所有认证方式都被拒绝（检查密码/私钥/用户名）'
  if (/Host key verification failed|host key/i.test(message)) return `SSH 主机密钥不匹配（若确认服务器指纹变更，请检查 known_hosts）`
  if (/ECONNREFUSED/.test(message)) return '连接被拒绝（目标端口未开放？）'
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return '主机名解析失败'
  if (/ETIMEDOUT/.test(message)) return '连接超时'
  if (/EHOSTUNREACH|ENETUNREACH/.test(message)) return '主机不可达'
  if (/Timed out while waiting for handshake/.test(message)) return 'SSH 握手超时'
  if (/private key/i.test(message)) return `私钥无效（${message}）`
  return message
}

/** 连接层面错误的粗略判定（会话池据此销毁重建）。 */
export function isConnectionError(error) {
  const message = error?.message || ''
  return /ECONNRESET|ECONNREFUSED|EPIPE|not connected|Connection lost|client not running|Socket closed|Timed out while waiting for handshake|SSH 握手超时|连接被取消/.test(message)
}
