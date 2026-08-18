/**
 * SFTP 文件层（复用会话池里的 SSH 连接，ssh2 内置 sftp 子系统）。
 *
 * 面向 AI 运维的文本文件读写：读配置、改配置，不再靠 heredoc 转义。
 * 二进制/大文件不在职责内（读上限 1MB，写上限 1MB）。
 *
 * @module @sailfish/dsh-device/sftp
 */

/** 在既有 SSH 会话上打开 sftp channel（每会话缓存）。 */
export function openSftp(session) {
  if (session._sftpPromise) return session._sftpPromise
  session._sftpPromise = new Promise((resolve, reject) => {
    session.client.sftp((error, sftp) => {
      if (error) {
        session._sftpPromise = null
        reject(error)
      } else {
        resolve(sftp)
      }
    })
  })
  return session._sftpPromise
}

/** 读取远程文本文件（上限 maxBytes，默认 1MB；超限截断并标记）。 */
export async function sftpReadFile(session, path, opts = {}) {
  const sftp = await openSftp(session)
  const maxBytes = opts.maxBytes ?? 1024 * 1024
  return new Promise((resolve, reject) => {
    sftp.stat(path, (statError) => {
      if (statError) return reject(new Error(`远程文件不存在或无权限：${path}`))
      sftp.readFile(path, (readError, buffer) => {
        if (readError) return reject(new Error(`读取失败：${readError?.message ?? readError}`))
        let content
        try {
          content = buffer.toString('utf8')
        } catch {
          return reject(new Error('文件不是 UTF-8 文本（二进制文件请勿用本工具读取）'))
        }
        const truncated = content.length > maxBytes
        return resolve({ content: truncated ? content.slice(0, maxBytes) : content, size: content.length, truncated })
      })
    })
  })
}

/** 写入远程文本文件（上限 maxBytes，默认 1MB；覆盖式写入）。 */
export async function sftpWriteFile(session, path, content, opts = {}) {
  const sftp = await openSftp(session)
  const maxBytes = opts.maxBytes ?? 1024 * 1024
  if (content.length > maxBytes) throw new Error(`内容过大（${content.length} 字符 > 上限 ${maxBytes}）`)
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, Buffer.from(content, 'utf8'), (error) => {
      if (error) return reject(new Error(`写入失败：${error?.message ?? error}`))
      resolve({ written: content.length })
    })
  })
}

/** 列出远程目录（可选，供面板未来扩展）。 */
export async function sftpList(session, path) {
  const sftp = await openSftp(session)
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (error, entries) => {
      if (error) return reject(new Error(`列目录失败：${error?.message ?? error}`))
      resolve(entries.map((entry) => ({
        name: entry.filename,
        size: entry.attrs?.size ?? 0,
        isDirectory: Boolean(entry.attrs?.isDirectory?.()),
      })))
    })
  })
}

/** 连接层错误粗判（触发池重建）。 */
export function isSftpConnectionError(error) {
  const message = error?.message || ''
  return /ECONNRESET|not connected|client not running|Socket closed|No response from server/.test(message)
}
