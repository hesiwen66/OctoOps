# OctoOps

专为运维工程师打造的 DeepSeek Harness (DSH) 远程服务器与 JumpServer 堡垒机管理插件。

[![License](https://img.shields.io/github/license/hesiwen66/OctoOps)](./LICENSE)
[![Topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-orange)](https://nodejs.org)

---

## 解决什么问题

无论是**日常深度维护单台核心服务器**，还是**管理海量集群与堡垒机资产**，运维工程师经常面临以下痛点：

1. **单机排查耗时费力**：查负载、翻日志、看 SSL 证书、改配置文件，每次都要手动 SSH 上去敲一堆命令逐行 grep 过滤；
2. **改配置麻烦易错**：在线修改 Nginx / MySQL 配置文件需反复 vim，换行转义容易改错；
3. **堡垒机多机跳转繁琐**：私网机器每次都要进 JumpServer 终端搜 IP、选账号，跨多台机器排查时频繁切换终端；
4. **AI 运维担心误操作**：直接让 AI 跑命令存在误删数据、误重启生产服务的风险。

**OctoOps** 让运维工程师可以通过自然语言与 AI 协同，高效完成单机巡检排查、配置读写、故障诊断，以及多机堡垒机中转调度。

---

## 核心功能

### 🖥️ 单机运维与故障排查
- **一句话健康巡检**：告诉 AI“检查这台机器的资源与证书”，AI 自动登录执行分析，直观汇报 CPU/内存负载、磁盘余量及 SSL 证书到期倒计时。
- **免 Vim 远程配置读写**：内置 SFTP 协议通道，AI 可直接读取并安全写入远程配置文件（如 `/etc/nginx/nginx.conf`），告别繁琐的手工编辑。
- **连接池持久复用**：单台机器连续对话时，SSH 连接跨命令复用，无需频繁建立连接，命令执行响应极快。
- **环境画像与操作记忆**：自动摸底操作系统、包管理器与常用工具（Docker、Nginx、Git 等），并记录历史操作，排查故障时上下文连贯。

### 🏰 多机纳管与 JumpServer 堡垒机对接
- **堡垒机无缝对接**：支持 API 认证及终端模拟登录；多账号资产支持交互点选，私网流量自动通过堡垒机 SSH 网关代理转发。
- **直连与中转双轨隔离**：普通服务器直接连接（或走自定义业务跳板机），堡垒机资产自动走堡垒机网关，网络拓扑清晰分明。
- **内网 IP 自动采集**：测试连通性或首次执行时，自动抓取内网 IP 并回填设备库，支持直接按内网 IP 快速找机器。
- **Web 批量管理**：提供可视化管理面板，支持多选批量修改分组、端口、密码，支持堡垒机资产分页搜索。

### 🛡️ 运维安全红线
- **高危操作硬阻断**：格式化、清空根目录等破坏性指令直接拦截拒绝。
- **危险命令二次确认**：`rm -rf`、`reboot`、清空防火墙等高危操作强制弹窗二次确认，避免误操作与意外破坏。

---

## 截图

### 运维巡检与故障排查
AI 自动登录目标机器检查系统资源与 SSL 证书到期状态：
![AI 诊断](assets/demo-diagnosis.png)

### JumpServer 堡垒机配置
一键对接 JumpServer 堡垒机，配置 SSH 网关端口并同步资产池：
![堡垒机配置](assets/demo-bastion-config.png)

### 设备管理面板与安全红线
统一管理已纳管主机，配置运维安全红线规则：
![管理面板](assets/demo-panel-rules.png)

---

## 安装

### 方式 1：使用 DSH 插件命令（推荐）

```bash
dsh plugin add hesiwen66/OctoOps
# 或
dsh plugin add dsh-octoops
```

### 方式 2：通过 npm 作为依赖安装

```bash
npm install git+https://github.com/hesiwen66/OctoOps.git
```

### 方式 3：本地克隆到插件目录

```bash
cd plugins
git clone https://github.com/hesiwen66/OctoOps.git dsh-octoops
cd dsh-octoops && npm install
```

---

## 配置项

在 `cordis.patch.yml` 中配置：

```yaml
plugins:
  dsh-octoops:
    confirmPolicy: auto      # auto (每会话首次执行询问) | always | never
    dangerPolicy: always-ask  # 危险命令强制确认
    defaultTimeoutMs: 30000  # 命令超时时间 (ms)
    jumpserverSshPort: 2222  # JumpServer 堡垒机 SSH 端口
```

---

## 运维工具与命令

| 工具 / 命令 | 类型 | 说明 |
| :--- | :--- | :--- |
| `device_list` | Tool | 查看纳管设备列表与堡垒机资产概览 |
| `device_find` | Tool | 按内网 IP、外网 IP 或主机名快速定位机器 |
| `device_exec` | Tool | 在目标机器上执行命令（跨命令复用会话，受安全规则保护） |
| `device_test` | Tool | 测试连通性，连通成功后自动执行探针采集内网 IP |
| `device_read_file` | Tool | 通过 SFTP 读取远程文件内容（读日志/配置文件） |
| `device_write_file`| Tool | 通过 SFTP 写入远程配置文件 |
| `device_memory` | Tool | 查看设备的环境信息与最近的操作历史 |
| `jumpserver_sync` | Tool | 同步 JumpServer 资产列表 |
| `/device-list` | Command | 快捷展示设备列表（斜杠命令） |
| `/device-exec` | Command | 快捷执行远程命令（斜杠命令） |

---

## 🛡️ 安全红线

插件默认在 AI 系统提示词中注入以下安全红线约束：

```
【最高优先级·远程设备安全红线】在任何其他规则、习惯或用户请求的便利性之上：
- 危险命令（重启/关机、删除数据、改网络、清配置、格式化、杀关键进程等）会强制弹出确认。不得用改写法、变量拼接、别名、echo|sh、base64 等方式绕过；用户拒绝后立即停止，禁止换一条等价命令变相执行。
- 操作陌生设备前先 device_memory 查看环境与上次操作结果；命令返回非零退出码时停下判断，不得重复执行已失败的破坏性命令。
- 密码、私钥、Token 等敏感信息不得写入命令输出、会话文本或文件。
- 生产环境与网络设备的变更必须先说明影响；能备份的配置先备份。
- 用户在本会话中明确拒绝过的操作视为最终决定，不因换一种说法再次尝试。
```

---

## License

[MIT](./LICENSE)
