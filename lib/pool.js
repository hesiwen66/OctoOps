/**
 * 持久会话池：跨命令复用 SSH/Telnet 连接。
 *
 * AI 连续排障时，每条命令重新握手+登录是最大的时间浪费（Telnet 设备
 * 每次登录 1~3 秒）。会话池按设备键缓存连接：
 * - SSH：一条连接上并发跑多个 exec channel（无需串行）
 * - Telnet：单流必须串行（内部排队）
 * - 空闲超时自动断开；超过容量上限按 LRU 逐出
 * - 仅连接层错误（断线/拒连/管道破裂）才销毁重建并重试一次
 * - 命令失败、超时、认证失败、用户取消不重跑，避免非幂等命令执行两遍
 * - 插件卸载时全部关闭
 *
 * @module @sailfish/dsh-device/pool
 */

import { isConnectionError as isSshConnectionError } from './ssh.js'
import { isTelnetConnectionError } from './telnet.js'

export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_MAX_SESSIONS = 32

/**
 * 是否值得销毁连接并重试一次。
 *
 * 只认连接已死（RESET/拒连/EPIPE/Socket closed）。超时、取消、认证失败
 * 都不是连接坏了，重跑会让非幂等命令执行两遍。
 *
 * :param {unknown} error: 捕获到的异常。
 * :return {boolean}: true 才允许 drop + 重建 + 再跑一次。
 */
export function isRetryableConnectionError(error) {
  if (!error || error.name === 'AbortError') return false
  const message = error.message || String(error)
  if (/被取消|aborted|ETIMEDOUT|等待提示符超时|Timed out while waiting for handshake|SSH 握手超时/i.test(message)) {
    return false
  }
  return isSshConnectionError(error) || isTelnetConnectionError(error)
}

export class SessionPool {
  /**
   * @param {object} options - { idleTimeoutMs?, maxSessions?, logger? }
   */
  constructor(options = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
    this.logger = options.logger
    this.entries = new Map() // key → {session, usedAt, timer, queue}
    this.disposed = false
  }

  /** 当前存活会话数（诊断用）。 */
  get size() {
    return this.entries.size
  }

  /** 各键的会话状态（诊断用）。 */
  stats() {
    return [...this.entries.entries()].map(([key, entry]) => ({
      key,
      idleMs: Date.now() - entry.usedAt,
    }))
  }

  /**
   * 在（复用或新建的）会话上执行命令。
   * @param {string} key - 会话键（设备 id / 资产+账号）。
   * @param {object} factory - {
   *   create: () => Promise<session>,        // 建立连接（含登录）
   *   run: (session, command, opts) => Promise<result>, // 会话上执行
   *   destroy: (session) => void,            // 关闭会话
   *   serialize?: boolean,                   // 同一会话是否串行（telnet=true）
   * }
   * @param {string} command - 命令。
   * @param {object} opts - { signal, ... }（透传给 run）。
   * @returns {Promise<result>}
   *
   * 仅连接层错误才销毁重建并重试一次；业务失败 / 取消直接抛出。
   */
  async exec(key, factory, command, opts = {}) {
    if (this.disposed) throw new Error('会话池已关闭')
    const entry = this.entries.get(key) ?? await this.#createEntry(key, factory)
    this.#touch(key, entry)
    const run = () => factory.run(entry.session, command, opts)
    try {
      if (factory.serialize) {
        // Telnet 单流：排队串行
        const task = entry.queue.then(run, run)
        entry.queue = task.catch(() => undefined)
        return await task
      }
      return await run()
    } catch (error) {
      // 用户取消或业务失败原样抛出，避免非幂等命令被跑第二遍
      if (opts.signal?.aborted || !isRetryableConnectionError(error)) throw error
      this.#drop(key)
      const retry = await this.#createEntry(key, factory)
      this.#touch(key, retry)
      return factory.run(retry.session, command, opts)
    }
  }

  async #createEntry(key, factory) {
    const session = await factory.create()
    const entry = { session, usedAt: Date.now(), timer: null, queue: Promise.resolve(), destroy: factory.destroy }
    this.entries.set(key, entry)
    this.#evictIfNeeded()
    return entry
  }

  #touch(key, entry) {
    entry.usedAt = Date.now()
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => this.#drop(key), this.idleTimeoutMs)
  }

  #drop(key) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    clearTimeout(entry.timer)
    try {
      entry.destroy?.(entry.session)
    } catch (error) {
      this.logger?.warn?.('dsh-device: 会话关闭失败：%s', error?.message ?? error)
    }
  }

  #evictIfNeeded() {
    if (this.entries.size <= this.maxSessions) return
    // LRU：最久未用的先逐出
    let oldestKey
    let oldestAt = Infinity
    for (const [key, entry] of this.entries) {
      if (entry.usedAt < oldestAt) {
        oldestAt = entry.usedAt
        oldestKey = key
      }
    }
    if (oldestKey !== undefined) this.#drop(oldestKey)
  }

  /**
   * 获取（复用或新建）会话交给 fn 使用，用后不销毁（SFTP 等复用场景）。
   *
   * 仅连接层错误才销毁重建后重试一次；业务失败保持原会话并抛出。
   *
   * :param {string} key: 会话键。
   * :param {object} factory: 与 exec 相同的 create/destroy。
   * :param {function} fn: 拿到 session 后执行的业务。
   * :return {Promise<*>}: fn 的返回值。
   */
  async withSession(key, factory, fn) {
    if (this.disposed) throw new Error('会话池已关闭')
    const entry = this.entries.get(key) ?? await this.#createEntry(key, factory)
    this.#touch(key, entry)
    try {
      return await fn(entry.session)
    } catch (error) {
      if (!isRetryableConnectionError(error)) throw error
      this.#drop(key)
      const retry = await this.#createEntry(key, factory)
      this.#touch(key, retry)
      return fn(retry.session)
    }
  }

  /** 关闭所有会话（幂等；插件卸载时调用）。 */
  dispose() {
    this.disposed = true
    for (const key of [...this.entries.keys()]) this.#drop(key)
    this.entries.clear()
  }
}
