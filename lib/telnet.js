/**
 * 极简 Telnet 客户端（纯 Node net 实现，无外部依赖）。
 *
 * 面向网络设备（交换机/路由器/防火墙等）与老式 telnet 服务。
 * 连接与执行分离（配合 lib/pool.js 的持久会话池复用连接）：
 * - telnetConnect()：建立 TCP 会话
 * - telnetLogin()：登录序列（登录提示 → 密码 → 命令提示符）
 * - telnetRun()：在既有会话上执行一条命令（同一会话内串行）
 * - telnetExec()：一次性便捷封装
 *
 * - IAC 协商：对绝大多数协商请求回复 WONT/DONT（拒绝），跳过子协商
 * - 提示符检测：可配置正则；支持 --More-- 分页自动空格翻页
 * - 编码：utf8 / gbk 等（iconv-lite）；输出经 lib/clean.js 清洗
 *
 * @module @sailfish/dsh-device/telnet
 */

import net from 'node:net'
import iconv from 'iconv-lite'
import { capOutput } from './ssh.js'
import { cleanCommandOutput, cleanTerminalOutput } from './clean.js'

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240

/**
 * 一个 TCP 流式读取器：持续接收数据并按"已接收内容"维护一个
 * 可搜索的环形缓冲，供提示符匹配使用。
 */
class TelnetStream {
  constructor(socket, encoding) {
    this.socket = socket
    this.encoding = encoding
    this.chunks = [] // 解码后的字符串块（每次协商剥离后追加）
    this.tail = '' // 最近 8192 字符（供正则匹配）
    this.listeners = new Set()
    socket.on('data', (buffer) => this.#onData(buffer))
  }

  /** 已接收到的全部文本（解码后）。 */
  text() {
    return this.chunks.join('')
  }

  /** 等待尾部匹配某个正则（超时抛错）。 */
  waitFor(regex, timeoutMs, abortSignal) {
    if (this.matches(regex)) return Promise.resolve(true)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`等待提示符超时（${timeoutMs}ms）`))
      }, timeoutMs)
      const onAbort = () => {
        cleanup()
        reject(new Error('连接被取消'))
      }
      const onChange = () => {
        if (this.matches(regex)) {
          cleanup()
          resolve(true)
        }
      }
      const cleanup = () => {
        clearTimeout(timer)
        abortSignal?.removeEventListener('abort', onAbort)
        this.listeners.delete(onChange)
      }
      this.listeners.add(onChange)
      if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** 尾部是否匹配（支持 RegExp 或 {matches(text)} 匹配器对象）。 */
  matches(matcher) {
    if (matcher instanceof RegExp) return matcher.test(this.tail)
    if (typeof matcher?.matches === 'function') return matcher.matches(this.tail)
    return false
  }

  /** 清空接收缓冲（发送命令前调用，避免上次输出的尾巴干扰）。 */
  reset() {
    this.chunks.length = 0
    this.tail = ''
  }

  #onData(buffer) {
    const bytes = []
    for (const byte of buffer) bytes.push(byte)
    const payload = stripNegotiations(bytes, this.socket)
    if (payload.length === 0) return
    const text = decode(payload, this.encoding)
    this.chunks.push(text)
    this.tail = (this.tail + text).slice(-8192)
    for (const listener of this.listeners) listener()
  }
}

/** 剥离并应答 IAC 协商序列，返回纯业务字节。 */
function stripNegotiations(bytes, socket) {
  const out = []
  let i = 0
  while (i < bytes.length) {
    const byte = bytes[i]
    if (byte !== IAC) {
      out.push(byte)
      i += 1
      continue
    }
    if (i + 1 >= bytes.length) break // 不完整的 IAC，丢弃
    const cmd = bytes[i + 1]
    if (cmd === IAC) {
      out.push(IAC) // IAC IAC → 字面 255
      i += 2
    } else if (cmd === DO || cmd === DONT) {
      if (i + 2 < bytes.length) socket.write(Buffer.from([IAC, WONT, bytes[i + 2]])) // 拒绝对方建议
      i += 3
    } else if (cmd === WILL || cmd === WONT) {
      if (i + 2 < bytes.length) socket.write(Buffer.from([IAC, DONT, bytes[i + 2]])) // 拒绝对方能力
      i += 3
    } else if (cmd === SB) {
      // 子协商：跳过直到 IAC SE
      let j = i + 2
      while (j + 1 < bytes.length && !(bytes[j] === IAC && bytes[j + 1] === SE)) j += 1
      i = j + 2
    } else {
      i += 2 // 其他（NOP、DM、BRK 等）跳过
    }
  }
  return Buffer.from(out)
}

