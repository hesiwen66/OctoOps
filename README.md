<div align="center">

# 🐙 OctoOps

**让 AI Agent 拥有触达万千服务器与堡垒机的智能触手**  
*Unified SSH/Telnet & JumpServer Bastion Orchestrator for DeepSeek Harness (DSH)*

[![GitHub license](https://img.shields.io/github/license/hesiwen66/OctoOps?style=flat-square)](./LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue?style=flat-square&logo=deepseek)](https://github.com/topics/dsh-plugin)
[![JumpServer Compatible](https://img.shields.io/badge/JumpServer-v1%20|%20v2%20|%20v3%20|%20v4-brightgreen?style=flat-square)](https://github.com/jumpserver/jumpserver)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.17-orange?style=flat-square)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/hesiwen66/OctoOps/pulls)

<p align="center">
  <a href="#-核心特性">核心特性</a> •
  <a href="#-实际效果展示">效果展示</a> •
  <a href="#-系统架构">系统架构</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-ai-工具与指令">AI 工具</a> •
  <a href="#-安全护栏">安全护栏</a> •
  <a href="#-开源协议">开源协议</a>
</p>

</div>

---

## 📖 简介 (Introduction)

**OctoOps** 是专为 **DeepSeek Harness (DSH)** 深度打造的下一代多主机与堡垒机远程运维插件。

在企业真实生产环境中，目标服务器往往深居私网、需要经由 **JumpServer 堡垒机** 或跳板机中转，且面临多账号切换、权限拦截、破坏性命令误操作等复杂挑战。**OctoOps** 就像一只章鱼的智能触手，让 AI 助手能够安全、合规、全自动地调度远程主机、排查故障、诊断环境与执行运维任务。

---

## ✨ 核心特性 (Features)

### 1. 🏰 JumpServer 堡垒机全自动深度集成
- **双通道无缝容灾**：
  - **API 快速通道**：通过 JumpServer Connection Token 动态获取临时凭据并建立 JumpHost 隧道；
  - **终端模拟交互自动驾驶（PTY Runner）**：像真实运维人员一样，自动在 JumpServer 终端网关（SSH:2222）中搜索资产、选号、登录目标机器并执行命令，**100% 穿透任何版本（v1/v2/v3/v4）与 API 权限限制**！
- **多账号智能决策**：多账号资产由 AI 弹出交互卡片供用户点选并在会话内智能记忆，**严禁且没有任何业务特定名称硬编码**。

### 2. 🛤️ 双轨连接入口路由隔离
- **普通手动设备**：100% 直连目标设备自身的 `host:port`（或走设备自定义的专属业务跳板机），完全独立于堡垒机；
- **堡垒机资产/导入设备**：100% 以 JumpServer 自身作为网络入口网关（JumpHost 隧道），安全穿透内网。

### 3. 🔍 智能环境探针与自动画像 (Probe & Memory)
- 连通测试（`device_test`）或执行命令时，**自动触发跨平台环境探针**；
- 采用多级安全回退链提取真实**内网 IP**（过滤回环与 Docker 网卡），自动回填设备库；
- 自动采集主机名、操作系统、内核架构、已安装工具链（Docker、Nginx、Git 等），让 AI 具备上下文持久记忆。

### 4. 🛡️ 代码级 AI 安全护栏 (Safety Guard)
- **高危命令硬拦截**：格式化、清空根目录等操作直接拒绝；
- **危险命令强制确认**：重启、关机、删库、改网络、改防火墙等操作强制弹出交互确认，**无法通过换写法、base64 编码或别名绕过**；
- **最高优先级安全红线**：自动注入 AI 系统提示词最顶层，严格约束 AI 的运维行为。

### 5. 💻 现代化 Web 管理面板
- **设备列表多选批量编辑**：支持批量修改设备分组、端口、认证方式与统一密码；
- **高级设置抽屉折叠**：表单精简聚焦，高级参数按需展开；
- **堡垒机资产按需呈现**：默认折叠资产池概况，一键分页检索；
- **全局通知与状态反馈**：操作异常与通知优雅浮动于顶部栏。

---

## 📸 实际效果展示 (Screenshots)

### 1. AI 智能诊断服务器资源与 SSL 证书状态
AI 自动通过 SSH/堡垒机登录目标机器，执行环境分析并以清晰优美的格式汇报系统运行负载、内存与即将到期的 SSL 证书：

<div align="center">
  <img src="./assets/demo-diagnosis.png" alt="AI 智能诊断展示" width="850" />
</div>

---

### 2. JumpServer 堡垒机对接与资产同步
支持 JumpServer 堡垒机一键对接、自定义 SSH 网关入口端口、测试连通性与海量资产一键同步：

<div align="center">
  <img src="./assets/demo-bastion-config.png" alt="JumpServer 堡垒机对接" width="850" />
</div>

---

### 3. 设备管理面板与 AI 安全红线规则
统一的 Web 面板，支持查看设备记忆、管理堡垒机、配置最高优先级安全红线：

<div align="center">
  <img src="./assets/demo-panel-rules.png" alt="设备管理面板与 AI 规则" width="850" />
</div>

---

## 🏗️ 系统架构 (Architecture)

```
                                 ┌─────────────────────────┐
                                 │ DeepSeek Harness (DSH)  │
                                 │   AI 对话 / Web 管理面板 │
                                 └────────────┬────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                 【普通手动添加的主机】               【JumpServer 堡垒机资产】
                 (局域网 / 独立公网服务器)             (私网主机 / 核心网络设备)
                              │                               │
                直连 host:port 或专属跳板机       以 JumpServer:2222 为唯一入口网关
                              │                               │
                              │                  ┌────────────┴────────────┐
                              │                  ▼                         ▼
                              │           [API 隧道通道]            [终端模拟自动驾驶]
                              │         (Connection Token)       (PTY 自动搜机/选号/登录)
                              │                  │                         │
                              ▼                  └────────────┬────────────┘
                     ┌──────────────────┐                     │
                     │  目标服务器/设备  │ <───────────────────┘
                     │  (SSH / Telnet)  │
                     └────────┬─────────┘
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
       【智能环境探针】               【持久化操作记忆】
   自动提取内网 IP / 主机画像      跨命令会话复用 / 审计日志
```

---

## 🚀 快速开始 (Quick Start)

### 1. 安装插件
将本仓库克隆或安装至你的 DeepSeek Harness 插件目录：

```bash
cd ~/.dsh/plugins # 或项目对应插件路径
git clone https://github.com/hesiwen66/OctoOps.git dsh-octoops
cd dsh-octoops
npm install
```

### 2. 启用插件配置
在 `cordis.patch.yml` 或 DSH 配置中引入 `dsh-octoops`：

```yaml
plugins:
  dsh-octoops:
    confirmPolicy: auto      # auto (每会话首次确认) | always | never
    dangerPolicy: always-ask  # 危险命令强制询问
    defaultTimeoutMs: 30000  # 默认超时时间 (ms)
    jumpserverSshPort: 2222  # JumpServer 堡垒机 SSH 端口
```

### 3. 配置 JumpServer（可选）
在 Web 面板「堡垒机」页面或 Settings 中填写：
- **JumpServer 地址**：如 `https://jumpserver.yourcompany.com`
- **用户名 / 密码**
- **默认登录账号（可选）**：如 `root`、`ops`

---

## 🤖 AI 工具与指令 (Tools & Commands)

| 工具 / 命令 | 类型 | 功能描述 |
| :--- | :--- | :--- |
| `device_list` | Tool | 列出已纳管设备与堡垒机资产概览，支持按名称/IP 检索 |
| `device_find` | Tool | 按内网 IP、外网 IP 或主机名精确匹配设备（支持探针历史匹配） |
| `device_exec` | Tool | 在远程设备上执行命令（连接池跨命令复用，受安全护栏保护） |
| `device_test` | Tool | 测试设备连通性，**成功后自动触发探针采集内网 IP 与主机事实** |
| `device_read_file` | Tool | 经由 SFTP 读取远程文件内容（上限 1MB） |
| `device_write_file`| Tool | 经由 SFTP 覆盖写入远程文件内容 |
| `device_memory` | Tool | 查询设备的环境事实记忆与近期操作历史 |
| `jumpserver_sync` | Tool | 同步拉取 JumpServer 堡垒机全量资产缓存 |
| `/device-list` | Command | 斜杠命令：快速展示设备列表（不经模型） |
| `/device-exec` | Command | 斜杠命令：快捷执行命令 |

---

## 🛡️ 安全红线规范 (Safety Policy)

OctoOps 在底层内置了严格的命令检测机制：

```
【最高优先级·远程设备安全红线】在任何其他规则、习惯或用户请求的便利性之上：
- 危险命令（重启/关机、删除数据、改网络、清配置、格式化、杀关键进程等）会强制弹出确认。不得用改写法、变量拼接、别名、echo|sh、base64 等方式绕过；用户拒绝后立即停止，禁止换一条等价命令变相执行。
- 操作陌生设备前先 device_memory 查看环境与上次操作结果；命令返回非零退出码时停下判断，不得重复执行已失败的破坏性命令。
- 密码、私钥、Token 等敏感信息不得写入命令输出、会话文本或文件。
- 生产环境与网络设备的变更必须先说明影响；能备份的配置先备份。
- 用户在本会话中明确拒绝过的操作视为最终决定，不因换一种说法再次尝试。
```

---

## 📄 开源协议 (License)

本项目基于 [MIT License](./LICENSE) 协议开源。欢迎提交 Issue 与 Pull Request！
