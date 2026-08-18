/**
 * 远程命令输出清洗：ANSI 转义剥离、回显与提示符噪声清理。
 *
 * AI 作为操作者时，输出里的色码/光标序列/命令回显/残留提示符都是
 * 噪声：既浪费 token 又容易误判（参考 SailFish 的 strip-ansi 处理）。
 *
 * @module @sailfish/dsh-device/clean
 */

/** ANSI CSI/OSC 序列与孤立控制字符（保留 \n 与 \t）。 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]|\x1b[7-8]|\x1b[MD]|\x1b[FE]|\x1b[AB]/g

/** 剥离 ANSI 转义序列。 */
export function stripAnsi(text) {
  if (!text || !text.includes('\x1b')) return text
  return text.replace(ANSI_PATTERN, '')
}

/**
 * 清洗一段终端输出：
 * - 剥离 ANSI
 * - CRLF / 裸 CR → LF
 * - 去除每行行尾的空白与退格序列
 * - 折叠连续空行（最多保留 1 个）
 * @param {string} text - 原始输出。
 * @returns {string} 清洗后的文本。
 */
export function cleanTerminalOutput(text) {
  if (!text) return ''
  let out = stripAnsi(text)
  out = out.replace(/\r\n?/g, '\n')
  // 退格覆盖序列（"字\b" 表示已删除的字）：折叠为被覆盖后的剩余内容
  out = out.replace(/[^\b\n]+\x08+[^\b\n]*/g, (match) => match.replace(/\x08/g, ''))
  // 残留控制字符（保留 \n 与 \t）
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  out = out.replace(/[ \t]+$/gm, '')
  out = out.replace(/\n{3,}/g, '\n\n')
  return out
}

/**
 * 去除命令回显：匹配以命令本身（转义后）开头的第一行。
 * Telnet 设备会把输入的命令原样回显；SSH exec 一般没有，多一层判断无害。
 * @param {string} output - 输出文本。
 * @param {string} command - 原命令（多行命令只处理首行）。
 * @returns {string}
 */
export function stripCommandEcho(output, command) {
  if (!output || !command) return output
  const firstLine = command.split('\n')[0].trim()
  if (firstLine.length < 2) return output
  const escaped = firstLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^(?:\\x1b\\[[0-9;?]*[ -/]*[@-~])*\\s*${escaped}\\s*\\n?`)
  return output.replace(pattern, '')
}

/** 去除行尾残留的 shell 提示符（如 "SWITCH> "、"root@host:~# "）。 */
export function stripTrailingPrompt(output, promptRegex) {
  if (!output || !promptRegex) return output
  // 提示符匹配器对象（多正则 + 续行排除）
  if (typeof promptRegex === 'object' && typeof promptRegex.strip === 'function') {
    return promptRegex.strip(output)
  }
  const re = typeof promptRegex === 'string' ? new RegExp(promptRegex) : promptRegex
  // 只清理结尾处匹配的提示符段
  const lines = output.split('\n')
  const last = lines[lines.length - 1] ?? ''
  const match = re.exec(last)
  if (match && match.index + match[0].length >= last.trimEnd().length - 2) {
    lines[lines.length - 1] = last.slice(0, match.index)
  }
  return lines.join('\n')
}

/** 组合清洗：ANSI + 回显 + 提示符。 */
export function cleanCommandOutput(output, command, promptRegex) {
  let out = cleanTerminalOutput(output)
  out = stripCommandEcho(out, command)
  out = stripTrailingPrompt(out, promptRegex)
  return out.trim()
}
