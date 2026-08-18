/**
 * 危险命令护栏：三级判定（blocked 硬墙 / dangerous 强制确认 / 放行）。
 *
 * 参考 SailFish command-audit（blocked 硬墙、间接执行守卫、路径分区）
 * 与 safe-delete-reminder 的思路，裁剪为适合"AI 通过工具操作任意运维
 * 设备"的形态：
 * - blocked：不可逆/系统级破坏，任何情况下拒绝执行（不弹确认）；
 * - dangerous：有影响但可授权，强制用户确认（不受 confirmPolicy 影响）；
 * - 放行。
 *
 * @module @sailfish/dsh-device/guard
 */

/** blocked 硬墙：直接拒绝执行，连确认弹窗都没有。 */
const BLOCKED_PATTERNS = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r)\s+(\/\*|\/\s*$|\/bin\b|\/etc\b|\/usr\b|\/var\b|\/boot\b|\/System\b|\/Library\b|\/home\b)/, category: '数据破坏', reason: '递归强制删除系统/根目录' },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/, category: '资源耗尽', reason: 'fork 炸弹' },
  { re: /\bmkfs(\.\w+)?\s+\/dev\//, category: '数据破坏', reason: '格式化磁盘/分区（不可恢复）' },
  { re: /\bdd\s+.*\bof=\/dev\/sd|:\s*>\s*\/dev\/sd/, category: '数据破坏', reason: '覆盖磁盘/块设备（不可恢复）' },
  { re: /\b(wipefs|shred)\s+\/dev\//, category: '数据破坏', reason: '擦除磁盘数据（不可恢复）' },
  { re: /(?:>|>>)\s*\/etc\/(?:passwd|shadow|sudoers)\b/, category: '系统破坏', reason: '覆盖系统关键文件' },
  { re: /\bchmod\s+-R\s+777\s+\//, category: '安全破坏', reason: '根目录递归 777（系统将无法使用）' },
  { re: /\bchown\s+-R\s+\S+\s+\//, category: '安全破坏', reason: '根目录递归改属主' },
  { re: /\bDROP\s+DATABASE\b(?![\s\S]*\bIF\s+EXISTS\b)/i, category: '数据破坏', reason: '删除数据库（无 IF EXISTS 保护，不可恢复）' },
  { re: /\bformat\s+\b[a-z]:/i, category: '数据破坏', reason: '格式化磁盘分区（不可恢复）' },
  { re: /\bdiskpart\b/i, category: '数据破坏', reason: '磁盘分区工具（clean 将清空磁盘）' },
  { re: /\bwrite\s+erase\b/, category: '数据破坏', reason: '清除网络设备启动配置（write erase）' },
  // 独立 reload（行首或 ;|& 之后），排除 systemctl/nginx/service reload
  { re: /(?:^|[;|&])\s*reload(?:\s+(?:in\s+\d+|at\s+\S+|force|now|cancel))?(?:\s|$)/i, category: '服务中断', reason: '网络设备 reload（将中断转发）' },
  { re: /\brd\s+\/[a-z]*s[a-z]*\s+[a-z]:\\\s*$/i, category: '数据破坏', reason: '递归删除盘符根目录' },
  { re: /\bRemove-Item\s+-Recurse[^|]*[a-z]:\\\s*$/i, category: '数据破坏', reason: 'PowerShell 递归删除盘符根目录' },
]

/** dangerous：强制用户确认。 */
const DANGEROUS_PATTERNS = [
  // ── 数据破坏（Linux/macOS） ────────────────────────────────────────
  { re: /rm\s+(-[a-z]*r[a-z]*f[a-z]*|[a-z]*f[a-z]*r)\b/, category: '数据破坏', reason: '递归强制删除' },
  { re: /\brm\s+(-\w+\s+)*\/(?:\s|$)/, category: '数据破坏', reason: '删除根目录' },
  { re: /\bdd\s+.*\bof=\/dev\//, category: '数据破坏', reason: 'dd 直写磁盘/块设备' },
  { re: /\bmkfs(\.\w+)?\s/, category: '数据破坏', reason: '格式化文件系统' },
  { re: /\bfdisk\s+\/dev\/|\bparted\s+\/dev\/|\bsgdisk\s+\/dev\//, category: '数据破坏', reason: '磁盘分区操作' },
  { re: /\btruncate\s+-s\s+\d+\s+\//, category: '数据破坏', reason: '截断系统文件' },
  { re: /\bchmod\s+-R\s+(777|000)\b/, category: '安全破坏', reason: '递归修改权限' },
  { re: /\bchown\s+-R\b/, category: '安全破坏', reason: '递归修改属主' },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/, category: '数据破坏', reason: '丢弃未提交更改' },
  // ── 停机 / 重启 ────────────────────────────────────────────────────
  { re: /\b(shutdown|poweroff|halt|reboot)\b/, category: '服务中断', reason: '关机/重启' },
  { re: /\binit\s+[06]\b/, category: '服务中断', reason: '切换运行级（停机/重启）' },
  { re: /\bsystemctl\s+(reboot|poweroff|halt)\b/, category: '服务中断', reason: '关机/重启' },
  { re: /\bkill\s+-9\s+-1\b|\bkillall\s+(-9\s+)?[a-z-]+d\b/, category: '服务中断', reason: '击杀关键进程' },
  { re: /\bpkill\s+(-9\s+)?(sshd|systemd|init)\b/, category: '服务中断', reason: '击杀系统关键进程' },
  { re: /\bsystemctl\s+(stop|restart|disable)\s+(sshd|systemd-journald|dbus)\b/, category: '服务中断', reason: '停止/重启系统关键服务' },
  { re: /\bservice\s+\w+\s+(stop|restart)\b/, category: '服务中断', reason: '停止/重启服务（SysV）' },
  { re: /\bapt(?:-get)?\s+(remove|purge)\b|\byum\s+remove\b|\bdnf\s+remove\b/, category: '软件变更', reason: '卸载系统软件包' },
  { re: /\b(useradd|userdel|usermod)\b/, category: '账户变更', reason: '修改系统账户' },
  { re: /\bpasswd\b/, category: '账户变更', reason: '修改账户密码' },
  { re: /\bnft\s+(flush\s+ruleset|delete\s+ruleset)\b/, category: '网络中断', reason: '清空 nftables 规则（可能立即失联）' },
  // ── 网络中断 / 安全设备 ─────────────────────────────────────────────
  { re: /\biptables\s+(-F|--flush|-X|--delete-chain|-P\s+\w+\s+(DROP|REJECT))\b/, category: '网络中断', reason: '清空/收紧防火墙规则（可能立即失联）' },
  { re: /\bufw\s+disable\b|\bfirewall-cmd\s+--permanent\s+--zone=\w+\s+--set-target=(DROP|REJECT)\b/, category: '网络中断', reason: '关闭防火墙' },
  { re: /\bip\s+(link\s+set\s+\w+\s+down|addr\s+flush)\b|\bifconfig\s+\w+\s+down\b/, category: '网络中断', reason: '关闭网卡/清空地址（可能立即失联）' },
  { re: /\bsystemctl\s+(stop|disable)\s+(network|networking|NetworkManager)\b/, category: '网络中断', reason: '停止网络服务' },
  // ── 数据库破坏 ─────────────────────────────────────────────────────
  { re: /\bDROP\s+(DATABASE|TABLE)\b/i, category: '数据破坏', reason: '删除数据库/表' },
  { re: /\bTRUNCATE\s+(TABLE\s+)?\w+/i, category: '数据破坏', reason: '清空表数据' },
  { re: /\bDELETE\s+FROM\s+\w+(?!\s+WHERE)/i, category: '数据破坏', reason: '无 WHERE 的 DELETE（全表删除）' },
  { re: /\bUPDATE\s+\w+\s+SET\b(?![\s\S]*\bWHERE\b)/i, category: '数据破坏', reason: '无 WHERE 的 UPDATE（全表更新）' },
  { re: /\bFLUSHALL\b/i, category: '数据破坏', reason: '清空 Redis 全部数据' },
  // ── 间接执行守卫（SailFish indirection-guard 裁剪版） ───────────────
  { re: /\b(?:curl|wget)\b[^\n;]*\|\s*(?:ba|z|k|da)?sh\b/i, category: '代码执行', reason: '下载脚本直接执行（curl|sh）' },
  { re: /\b(?:ba|z|k|da)?sh\s+-c\s+['"]/i, category: '代码执行', reason: 'shell -c 间接执行' },
  { re: /\b(?:node|nodejs)\s+(?:-e|--eval)\b|\bpython3?\s+-c\b|\bperl\s+-e\b|\bruby\s+-e\b/i, category: '代码执行', reason: '解释器 -e 间接执行' },
  { re: /\beval\s+['"]/, category: '代码执行', reason: 'eval 间接执行' },
  { re: /\bfind\s+\S+.*-(?:exec|delete)\b/, category: '数据破坏', reason: 'find -exec/-delete 批量操作' },
  { re: /\bxargs\s+.*\b(?:ba|z|k|da)?sh\b/, category: '代码执行', reason: 'xargs 拼管道执行' },
  { re: /\becho\s+[^\n;]*\|\s*(?:ba|z|k|da)?sh\b/i, category: '代码执行', reason: 'echo|sh 拼接执行' },
  // ── 路径分区（写受保护路径，SailFish workspace-guard 简化版） ────────
  { re: /(?:>|>>)\s*\/etc\//, category: '系统破坏', reason: '写 /etc 系统配置' },
  { re: /(?:>|>>)\s*\/(?:var|boot|usr|System|Library)\//, category: '系统破坏', reason: '写系统目录' },
  { re: /\btee\s+(?:-a\s+)?\/(?:etc|var|boot|usr|System|Library)\//, category: '系统破坏', reason: 'tee 写系统目录' },
  // ── 网络设备（交换机/路由器/防火墙 CLI） ────────────────────────────
  { re: /\breboot\b(?:\s|$)/, category: '服务中断', reason: '设备重启' },
  { re: /\b(erase\s+\w+|delete\s+\w+:|format\s+\w+:)\b/, category: '数据破坏', reason: '清除设备配置/存储' },
  { re: /\bno\s+switchport\b|\bswitchport\s+trunk\s+allowed\s+vlan\s+none\b/, category: '网络中断', reason: '切断交换机端口/VLAN 通道' },
  { re: /\bshutdown\b(?:\s|$)/, category: '网络中断', reason: '关闭接口' },
  // ── Windows（cmd / PowerShell，跨平台通用） ──────────────────────────
  { re: /\bdel\s+\/[a-z]*f[a-z]*\b/i, category: '数据破坏', reason: '强制删除文件（不可恢复）' },
  { re: /\brd\s+\/[a-z]*s[a-z]*\b/i, category: '数据破坏', reason: '递归删除目录（不可恢复）' },
  { re: /\bformat\s+\b[a-z]:/i, category: '数据破坏', reason: '格式化磁盘分区' },
  { re: /\bshutdown\s+\/(s|r|f)\b/i, category: '服务中断', reason: '关机/重启' },
  { re: /\bstop-service\s+(spooler|dns|dhcp)\b/i, category: '服务中断', reason: '停止系统关键服务' },
  { re: /\bnetsh\s+interface\s+set\s+interface\s+.*\s+disabled\b/i, category: '网络中断', reason: '禁用网卡（可能立即失联）' },
  { re: /\bRemove-Item\s+-(Recurse|Force)\b/i, category: '数据破坏', reason: 'PowerShell 强制删除' },
  { re: /\b(Clear-Content|Set-Content)\b/i, category: '数据破坏', reason: '覆盖文件内容' },
  // ── 其他 ───────────────────────────────────────────────────────────
  { re: /\bchattr\s+\+i\b/, category: '操作陷阱', reason: '文件加不可变属性' },
  { re: /\bcrontab\s+-r\b/, category: '数据破坏', reason: '删除全部定时任务' },
]

/**
 * 判断命令的风险等级。
 * @param {string} command - 要执行的命令。
 * @returns {{level: 'none'|'dangerous'|'blocked', dangerous: boolean, blocked: boolean, reason?: string, category?: string}}
 */
export function inspectDangerousCommand(command) {
  if (!command) return { level: 'none', dangerous: false, blocked: false }
  // 去掉前导的空格/换行与 sudo 前缀后判断
  const normalized = command.trim().replace(/^sudo\s+/, '')
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.re.test(normalized)) {
      return { level: 'blocked', dangerous: true, blocked: true, reason: pattern.reason, category: pattern.category }
    }
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.re.test(normalized)) {
      return { level: 'dangerous', dangerous: true, blocked: false, reason: pattern.reason, category: pattern.category }
    }
  }
  return { level: 'none', dangerous: false, blocked: false }
}

/** 命中类别的中文展示。 */
export function describeDanger(inspection, command) {
  return {
    category: inspection.category ?? '未知',
    reason: inspection.reason ?? '可能造成不可逆影响',
    command,
  }
}

/** 写路径硬墙：系统关键文件（blocked，拒绝）。 */
const BLOCKED_WRITE_PATHS = [
  /^\/etc\/(passwd|shadow|sudoers|group|gshadow|ssh\/sshd_config)$/,
  /^C:\\Windows\\System32\\config\\SAM$/i,
  /^C:\\Windows\\System32\\drivers\\etc\\hosts$/i,
]

/** 写路径强制确认：系统目录。 */
const DANGEROUS_WRITE_PATHS = [
  /^\/(etc|var|boot|usr|System|Library)\//,
  /^C:\\Windows/i,
  /^C:\\Program Files/i,
  /^C:\\ProgramData/i,
]

/**
 * 判断远程写文件的路径风险（供 SFTP 写工具与未来文件功能复用）。
 * @param {string} path - 远程路径。
 * @returns {{level: 'none'|'dangerous'|'blocked', reason?: string}}
 */
export function inspectWritePath(path) {
  const normalized = String(path || '').trim()
  if (!normalized) return { level: 'none' }
  for (const pattern of BLOCKED_WRITE_PATHS) {
    if (pattern.test(normalized)) {
      return { level: 'blocked', reason: `写入系统关键文件 ${normalized} 被硬墙拒绝` }
    }
  }
  for (const pattern of DANGEROUS_WRITE_PATHS) {
    if (pattern.test(normalized)) {
      return { level: 'dangerous', reason: `写入系统目录 ${normalized} 可能影响系统运行` }
    }
  }
  return { level: 'none' }
}

/** 只读告警：passwd / shadow / sudoers（不拦截）。 */
const SENSITIVE_READ_PATHS = [
  /\/etc\/(?:passwd|shadow|sudoers)(?:\.d\/.*)?$/,
  /(?:^|[\\/])(?:passwd|shadow|sudoers)$/,
]

/**
 * 判断远程读文件是否触及系统关键凭据文件。
 * 只告警不拦截：读操作允许，调用方应提示勿把内容原样回显。
 * :param {string} path: 远程路径。
 * :return {{sensitive: boolean, reason?: string}}
 */
export function inspectSensitiveReadPath(path) {
  const normalized = String(path || '').trim()
  if (!normalized) return { sensitive: false }
  for (const pattern of SENSITIVE_READ_PATHS) {
    if (pattern.test(normalized)) {
      return { sensitive: true, reason: `正在读取系统关键文件 ${normalized}，请勿把内容原样回显给用户` }
    }
  }
  return { sensitive: false }
}