function decode(buffer, encoding) {
  try {
    return encoding === 'utf8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding)
  } catch {
    return buffer.toString('utf8')
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 提示符匹配器：多正则任一命中，且排除"续行提示"（> 或 ... 开头，参考 SailFish）。 */
function buildPromptMatcher(promptRegex) {
  const parts = String(promptRegex || '[$#>~%]\\s*$').split('|').map((part) => part.trim()).filter(Boolean)
  const regexes = parts.map((part) => new RegExp(part))
  return {
    matches(text) {
      // 续行提示（> 或 ... 开头的行）不是命令提示符
      const lastLines = text.split('\n').slice(-3)
      if (lastLines.some((line) => /^\s*(?:>|\.\.\.|…)\s*$/.test(line))) return false
      return regexes.some((regex) => regex.test(text))
    },
    /** 供输出清洗复用：给一段文本剥离尾部提示符。 */
    strip(text) {
      const lines = text.split('\n')
      const last = lines[lines.length - 1] ?? ''
      for (const regex of regexes) {
        const match = regex.exec(last)
        if (match && match.index + match[0].length >= last.trimEnd().length - 2) {
          lines[lines.length - 1] = last.slice(0, match.index)
          break
        }
      }
      return lines.join('\n')
    },
  }
}

/** 组装登录/命令用正则。 */
function regexesOf(opts) {
  return {
    login: new RegExp(opts.loginRegex || '(login|username)\\s*:', 'i'),
    password: new RegExp(opts.passwordRegex || 'password\\s*:', 'i'),
    prompt: buildPromptMatcher(opts.promptRegex),
    more: new RegExp(opts.moreRegex || '(--More--|---- More ----)'),
  }
}

/**
 * 建立 Telnet TCP 会话（尚未登录）。
 * @param {object} conn - { host, port, username, password }
 * @param {object} opts - { encoding, signal }
 * @returns {Promise<{socket, stream, send(text), destroy(), text()}>}
 */
export function telnetConnect(conn, opts = {}) {
  return new Promise((resolve, reject) => {
    const encoding = opts.encoding || 'utf8'
    const socket = net.connect({ host: conn.host, port: conn.port || 23 })
    const stream = new TelnetStream(socket, encoding)
    let settled = false
    const onAbort = () => {
      try { socket.destroy() } catch { /* 已销毁 */ }
      reject(new Error('连接被取消'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    socket.on('error', (error) => {
      if (settled) return
      settled = true
      opts.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    socket.on('connect', () => {
      if (settled) return
      settled = true
      opts.signal?.removeEventListener('abort', onAbort)
      const sendRaw = (text) => {
        // 发送侧同样按编码转换（GBK 设备发中文命令不乱码）
        let buffer
        try {
          buffer = encoding === 'utf8' ? Buffer.from(`${text}\r\n`, 'utf8') : iconv.encode(`${text}\r\n`, encoding)
        } catch {
          buffer = Buffer.from(`${text}\r\n`, 'utf8')
        }
        socket.write(buffer)
      }
      resolve({
        socket,
        stream,
        encoding,
        send: sendRaw,
        destroy: () => {
          try { socket.destroy() } catch { /* 已销毁 */ }
        },
      })
    })
  })
}

/**
 * 完成登录序列：登录提示 → 发送用户名 → 密码提示 → 发送密码 → 等待命令提示符。
 * @param {object} session - telnetConnect 返回值。
 * @param {object} conn - { username, password }
 * @param {object} opts - { loginRegex, passwordRegex, promptRegex, loginTimeoutMs, signal }
 */
export async function telnetLogin(session, conn, opts = {}) {
  const { login, password, prompt } = regexesOf(opts)
  const loginTimeoutMs = opts.loginTimeoutMs ?? 20000
  await session.stream.waitFor(login, loginTimeoutMs, opts.signal)
  session.send(conn.username || '')
  try {
    await session.stream.waitFor(password, Math.min(loginTimeoutMs, 10000), opts.signal)
    session.send(conn.password || '')
  } catch {
    // 无密码提示也继续，等待命令提示符判断登录是否成功
  }
  await session.stream.waitFor(prompt, loginTimeoutMs, opts.signal)
  await sleep(150)
  session.stream.reset()
}

/**
 * 在已登录会话上执行一条命令（同一会话内必须串行调用）。
 * @returns {Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, aborted: boolean}>}
 */
export async function telnetRun(session, command, opts = {}) {
  const { prompt, more } = regexesOf(opts)
  const timeoutMs = opts.timeoutMs ?? 30000
  const maxChars = opts.maxOutputChars ?? 40000
  const enablePrompt = opts.enablePrompt ?? true
  const signal = opts.signal

  session.stream.reset()
  session.send(command)
  const deadline = Date.now() + timeoutMs
  let output = ''
  let aborted = false
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      aborted = true
      // Ctrl-C 中断当前命令，随后等待提示符回归恢复会话同步
      session.socket.write('\x03')
      break
    }
    const before = session.stream.text().length
    await sleep(200)
    if (session.stream.matches(more) && enablePrompt) {
      session.stream.reset()
      session.socket.write(' ') // --More-- 翻页
      await sleep(200)
      continue
    }
    const text = session.stream.text()
    output = text
    if (text.length > 0 && text.length === before && session.stream.matches(prompt)) break
    if (text.length > 0 && session.stream.matches(prompt) && text.length > 0) break
  }
  const timedOut = Date.now() >= deadline && !aborted
  const clean = cleanCommandOutput(output, command, prompt)
  return {
    exitCode: timedOut || aborted ? null : 0,
    stdout: capOutput(clean, maxChars),
    stderr: '',
    timedOut,
    aborted,
  }
}

/**
 * 一次性执行：连接 → 登录 → 执行 → 断开。
 */
export async function telnetExec(conn, command, opts = {}) {
  const session = await telnetConnect(conn, opts)
  try {
    await telnetLogin(session, conn, opts)
    return await telnetRun(session, command, opts)
  } finally {
    session.destroy()
  }
}

/** 仅测试连通性：完成登录即算成功。 */
export async function telnetTest(conn, opts = {}) {
  const session = await telnetConnect(conn, opts)
  try {
    await telnetLogin(session, conn, opts)
    return { ok: true, message: 'Telnet 连接正常' }
  } catch (error) {
    return { ok: false, message: formatTelnetError(error) }
  } finally {
    session.destroy()
  }
}

export function formatTelnetError(error) {
  const message = error?.message || String(error)
  if (/ECONNREFUSED/.test(message)) return '连接被拒绝（目标端口未开放？）'
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return '主机名解析失败'
  if (/ETIMEDOUT/.test(message)) return '连接超时'
  if (/等待提示符超时/.test(message)) return '登录失败或提示符不匹配（可调整 telnetLoginRegex/telnetPromptRegex）'
  if (/被取消/.test(message)) return '操作被取消'
  return message
}

/** 连接层面错误判定（会话池据此销毁重建）。 */
export function isTelnetConnectionError(error) {
  const message = error?.message || ''
  return /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|等待提示符超时|Socket closed|not connected/.test(message)
}

/** 清洗原始文本（供外部环境探针等使用）。 */
export function cleanRaw(text) {
  return cleanTerminalOutput(text)
}
