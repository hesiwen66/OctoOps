# @sailfish/dsh-device

[English](README.md) · [中文](README.zh.md)

DeepSeek Harness（DSH）设备运维插件：把 [SailFish](https://github.com) 项目里最核心的远程运维能力带进 DSH —— JumpServer 堡垒机对接、SSH/Telnet 设备管理、AI 对话远程运维，以及在 Web 页面里的设备管理面板。

## 功能

1. **JumpServer 堡垒机对接**：拉取有权限的资产列表 → 执行时经 connection-token API 取直连参数（host/port/协议/账号/密码或私钥），支持 SSH 与 Telnet 资产。**认证直接复用 DeepSeek Harness 的 API Key（DEEPSEEK_API_KEY），无需单独配置**；被堡垒机拒绝或未配置时自动回退用户名/密码登录。
2. **手动添加 SSH / Telnet 服务器**：密码 / 私钥（PEM + 口令）、跳板机、UTF-8/GBK/Latin-1/UTF-16LE 编码、Telnet 提示符自定义。**凭据 AES-256-GCM 加密落盘**（`$DSH_HOME/storages/device_secrets/`，PBKDF2 200k 派生 + master.key 盐，旧明文自动迁移加密，设备清单只存"已配置"标志）——参考 SailFish credential g1: 方案且覆盖其遗漏（SailFish 的 SSH 会话密码仍明文）。**私钥支持原生文件选择弹窗**（macOS/Windows 通用）或本机路径读取（`~` 展开，Windows 盘符路径原样使用）。
3. **AI 对话运维**：模型工具 `device_list` / `device_exec` / `device_test` / `device_add` / `device_remove` / `device_memory` / `device_read_file` / `device_write_file` / `device_find` / `jumpserver_sync`。对话中需要上其他设备时，AI 先查列表、自动连接执行；默认策略下本会话内每台设备首次执行前会弹确认；不需要时回到本机继续。**连接堡垒机资产时按资产账号列表弹窗选择登录账号**（本会话记住；单账号自动使用）。**`device_find` 按内网/外网 IP 精确匹配**已添加设备与堡垒机资产（设备记录带内网 IP 字段，可自动探测回填），跨机排查时先匹配再连接。
4. **SFTP 文件层（参考 SailFish sftp.service 裁剪）**：`device_read_file`/`device_write_file` 经 ssh2 内置 sftp 子系统复用池连接——AI 改远程配置不再 heredoc 转义；读上限 1MB/可调，读 passwd/shadow/sudoers 附加 warning（不拦截），写系统目录强制确认、写 passwd/shadow/sudoers 等系统关键文件硬墙拒绝。
5. **连接复用（持久会话池）**：同一设备的命令跨调用复用连接——SSH 并发多 channel、Telnet 串行排队；空闲 10 分钟自动断开（`sessionIdleMs` 可调）、LRU 逐出、连接层错误懒重连一次、卸载时全部关闭。本地实测第二条命令 0.03s vs 首次 0.14s，远程高延迟设备差距更大。
6. **输出清洗**：ANSI 转义/光标序列剥离、CRLF 归一、命令回显与残留提示符清理——AI 拿到的输出干净可判读（`lib/clean.js`）。
7. **命令审计体系（参考 SailFish command-audit 裁剪）**：三级判定——**blocked 硬墙**（`rm -rf /`、fork 炸弹、mkfs、dd of=/dev/sd、覆盖 passwd/sudoers、DROP DATABASE 无 IF EXISTS、format C:、diskpart、网络设备 write erase / 独立 reload 等：任何情况直接拒绝执行，不弹确认）；**dangerous 强制确认**（重启/删数据/改网络/清配置等，不受 confirmPolicy 影响）；**间接执行守卫**（curl|sh、sh -c、node -e、find -exec、echo|sh 等一律强制确认）与**路径分区**（写 /etc、/var、/boot 等系统目录强制确认）。`systemctl reload` / `nginx -s reload` 不按网络设备 reload 拦截。**跨平台**：同时覆盖 Linux/macOS、Windows（del /f、rd /s、format、shutdown /r、Remove-Item、netsh）与网络设备 CLI。`dangerPolicy: never` 可关闭。
8. **AI 最高优先级安全红线（可编辑）**：独立系统提示词段，order **-20**——排在 persona（0）与所有工具规则之前（仅次于 Harness 身份行 -100），真正最高优先级。文本存于 `device.safetyRules` 设置：面板「AI 规则」页签可视化编辑（保存/恢复默认），也可直接改 `$DSH_HOME/settings.yaml` 热加载；默认内容为禁止绕过确认、用户拒绝即最终决定、先查记忆再动手、敏感信息不入输出、变更前先备份。危险命令的强制确认由代码护栏独立执行，与规则文本无关。
9. **设备操作记忆模块**：每次执行自动记录（哪台机器、什么命令、退出码、时间、输出摘要），首次连接自动采集环境探针（主机名/系统/内核/发行版/包管理器/常用工具/用户/shell/工作目录，**24 小时 TTL**；POSIX 失败自动切 Windows cmd 探针——参考 SailFish host-profile 命令集）。`device_memory` 工具与面板「操作记忆」页签可查询；删除设备时记忆一并清理。
10. **Web 页面入口**：侧边栏底部「设备」按钮（Settings 旁）打开设备管理面板 —— 设备列表（状态点 + 上次操作摘要 + 测试/执行/编辑/删除）、添加设备表单（原生文件选择弹窗读取私钥）、堡垒机配置与资产同步（含一键导入、账号弹窗选择）、快速执行（最近命令 + ⌘/Ctrl+Enter + 危险命令内联确认 + blocked 红墙提示）、操作记忆、AI 规则六个页签。
11. **SailFish 运维技能移植**：随包携带 27 个运维 skills（systemd-service、nginx-config、docker-operations、mysql-operations、redis-operations、postgresql-operations、firewall-rules、log-analysis、ssh-security、cron-tasks、ansible-playbook、python-venv、node-project、java-deploy、git-workflow、network-troubleshoot、k8s-operations 等），以运行时 skill 注册进 `skill` 目录，AI 对话可直接调用。
12. **斜杠命令（输入 `/` 发现）**：`/device-list`、`/device-exec <设备> <命令>`、`/jumpserver-sync`、`/device-memory [设备]`。菜单展示备注（`description`）与参数提示（`input.hint`）；选中后不经模型、直接执行，与对应工具共用逻辑。官方菜单是扁平列表，没有插件分类字段。
13. **界面语言**：斜杠备注、确认框、设备面板跟随 DeepSeek Harness 客户端语言（中文 / English）；模型工具描述与技能正文不随界面切换。

## 安装

```sh
# 开发/本地路径安装（link 模式，改代码即时生效）
dsh plugin --profile web add /path/to/dsh-device

# 或打 tarball 分发
cd dsh-device && pnpm pack
dsh plugin --profile web add ./sailfish-dsh-device-0.1.0.tgz
```

装完后重启 `dsh web`（插件行在组合中生效需要重启；profile 的 hmr 在 Web 面默认关闭）：

```sh
# 先停掉现有 dsh web 进程，再启动
dsh web
```

验证：

```sh
dsh --profile web --dump-config   # 应看到 "# == @sailfish/dsh-device" 层
```

## 使用

### 面板

打开 `http://127.0.0.1:3080`，左侧栏底部点「设备」：

- **设备列表**：查看手动添加的设备（SSH/Telnet 协议图标），测试连通性、快速执行、编辑、删除。
- **添加设备**：协议 SSH/Telnet、主机、端口、用户名、密码或私钥（可填本地私钥文件路径一键读取）、跳板机（host/port/user/密码或私钥）、输出编码（utf8/gbk/latin1/utf16le）、Telnet 提示符正则。
- **堡垒机**：填写 JumpServer 地址/账号，保存 → 测试连接 → 同步资产；API 认证直接复用 `DEEPSEEK_API_KEY`，被拒绝时回退用户名/密码；资产可一键导入为设备。
- **快速执行**：选手动设备或堡垒机资产 → 输入命令 → 看输出与退出码；本会话每台设备首次执行会确认；堡垒机资产有多个登录账号时会弹窗选择。
- **操作记忆**：查看每台机器的环境信息（探针采集）与最近操作历史（命令/退出码/输出摘要）。

### AI 对话

直接对 AI 说，例如：

> 看看核心交换机上有没有异常日志

AI 会：`device_list` 查设备 → `device_exec` 连接执行（首次弹确认）→ 汇报结果。也可显式要求：

> 用 device_exec 在 nginx 服务器上重启 nginx 服务

操作前可以问记忆：

> 这台 nginx 服务器之前做过什么？环境是什么？

AI 会用 `device_memory` 查看环境探针与操作历史后再动手。

跨机排查时，AI 会用 `device_find` 按 **内网/外网 IP 精确匹配**：

> 这台 web-01 上看到日志报错指向 192.168.1.20，看看那台机器怎么了

AI 会：`device_exec` 在 web-01 上查线索 → 用 `device_find` 按 IP 在已添加设备与堡垒机资产中匹配 → 匹配到再 `device_exec` 连过去（首次弹确认）；匹配不到会停下来询问，不会臆造目标或凭据。设备记录新增 **内网 IP 字段**：添加设备时可选填；留空会在保存后或首次执行命令时由环境探针自动探测回填（Linux/macOS/Windows 均支持），设备列表与 `device_list` 工具输出中都会显示。

### 斜杠命令

输入框打 `/`，按名称过滤，菜单里能看到备注说明：

```
/device-list
/device-list nginx
/device-list refresh
/device-exec web-01 df -h
/jumpserver-sync
/device-memory
/device-memory web-01
```

`/device-exec` 会走与对话工具相同的首次确认和危险护栏，不经过模型。

### 设置

除面板外，`$DSH_HOME/settings.yaml` 的 `device:` 段可直接手改（热加载）：

```yaml
device:
  jumpserverUrl: https://jms.example.com
  jumpserverUsername: ops
  jumpserverPassword: your-password
  # API 认证复用 DEEPSEEK_API_KEY，无需单独配 Token；被堡垒机拒绝时回退上面的账密
  jumpserverDefaultAccount: '' # 可选，账号弹窗中的首选账号
  jumpserverRejectUnauthorized: true
  confirmPolicy: auto          # auto | always | never
  defaultTimeoutMs: 30000
  maxOutputChars: 40000
  telnetPromptRegex: '[$#>~%]\s*$'
  telnetLoginRegex: '(login|username)\s*:'
  telnetPasswordRegex: 'password\s*:'
```

## 架构说明

一个包，两面：

```
dsh-device/
├── package.json        # dsh.bundle.patch → cordis.patch.yml；dsh.client → lib/client.js
├── cordis.patch.yml    # 向组合插入 device-ops 行（含部署默认配置）
├── lib/
│   ├── index.js        # 主机端插件：工具、HTTP 路由、settings 命名空间、skills、系统提示词
│   ├── ssh.js          # ssh2 封装：密码/私钥/跳板机/超时/截断/编码
│   ├── telnet.js       # 纯 Node telnet 客户端：IAC 协商、登录序列、提示符检测、--More-- 翻页
│   ├── jumpserver.js   # JumpServer API：auth、资产分页、connection-token 直连参数
│   ├── repo.js         # 设备仓库：storage KV 持久化 + 内存缓存 + 串行写链
│   └── client.js       # 浏览器端插件：侧边栏入口 + 设备管理面板（手写 factory 形态 bundle）
└── skills/             # 27 个 SailFish 运维技能（DSH frontmatter 格式）
```

关键设计决策：

- **可选服务全部经 `ctx.inject()` 挂载**：`settings` / `webServer` / `skills` 就绪才挂对应能力，缺失（如 headless）不影响工具注册。
- **HTTP 路由按路径唯一 + 方法分发**：`webServer` 要求 (kind, path) 唯一，且 exact 路由按字面路径匹配（不支持 `:id`），所以按 id 的操作走 JSON body；同时避开 `dsh-client-modules` 的 `/plugins` 前缀路由（exact 优先）。
- **面板不走 /api/settings.\* RPC**：Web 网关只暴露内置白名单命名空间（`settings-not-exposed`），第三方命名空间无法经 RPC 读写；面板直连本插件路由，主机端落到 settings 用户层（settings.yaml），密码字段只回传 `hasPassword` 标记。
- **设备清单存 storage KV**（`$DSH_HOME/storages/device_store.json`），与 settings 分离：设备编辑频率高且含多级秘密字段，避免 settings 文档膨胀与修订冲突。
- **确认机制**：`device_exec` 内走 `userQuestions` 服务弹确认（web 面板内联渲染）；策略 `auto`（每会话每设备一次）/`always`/`never`，参数 `confirm` 可覆盖；无确认通道时快速失败并提示模型改用 `ask_user_question`。
- **安全**：面板路由校验 Host/Origin（回环或同源）；settings 密码字段 `role('secret')`；输出有字符上限。

## 开发

```sh
npm install            # ssh2、iconv-lite、dsh 包
node scripts/smoke.mjs        # 引擎冒烟（进程内假 telnet 服务、ssh 错误路径、repo、skills）
node scripts/smoke-host.mjs   # 主机端插件冒烟（工具注册、路由表、确认管线、卸载）
node scripts/smoke-client.mjs # 客户端 bundle 冒烟（VM 内执行 factory、apply、槽位注入）
```

端到端验证（不影响正在跑的 3080 GUI；已完成验证记录）：

```sh
dsh web --port 3199                                   # 另起验证实例
node scripts/verify-ui.mjs                            # Playwright 无头浏览器：设备按钮、面板页签、设备行渲染
node scripts/verify-ai.mjs                            # 真实 AI 会话：模型自主调用 device_list 并汇报
# 真实 SSH 链路：本机起临时 sshd（端口 2223、密钥认证）→ 面板路由添加设备 →
# device_test / device_exec 执行命令，退出码正确传播
```

实测结论（2026-08）：telnet 全链路（登录→执行→输出）、SSH 私钥认证全链路、浏览器 UI 渲染、AI 对话自主调用 `device_list`/`device_exec` 均通过；期间发现并修复了两个真实问题（工具输出含 `undefined` 字段被 lossless JSON 校验拒绝；`webServer` 同一路径多方法注册冲突）。

## 平台兼容性

- **运行平台**：插件运行在 DSH 主机进程内，macOS / Windows / Linux 通用（纯 Node 实现，ssh2 + node:net，无平台专属依赖）。
- **文件选择**：面板私钥选择用浏览器原生 `<input type="file">` 弹窗，macOS/Windows 各弹各的原生窗口；路径兜底支持 `~`（macOS/Linux）与 Windows 盘符路径。
- **键盘**：快速执行支持 ⌘+Enter（macOS）/ Ctrl+Enter（Windows）。
- **远程设备探测**：环境探针先试 POSIX（Linux/macOS），失败自动切 Windows cmd（`%COMPUTERNAME%`/`ver`），OpenSSH on Windows 服务器也能留下环境记忆。
- **危险命令护栏**：同时覆盖 Linux/macOS、Windows（cmd/PowerShell）与网络设备 CLI 三类命令面。

## 已知限制

- SSH 暂不支持 ssh-agent 认证与主机指纹缓存（ssh2 `hostVerifier` 未启用）。
- Telnet 为非交互实现：靠提示符正则判断命令结束，极少数设备的非标准行为需要调 `telnetPromptRegex`。
- JumpServer 连接依赖 connection-token API（v3.7+）；更老的版本请把资产「导入为设备」并手填账号密码直连。
- 未提供交互式 Web 终端（面板的「快速执行」是命令级，非 PTY）；AI 会话也以命令执行为单位。
- settings.yaml 中设备密码与堡垒机密码为本地明文（与 SailFish 本地存储一致）；面板回传层已做脱敏。
