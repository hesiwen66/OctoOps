# OctoOps

专为运维工程师打造的 DeepSeek Harness (DSH) 远程多主机与 JumpServer 堡垒机管理插件。

[![License](https://img.shields.io/github/license/hesiwen66/OctoOps)](./LICENSE)
[![Topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-orange)](https://nodejs.org)

---

## 解决什么问题

运维日常排查故障与巡检时，经常面临以下痛点：
1. **堡垒机跳转繁琐**：目标机器多在私网，每次都要在 JumpServer 终端搜 IP、选账号、进机器，跨多台机器排查时频繁切换终端；
2. **AI 运维担心误操作**：直接让 AI 执行命令存在误删数据、误重启生产服务的风险；
3. **环境信息零散**：机器的内网 IP、系统版本、已安装服务分散，难以快速检索。

**OctoOps** 让运维工程师可以通过 DSH 与 AI 协同，安全、高效地管理和排查海量主机。

---

## 核心功能

- **JumpServer 堡垒机无缝对接**：支持 API 认证及终端模拟登录；多账号资产支持交互点选，私网流量自动通过堡垒机 SSH 网关代理转发。
- **直连与中转双轨隔离**：普通服务器直接连接（或走自定义业务跳板机），堡垒机资产自动走堡垒机网关，网络拓扑清晰分明。
- **环境信息自动摸底**：连通测试或首次执行时，自动抓取内网 IP、操作系统、内核版本及常用软件（Docker、Nginx、Git 等），支持按内网 IP 快速找机器。
- **运维安全红线拦截**：`rm -rf`、`reboot`、清空防火墙等高危操作强制弹窗二次确认，避免误操作与破坏性指令。
- **Web 设备管理面板**：提供设备管理界面，支持多选批量修改分组、端口、密码，支持堡垒机资产分页搜索。

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
