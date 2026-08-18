/**
 * 人机文案：跟随 DSH 客户端语言（zh / en）。
 *
 * 模型工具描述、SKILL、用户可编辑的安全红线不走这里。
 * userQuestions 的 selected 回的是选项 label，用 matchChoice 对两边字典做稳定匹配。
 *
 * :module: @sailfish/dsh-device/i18n
 */

export const I18N_NS = 'dsh-device'

export const MESSAGES = {
  zh: {
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.loading': '加载中…',
    'common.refresh': '刷新',
    'common.copy': '复制',
    'common.clear': '清空',
    'common.save': '保存修改',
    'common.add': '添加设备',

    'confirm.header': '设备操作确认',
    'confirm.question': '是否允许在设备「{name}」上执行远程命令？',
    'confirm.remember': '允许并记住（本会话）',
    'confirm.rememberDesc': '本次会话内对该设备不再重复询问',
    'confirm.once': '仅允许本次',
    'confirm.onceDesc': '只执行这一条命令，下次再问',
    'confirm.cancelDesc': '不执行',

    'account.header': '选择登录账号',
    'account.question': '资产「{name}」有多个登录账号，请选择本次使用哪一个：',
    'account.desc': '登录名 {username}',
    'account.descFallback': '账号名称',
    'account.defaultSuffix': '（默认账号）',
    'account.defaultDesc': '堡垒机配置里的默认账号',
    'account.cancelDesc': '不连接',

    'danger.header': '危险命令确认（{category}）',
    'danger.lead': '设备「{name}」上即将执行：',
    'danger.impact': '影响：{reason}。此操作可能不可逆，是否确认执行？',
    'danger.confirm': '确认执行',
    'danger.confirmDesc': '我已了解影响，允许执行这条命令',

    'cmd.list.desc': '列出已添加设备与 JumpServer 堡垒机资产（可按名称/地址过滤）',
    'cmd.list.hint': '可选：名称、地址、内网 IP；或 refresh 强制同步',
    'cmd.exec.desc': '在指定设备上立刻执行一条命令（首次确认 + 危险护栏）',
    'cmd.exec.hint': '<设备ID或名称> <命令>',
    'cmd.exec.usage': '用法：/device-exec <设备ID或名称> <命令>',
    'cmd.sync.desc': '从 JumpServer 拉取最新有权限资产并刷新缓存',
    'cmd.sync.ok': '已同步 {total} 个堡垒机资产（可用 /device-list 查看）',
    'cmd.memory.desc': '查看设备环境探针与最近操作历史（缺省为全部设备概览）',
    'cmd.memory.hint': '可选：设备 ID、名称或地址',

    'slash.manual': '已添加设备：',
    'slash.manualNone': '已添加设备：暂无（可手动添加或从堡垒机资产导入）',
    'slash.assets': 'JumpServer 堡垒机资产（匹配到 {total} 个，同步于 {time}）：',
    'slash.assetsSummary': 'JumpServer 堡垒机资产池（共 {total} 个资产，同步于 {time}；可通过 query 搜索或用 device_add 纳管）：',
    'slash.assetsEmpty': 'JumpServer 堡垒机资产：暂无缓存（可用 jumpserver_sync 拉取）',
    'slash.syncError': '（上次同步错误：{error}）',
    'slash.unconfigured': 'JumpServer 堡垒机：未配置（可在设备面板或 Settings 中配置）',
    'slash.viaJump': '（经跳板机）',
    'slash.lanIp': ' | 内网IP={ip}',
    'slash.noUsername': '(未填用户名)',
    'slash.exec.device': '设备：{name}（{protocol} {host}）',
    'slash.exec.declined': '用户取消了本次操作',
    'slash.exec.blocked': '已拒绝执行（危险命令硬墙）',
    'slash.exec.noOutput': '(无输出)',
    'slash.memory.empty': '暂无设备记忆（先添加设备或执行过一次命令）',

    'http.untrusted': '来源不受信任',
    'http.badMethod': '不支持的方法 {method}',
    'http.missingId': '缺少 id',
    'http.missingDeviceOrCommand': '缺少 device 或 command',
    'http.missingPath': '缺少 path',
    'http.notFoundDevice': '未找到设备「{id}」',
    'http.notFoundAsset': '未找到资产「{id}」',
    'http.jmsUnconfigured': '尚未配置 JumpServer',
    'http.settingsUnavailable': 'settings 服务不可用',
    'http.notFile': '不是普通文件',
    'http.fileTooLarge': '文件过大（>128KB），请确认是私钥文件',
    'http.readFailed': '读取失败：{error}',

    'nav.title': '设备管理',
    'nav.device': '设备',
    'nav.rules': 'AI 规则',
    'nav.devices': '设备列表',
    'nav.add': '添加设备',
    'nav.bastion': '堡垒机',
    'nav.exec': '快速执行',
    'nav.memory': '操作记忆',

    'time.never': '从未',
    'time.justNow': '刚刚',
    'time.secondsAgo': '{n} 秒前',
    'time.minutesAgo': '{n} 分钟前',
    'time.hoursAgo': '{n} 小时前',
    'time.daysAgo': '{n} 天前',

    'list.loadFailed': '加载失败：{error}',
    'list.empty': '还没有添加任何设备。到「添加设备」页手动添加 SSH / Telnet 服务器，或在「堡垒机」页对接 JumpServer。',
    'list.authKey': '密钥',
    'list.authPassword': '密码',
    'list.configured': '（已配置）',
    'list.unconfigured': '（未配置）',
    'list.lastOp': '上次操作：{command}',
    'list.neverOp': '从未操作',
    'list.jump': '跳板',
    'list.lan': ' · 内网 {ip}',
    'list.timeout': '超时',
    'list.aborted': '中断',
    'list.deleteConfirm': '删除将同时清除该设备的记忆，确认？',
    'list.deleted': '已删除 {name}',
    'list.confirmDelete': '确认删除',
    'list.test': '测试',
    'list.exec': '执行',
    'list.edit': '编辑',
    'list.delete': '删除',
    'list.selected': '已选 {count} 台设备',
    'list.selectAll': '全选',
    'list.clearSelect': '取消选择',
    'list.batchEdit': '批量编辑',
    'list.batchDelete': '批量删除',
    'list.batchTest': '批量测试',
    'list.batchDeleteConfirm': '确定删除选中的 {count} 台设备吗？此操作不可逆。',
    'list.batchDeleted': '已删除 {count} 台设备',
    'list.batchEditTitle': '批量编辑设备（已选 {count} 台）',
    'list.batchEditHelp': '仅勾选并填写的字段会被批量覆盖，未勾选的字段保持原有配置不变。',
    'list.batchEditOk': '成功更新 {count} 台设备',
    'list.batchTesting': '正在批量测试连通性…',
    'list.batchTestOk': '批量测试完成：成功 {ok} 台，失败 {fail} 台',
    'list.modifyField': '修改',
    'list.apply': '应用修改',

    'jump.title': '跳板机（可选）',
    'jump.help': '经 SSH 跳板机再连目标；留空主机地址即不使用。凭据与设备密码一样加密落盘。',
    'jump.host': '跳板机地址',
    'jump.port': '端口（默认 22）',
    'jump.username': '用户名',
    'jump.needUsername': '跳板机必须填写用户名',

    'form.authType': '认证方式',
    'form.password': '密码',
    'form.privateKey': '私钥',
    'form.pem': '私钥（PEM）',
    'form.passphrase': '私钥口令',
    'form.keepPassword': '（已保存，留空保持不变；输入新值则覆盖）',
    'form.keepSecret': '（已保存，留空保持不变）',
    'form.pickKey': '选择私钥文件',
    'form.orPath': '或填本机路径（如 ~/.ssh/id_ed25519）',
    'form.orPathWin': '或填本机路径（如 ~/.ssh/id_ed25519 或 C:\\Users\\you\\.ssh\\id_ed25519）',
    'form.readPath': '读取路径',
    'form.fileTooLarge': '文件过大（{size}KB > 128KB），请确认是私钥文件',
    'form.readOk': '已读取 {name}',
    'form.readJumpOk': '已读取跳板机私钥 {name}',
    'form.readPersist': '已读取 {name}，保存后密钥内容将持久化存储',
    'form.readFail': '文件读取失败',
    'form.readHostOk': '已读取 {path}（{size} 字节）',
    'form.needHost': '请填写主机地址',
    'form.needTelnetUser': 'Telnet 设备必须填写用户名',
    'form.savedEdit': '已保存修改',
    'form.savedAdd': '已添加设备',
    'form.probedLan': '已自动获取内网 IP：{ip}',
    'form.name': '名称',
    'form.host': '主机地址（IP 或域名）',
    'form.lanIp': '内网 IP（可选，留空自动探测）',
    'form.protocol': '协议',
    'form.port': '端口（默认 {port}）',
    'form.username': '用户名',
    'form.pickHint': '弹出文件选择窗口；也可在下方填路径让主机端读取',
    'form.persistHint': '读取后内容会持久化保存到设备配置中，路径本身不会保存。',
    'form.group': '分组（可选）',
    'form.encoding': '输出编码',
    'form.gbk': 'GBK（中文 Windows/国标）',
    'form.latin1': 'Latin-1（西欧）',
    'form.prompt': '提示符正则（可选，覆盖全局配置）',
    'form.comment': '备注（可选）',
    'form.cancelEdit': '取消编辑',

    'bastion.saved': '已保存堡垒机配置',
    'bastion.synced': '同步完成：{total} 个资产',
    'bastion.help': '对接 JumpServer 堡垒机后，AI 可通过 device_list / device_exec 直接查看并操作堡垒机资产（经 connection-token 取直连参数）。',
    'bastion.url': 'JumpServer 地址（如 https://jms.example.com）',
    'bastion.needUrl': '请输入 JumpServer 地址',
    'bastion.urlProtocolRequired': 'JumpServer 地址必须以 http:// 或 https:// 开头（例如 http://192.168.1.100:8080）',
    'bastion.passwordSaved': '密码（已保存，留空保持不变）',
    'bastion.password': '密码',
    'bastion.apiHint': 'API 认证会直接复用 DeepSeek Harness 的 API Key（DEEPSEEK_API_KEY），无需单独配置；被堡垒机拒绝或未配置时自动改用用户名/密码登录。',
    'bastion.defaultAccount': '默认资产账号（可选，作为弹窗首选）',
    'bastion.ssl': '校验 SSL 证书（自签名证书需取消勾选）',
    'bastion.save': '保存配置',
    'bastion.test': '测试连接',
    'bastion.sync': '同步资产',
    'bastion.lastError': '上次同步错误：{error}',
    'bastion.lastSync': '上次同步：{time}，共 {total} 个资产',
    'bastion.neverSync': '尚未同步',
    'bastion.assets': '堡垒机资产',
    'bastion.searchPlaceholder': '搜索资产名称、IP、协议或备注…',
    'bastion.searchResult': '共 {total} 个资产，匹配 {count} 个',
    'bastion.totalAssets': '共 {total} 个资产',
    'bastion.pageInfo': '第 {current} / {total} 页',
    'bastion.pageSize': '{size} 条/页',
    'bastion.firstPage': '首页',
    'bastion.prevPage': '上一页',
    'bastion.nextPage': '下一页',
    'bastion.lastPage': '末页',
    'bastion.importAll': '一键导入',
    'bastion.importing': '导入中…',
    'bastion.importBatchOk': '成功导入 {count} 台设备',
    'bastion.imported': '已导入',
    'bastion.historyTitle': '连接历史',
    'bastion.historyPlaceholder': '选择已保存的堡垒机连接…',
    'bastion.historyUse': '载入配置',
    'bastion.historyDelete': '删除',
    'bastion.historySavedPassword': '已载入保存的密码（留空沿用）',
    'bastion.historyNone': '暂无连接历史',
    'bastion.importOk': '已导入，可到「设备列表」补全认证信息',
    'bastion.import': '导入为设备',

    'exec.bastionLabel': '堡垒机 · {name}（{address}）',
    'exec.running': '执行中…',
    'exec.blocked': '已拒绝执行（{category}：{reason}）\n该命令属于不可逆破坏，不允许执行。',
    'exec.failed': '执行失败：{error}',
    'exec.copied': '已复制输出',
    'exec.copyFail': '复制失败（浏览器未授权剪贴板）',
    'exec.target': '目标设备',
    'exec.recent': '最近命令',
    'exec.pickRecent': '（选择填充）',
    'exec.command': '命令（⌘/Ctrl + Enter 执行）',
    'exec.run': '执行',
    'exec.shortcut': '⌘/Ctrl + Enter 快速执行',
    'exec.firstConfirm': '本会话首次操作设备「{name}」，是否允许执行远程命令？',
    'exec.allowOnce': '允许本次',
    'exec.pickAccount': '该资产有多个登录账号，请选择本次使用哪一个：',
    'exec.danger': '危险命令（{category}）：{reason}',
    'exec.dangerConfirm': '我已了解影响，确认执行',
    'exec.output': '输出',
    'exec.noOutput': '（尚无输出）',
    'exec.emptyOutput': '(无输出)',

    'memory.empty': '暂无记忆。连接设备执行命令后，会自动记录环境信息与操作历史。',
    'memory.filter': '筛选设备',
    'memory.all': '全部设备',
    'memory.noEnv': '环境：暂无探针信息',
    'memory.host': '主机 {host}',
    'memory.envReady': '环境已探针',
    'memory.user': ' · 用户 {user}',
    'memory.raw': ' · 探针输出 {raw}…',
    'memory.noHistory': '操作历史：无',

    'rules.loadingFail': '读取配置失败，已显示默认规则：{error}',
    'rules.saved': '已保存 AI 规则，将在下一次 AI 请求时生效',
    'rules.restored': '已恢复默认规则',
    'rules.help1': '以下规则以「最高优先级」注入 AI 的系统提示词——排序在所有身份描述、工具说明与对话习惯之前（仅次于 Harness 自身身份行）。',
    'rules.help2': '编辑后保存即生效；也可直接修改 `$DSH_HOME/settings.yaml` 的 `device.safetyRules`（热加载）。清空并保存 = 恢复默认。',
    'rules.save': '保存规则',
    'rules.savedIdle': '已保存',
    'rules.restore': '恢复默认',
    'rules.guardHint': '危险命令的强制确认由代码护栏强制执行，与这里编辑的规则文本无关。',
  },
  en: {
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.loading': 'Loading…',
    'common.refresh': 'Refresh',
    'common.copy': 'Copy',
    'common.clear': 'Clear',
    'common.save': 'Save changes',
    'common.add': 'Add device',

    'confirm.header': 'Confirm device access',
    'confirm.question': 'Allow remote commands on “{name}”?',
    'confirm.remember': 'Allow and remember (this session)',
    'confirm.rememberDesc': 'Do not ask again for this device in this session',
    'confirm.once': 'Allow this time only',
    'confirm.onceDesc': 'Run this command only; ask again next time',
    'confirm.cancelDesc': 'Do not run',

    'account.header': 'Choose login account',
    'account.question': 'Asset “{name}” has multiple login accounts. Choose one:',
    'account.desc': 'Username {username}',
    'account.descFallback': 'Account name',
    'account.defaultSuffix': ' (default)',
    'account.defaultDesc': 'Default account from bastion settings',
    'account.cancelDesc': 'Do not connect',

    'danger.header': 'Dangerous command ({category})',
    'danger.lead': 'About to run on “{name}”:',
    'danger.impact': 'Impact: {reason}. This may be irreversible. Continue?',
    'danger.confirm': 'Confirm',
    'danger.confirmDesc': 'I understand the impact and allow this command',

    'cmd.list.desc': 'List manual devices and JumpServer assets (filter by name or address)',
    'cmd.list.hint': 'Optional: name, address, LAN IP; or refresh to sync',
    'cmd.exec.desc': 'Run a command on a device now (first-use confirm + danger guard)',
    'cmd.exec.hint': '<device id or name> <command>',
    'cmd.exec.usage': 'Usage: /device-exec <device id or name> <command>',
    'cmd.sync.desc': 'Pull the latest permitted JumpServer assets and refresh the cache',
    'cmd.sync.ok': 'Synced {total} bastion assets (use /device-list to inspect)',
    'cmd.memory.desc': 'Show environment probe and recent history (all devices if omitted)',
    'cmd.memory.hint': 'Optional: device id, name, or address',

    'slash.manual': 'Added devices:',
    'slash.manualNone': 'Added devices: none',
    'slash.assets': 'JumpServer assets (matched {total}, synced {time}):',
    'slash.assetsSummary': 'JumpServer asset pool ({total} assets, synced {time}; use query to search or device_add to manage):',
    'slash.assetsEmpty': 'JumpServer assets: no cache (run jumpserver_sync)',
    'slash.syncError': '(last sync error: {error})',
    'slash.unconfigured': 'JumpServer: not configured (use the device panel or Settings)',
    'slash.viaJump': ' (via jump host)',
    'slash.lanIp': ' | LAN={ip}',
    'slash.noUsername': '(no username)',
    'slash.exec.device': 'Device: {name} ({protocol} {host})',
    'slash.exec.declined': 'Cancelled by the user',
    'slash.exec.blocked': 'Blocked (destructive-command hard wall)',
    'slash.exec.noOutput': '(no output)',
    'slash.memory.empty': 'No device memory yet (add a device or run a command first)',

    'http.untrusted': 'Untrusted origin',
    'http.badMethod': 'Unsupported method {method}',
    'http.missingId': 'Missing id',
    'http.missingDeviceOrCommand': 'Missing device or command',
    'http.missingPath': 'Missing path',
    'http.notFoundDevice': 'Device “{id}” not found',
    'http.notFoundAsset': 'Asset “{id}” not found',
    'http.jmsUnconfigured': 'JumpServer is not configured',
    'http.settingsUnavailable': 'settings service unavailable',
    'http.notFile': 'Not a regular file',
    'http.fileTooLarge': 'File too large (>128KB); confirm this is a private key',
    'http.readFailed': 'Read failed: {error}',

    'nav.title': 'Devices',
    'nav.device': 'Devices',
    'nav.rules': 'AI rules',
    'nav.devices': 'Device list',
    'nav.add': 'Add device',
    'nav.bastion': 'Bastion',
    'nav.exec': 'Quick exec',
    'nav.memory': 'Memory',

    'time.never': 'Never',
    'time.justNow': 'Just now',
    'time.secondsAgo': '{n}s ago',
    'time.minutesAgo': '{n}m ago',
    'time.hoursAgo': '{n}h ago',
    'time.daysAgo': '{n}d ago',

    'list.loadFailed': 'Failed to load: {error}',
    'list.empty': 'No devices yet. Add an SSH/Telnet server on Add device, or connect JumpServer on Bastion.',
    'list.authKey': 'Key',
    'list.authPassword': 'Password',
    'list.configured': ' (set)',
    'list.unconfigured': ' (missing)',
    'list.lastOp': 'Last command: {command}',
    'list.neverOp': 'Never used',
    'list.jump': 'jump',
    'list.lan': ' · LAN {ip}',
    'list.timeout': 'timeout',
    'list.aborted': 'aborted',
    'list.deleteConfirm': 'Delete this device and its memory?',
    'list.deleted': 'Deleted {name}',
    'list.confirmDelete': 'Delete',
    'list.test': 'Test',
    'list.exec': 'Run',
    'list.edit': 'Edit',
    'list.delete': 'Delete',
    'list.selected': '{count} devices selected',
    'list.selectAll': 'Select All',
    'list.clearSelect': 'Clear selection',
    'list.batchEdit': 'Batch Edit',
    'list.batchDelete': 'Batch Delete',
    'list.batchTest': 'Batch Test',
    'list.batchDeleteConfirm': 'Delete the {count} selected devices? This cannot be undone.',
    'list.batchDeleted': 'Deleted {count} devices',
    'list.batchEditTitle': 'Batch Edit Devices ({count} selected)',
    'list.batchEditHelp': 'Only checked fields will be updated. Unchecked fields will remain unchanged.',
    'list.batchEditOk': 'Successfully updated {count} devices',
    'list.batchTesting': 'Batch testing connectivity…',
    'list.batchTestOk': 'Batch test finished: {ok} succeeded, {fail} failed',
    'list.modifyField': 'Edit',
    'list.apply': 'Apply Changes',

    'jump.title': 'Jump host (optional)',
    'jump.help': 'Reach the target via an SSH jump host. Leave host empty to disable. Credentials are encrypted like the device password.',
    'jump.host': 'Jump host',
    'jump.port': 'Port (default 22)',
    'jump.username': 'Username',
    'jump.needUsername': 'Jump host requires a username',

    'form.authType': 'Auth',
    'form.password': 'Password',
    'form.privateKey': 'Private key',
    'form.pem': 'Private key (PEM)',
    'form.passphrase': 'Key passphrase',
    'form.keepPassword': '(saved; leave blank to keep, type to replace)',
    'form.keepSecret': '(saved; leave blank to keep)',
    'form.pickKey': 'Choose key file',
    'form.orPath': 'Or a path on this machine (e.g. ~/.ssh/id_ed25519)',
    'form.orPathWin': 'Or a path on this machine (e.g. ~/.ssh/id_ed25519 or C:\\Users\\you\\.ssh\\id_ed25519)',
    'form.readPath': 'Read path',
    'form.fileTooLarge': 'File too large ({size}KB > 128KB); confirm this is a private key',
    'form.readOk': 'Read {name}',
    'form.readJumpOk': 'Read jump-host key {name}',
    'form.readPersist': 'Read {name}; the key will be stored when you save',
    'form.readFail': 'Failed to read file',
    'form.readHostOk': 'Read {path} ({size} bytes)',
    'form.needHost': 'Host is required',
    'form.needTelnetUser': 'Telnet devices require a username',
    'form.savedEdit': 'Saved changes',
    'form.savedAdd': 'Device added',
    'form.probedLan': 'Detected LAN IP: {ip}',
    'form.name': 'Name',
    'form.host': 'Host (IP or domain)',
    'form.lanIp': 'LAN IP (optional; probed if empty)',
    'form.protocol': 'Protocol',
    'form.port': 'Port (default {port})',
    'form.username': 'Username',
    'form.pickHint': 'Opens a file picker; or enter a path for the host to read',
    'form.persistHint': 'The key content is stored with the device; the path is not saved.',
    'form.group': 'Group (optional)',
    'form.encoding': 'Output encoding',
    'form.gbk': 'GBK (Chinese Windows)',
    'form.latin1': 'Latin-1 (Western Europe)',
    'form.prompt': 'Prompt regex (optional; overrides global)',
    'form.comment': 'Note (optional)',
    'form.cancelEdit': 'Cancel edit',

    'bastion.saved': 'Bastion settings saved',
    'bastion.synced': 'Synced {total} assets',
    'bastion.help': 'After JumpServer is connected, the AI can list and operate assets via device_list / device_exec (connection-token for direct params).',
    'bastion.url': 'JumpServer URL (e.g. https://jms.example.com)',
    'bastion.needUrl': 'Please enter JumpServer URL',
    'bastion.urlProtocolRequired': 'JumpServer URL must start with http:// or https:// (e.g. http://192.168.1.100:8080)',
    'bastion.passwordSaved': 'Password (saved; leave blank to keep)',
    'bastion.password': 'Password',
    'bastion.apiHint': 'API auth reuses the DeepSeek Harness API key (DEEPSEEK_API_KEY). If the bastion rejects it or it is unset, username/password is used.',
    'bastion.defaultAccount': 'Default asset account (optional; preferred in the picker)',
    'bastion.ssl': 'Verify TLS (uncheck for self-signed certs)',
    'bastion.save': 'Save',
    'bastion.test': 'Test connection',
    'bastion.sync': 'Sync assets',
    'bastion.lastError': 'Last sync error: {error}',
    'bastion.lastSync': 'Last sync: {time}, {total} assets',
    'bastion.neverSync': 'Not synced yet',
    'bastion.assets': 'Bastion assets',
    'bastion.searchPlaceholder': 'Search asset name, IP, protocol or note…',
    'bastion.searchResult': '{count} matched of {total} assets',
    'bastion.totalAssets': '{total} assets in total',
    'bastion.pageInfo': 'Page {current} of {total}',
    'bastion.pageSize': '{size} / page',
    'bastion.firstPage': 'First',
    'bastion.prevPage': 'Prev',
    'bastion.nextPage': 'Next',
    'bastion.lastPage': 'Last',
    'bastion.importAll': 'Import All',
    'bastion.importing': 'Importing…',
    'bastion.importBatchOk': 'Successfully imported {count} devices',
    'bastion.imported': 'Imported',
    'bastion.historyTitle': 'Connection history',
    'bastion.historyPlaceholder': 'Select saved bastion connection…',
    'bastion.historyUse': 'Load profile',
    'bastion.historyDelete': 'Delete',
    'bastion.historySavedPassword': 'Saved password loaded (leave blank to keep)',
    'bastion.historyNone': 'No connection history',
    'bastion.importOk': 'Imported. Finish credentials on Device list.',
    'bastion.import': 'Import as device',

    'exec.bastionLabel': 'Bastion · {name} ({address})',
    'exec.running': 'Running…',
    'exec.blocked': 'Blocked ({category}: {reason})\nThis command is irreversible and is not allowed.',
    'exec.failed': 'Failed: {error}',
    'exec.copied': 'Output copied',
    'exec.copyFail': 'Copy failed (clipboard permission denied)',
    'exec.target': 'Target',
    'exec.recent': 'Recent commands',
    'exec.pickRecent': '(pick to fill)',
    'exec.command': 'Command (⌘/Ctrl + Enter)',
    'exec.run': 'Run',
    'exec.shortcut': '⌘/Ctrl + Enter to run',
    'exec.firstConfirm': 'First command on “{name}” in this session. Allow remote commands?',
    'exec.allowOnce': 'Allow this time',
    'exec.pickAccount': 'This asset has multiple login accounts. Choose one:',
    'exec.danger': 'Dangerous command ({category}): {reason}',
    'exec.dangerConfirm': 'I understand, run it',
    'exec.output': 'Output',
    'exec.noOutput': '(no output yet)',
    'exec.emptyOutput': '(no output)',

    'memory.empty': 'No memory yet. Connect and run a command to record environment and history.',
    'memory.filter': 'Filter device',
    'memory.all': 'All devices',
    'memory.noEnv': 'Environment: no probe yet',
    'memory.host': 'Host {host}',
    'memory.envReady': 'Environment probed',
    'memory.user': ' · user {user}',
    'memory.raw': ' · probe {raw}…',
    'memory.noHistory': 'History: none',

    'rules.loadingFail': 'Failed to load settings; showing defaults: {error}',
    'rules.saved': 'AI rules saved; they apply on the next model request',
    'rules.restored': 'Restored default rules',
    'rules.help1': 'These rules are injected as the highest-priority system prompt—before persona, tool notes, and chat habits (after the Harness identity line only).',
    'rules.help2': 'Save to apply, or edit `device.safetyRules` in `$DSH_HOME/settings.yaml` (hot-reloaded). Save an empty value to restore defaults.',
    'rules.save': 'Save rules',
    'rules.savedIdle': 'Saved',
    'rules.restore': 'Restore defaults',
    'rules.guardHint': 'Dangerous-command confirmation is enforced in code, independent of this text.',
  },
}

