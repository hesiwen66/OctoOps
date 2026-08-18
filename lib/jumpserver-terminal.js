/**
 * JumpServer 终端模拟交互驱动引擎：
 * 通过 SSH PTY 连入 JumpServer 终端，像人工运维一样自动完成交互登录并执行命令：
 * 连入 JumpServer:2222 -> [Host]> 搜索/输入资产 -> ID> 选择账号 -> 进入目标 Shell -> 执行命令并采集输出。
 *
 * 彻底兜底解决任何 HTTP REST API 序列化器或权限差异导致的无法直连问题。
 *
 * @module @sailfish/dsh-device/jumpserver-terminal
 */

import { Client } from 'ssh2'
import { cleanTerminalOutput } from './clean.js'

/**
 * 建立到 JumpServer 终端并自动登录到目标资产的交互式会话。
 * @param {object} jmsConfig - { host, port, username, password }
 * @param {object} target - { address, name, id }
 * @param {object} [opts] - { account, signal, timeoutMs }
 * @returns {Promise<{
 *   exec(command: string, runOpts?: object): Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean}>,
 *   destroy(): void,
 * }>}
 */
export function openJumpServerTerminalSession(jmsConfig, target, opts = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let stream = null
    let settled = false
    let currentResolver = null
    let buffer = ''
    let state = 'INIT' // INIT -> SEARCHED -> PICKED_ACCOUNT -> READY -> RUNNING
    const timeoutMs = opts.timeoutMs ?? 30000

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      try { stream?.destroy() } catch { /* ignore */ }
      try { client.destroy() } catch { /* ignore */ }
      reject(error)
    }

    const timer = setTimeout(() => {
      fail(new Error(`连接 JumpServer 终端超时（>${timeoutMs / 1000}s）`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => fail(new Error('操作被取消'))
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })

    client.on('error', (err) => fail(err))

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: 200, rows: 60 }, (err, s) => {
        if (err) return fail(err)
        stream = s

        stream.on('error', (e) => {
          if (currentResolver) currentResolver.reject(e)
          else fail(e)
        })

        stream.on('close', () => {
          if (currentResolver) {
            currentResolver.resolve({
              exitCode: 1,
              stdout: currentResolver.accumulated || '',
              stderr: '',
              timedOut: false,
            })
            currentResolver = null
          }
        })

        stream.on('data', (chunk) => {
          const text = chunk.toString('utf8')
          const cleaned = cleanTerminalOutput(text)
          buffer += cleaned

          // 如果处于普通命令执行状态
          if (state === 'RUNNING' && currentResolver) {
            currentResolver.accumulated += text
            const fullClean = cleanTerminalOutput(currentResolver.accumulated)
            const exitMatch = fullClean.match(/__DSH_EXIT:(-?\d+)__/)
            if (exitMatch) {
              const exitCode = parseInt(exitMatch[1], 10)
              const startIdx = fullClean.indexOf('__DSH_START__')
              let output = fullClean
              if (startIdx !== -1) {
                output = fullClean.slice(startIdx + '__DSH_START__'.length)
              }
              output = output.replace(/__DSH_EXIT:(-?\d+)__[\s\S]*/, '')
              output = output.replace(/^\r?\n/, '').trimEnd()

              const resolver = currentResolver
              currentResolver = null
              state = 'READY'
              resolver.resolve({
                exitCode,
                stdout: output,
                stderr: '',
                timedOut: false,
              })
            }
            return
          }

          // 状态机处理 JumpServer 登录流程
          if (state === 'INIT') {
            // 遇到 JumpServer 菜单提示符 [Host]> 或 搜索：
            if (buffer.includes('[Host]>') || buffer.includes('搜索：') || buffer.includes('Opt>')) {
              state = 'SEARCHED'
              buffer = ''
              // 输入目标机器的 IP 或名称
              const query = target.address || target.name || target.id
              stream.write(`${query}\r`)
            }
          } else if (state === 'SEARCHED') {
            // 1. 如果提示输入资产序号 [Host]>
            if (/\[Host\]>\s*$/.test(buffer) || /ID\s*\|\s*名称/.test(buffer)) {
              // 提取第一行或匹配行的 ID
              const lines = buffer.split('\n')
              let targetId = '1'
              for (const line of lines) {
                const trimmed = line.trim()
                const match = trimmed.match(/^\s*(\d+)\s*\|\s*(.+)/)
                if (match) {
                  const lineContent = match[2]
                  if (lineContent.includes(target.address) || lineContent.includes(target.name)) {
                    targetId = match[1]
                    break
                  }
                }
              }
              buffer = ''
              stream.write(`${targetId}\r`)
            }

            // 2. 如果遇到选择账号提示符 ID> 或 [gemo...]> 或 输入资产[...]的账号ID
            if (/ID>\s*$/.test(buffer) || /提示：输入资产.*账号ID/.test(buffer) || /ID\s*\|\s*名称\s*\|\s*用户名/.test(buffer)) {
              state = 'PICKED_ACCOUNT'
              // 解析账号列表
              const lines = buffer.split('\n')
              let accountId = '1'
              const desired = opts.account ? String(opts.account).toLowerCase() : ''
              for (const line of lines) {
                const match = line.trim().match(/^\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)/)
                if (match) {
                  const num = match[1]
                  const name = match[2].trim().toLowerCase()
                  const uname = match[3].trim().toLowerCase()
                  if (desired && (name.includes(desired) || uname.includes(desired))) {
                    accountId = num
                    break
                  }
                }
              }
              buffer = ''
              stream.write(`${accountId}\r`)
            }

            // 3. 如果已经出现目标机器登录成功的特征
            if (/开始连接到|Last login:|Welcome to|[$#]\s*$/.test(buffer) && !buffer.includes('[Host]>')) {
              state = 'READY'
              clearTimeout(timer)
              if (!settled) {
                settled = true
                resolve(createSessionObj())
              }
            }
          } else if (state === 'PICKED_ACCOUNT') {
            // 账号选择后，等待目标机器登录成功提示
            if (/开始连接到|Last login:|Welcome to|[$#]\s*$/.test(buffer) || /\[.*@.*\][$#]/.test(buffer)) {
              state = 'READY'
              clearTimeout(timer)
              if (!settled) {
                settled = true
                resolve(createSessionObj())
              }
            }
          }
        })
      })
    })

    client.connect({
      host: jmsConfig.host,
      port: jmsConfig.port || 2222,
      username: jmsConfig.username,
      password: jmsConfig.password,
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000,
    })

    function createSessionObj() {
      return {
        exec(command, runOpts = {}) {
          return new Promise((res, rej) => {
            if (state !== 'READY' && state !== 'RUNNING') {
              return rej(new Error('会话当前不可执行命令'))
            }
            state = 'RUNNING'
            currentResolver = {
              resolve: res,
              reject: rej,
              accumulated: '',
            }
            const cmdTimeout = runOpts.timeoutMs ?? 30000
            const cmdTimer = setTimeout(() => {
              if (currentResolver) {
                const r = currentResolver
                currentResolver = null
                state = 'READY'
                r.resolve({
                  exitCode: null,
                  stdout: cleanTerminalOutput(r.accumulated),
                  stderr: '',
                  timedOut: true,
                })
              }
            }, cmdTimeout)

            const origResolve = res
            currentResolver.resolve = (val) => {
              clearTimeout(cmdTimer)
              origResolve(val)
            }

            // 包装命令：echo 起止标记与退出码
            const wrapped = `echo __DSH_START__; ${command}; echo "__DSH_EXIT:$?__"\r`
            stream.write(wrapped)
          })
        },
        destroy() {
          try { stream?.write('exit\r') } catch { /* ignore */ }
          setTimeout(() => {
            try { stream?.destroy() } catch { /* ignore */ }
            try { client.destroy() } catch { /* ignore */ }
          }, 300)
        },
      }
    }
  })
}