/**
 * 替换 ``{name}`` 占位符。
 *
 * :param {string} template: 文案模板。
 * :param {object} [vars]: 占位符取值。
 * :return {string}
 */
export function interpolate(template, vars) {
  if (!vars || typeof template !== 'string') return template
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])))
}

/**
 * 按语言取翻译函数；缺 key 回退中文，再回退 key 本身。
 *
 * :param {string} [lang]: zh 或 en。
 * :return {function}
 */
export function createTranslator(lang = 'zh') {
  const table = MESSAGES[lang] || MESSAGES.zh
  return (key, vars) => interpolate(table[key] ?? MESSAGES.zh[key] ?? key, vars)
}

/**
 * 用中英两套 label 反查稳定 key（userQuestions 只回 label）。
 *
 * :param {string} selected: 用户点中的选项文字。
 * :param {string[]} keys: 候选文案 key。
 * :return {string|null}
 */
export function matchChoice(selected, keys) {
  const text = String(selected || '')
  for (const key of keys) {
    if (text === MESSAGES.zh[key] || text === MESSAGES.en[key]) return key
  }
  return null
}

/**
 * 去掉默认账号选项上的语言后缀，还原账号名。
 *
 * :param {string} selected: 选项 label。
 * :return {string}
 */
export function stripDefaultAccountLabel(selected) {
  let name = String(selected || '')
  for (const suffix of [MESSAGES.zh['account.defaultSuffix'], MESSAGES.en['account.defaultSuffix']]) {
    if (suffix && name.endsWith(suffix)) name = name.slice(0, -suffix.length)
  }
  return name
}

/**
 * 校验中英 key 对齐。
 *
 * :return {string[]} 只在一边出现的 key。
 */
export function missingI18nKeys() {
  const zhKeys = Object.keys(MESSAGES.zh)
  const enKeys = Object.keys(MESSAGES.en)
  const missing = []
  for (const key of zhKeys) {
    if (!(key in MESSAGES.en)) missing.push(`en:${key}`)
  }
  for (const key of enKeys) {
    if (!(key in MESSAGES.zh)) missing.push(`zh:${key}`)
  }
  return missing
}
