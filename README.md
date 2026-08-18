<div align="center">

# 🐙 OctoOps

**DeepSeek Harness (DSH) 多主机与 JumpServer 堡垒机远程运维插件**  
*Unified SSH/Telnet & JumpServer Bastion Orchestrator for DeepSeek Harness*

[![GitHub license](https://img.shields.io/github/license/hesiwen66/OctoOps?style=flat-square)](./LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-blue?style=flat-square&logo=deepseek)](https://github.com/topics/dsh-plugin)
[![JumpServer Compatible](https://img.shields.io/badge/JumpServer-v1%20|%20v2%20|%20v3%20|%20v4-brightgreen?style=flat-square)](https://github.com/jumpserver/jumpserver)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.17-orange?style=flat-square)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/hesiwen66/OctoOps/pulls)

<p align="center">
  <a href="#-核心特性">核心特性</a> •
  <a href="#-实际效果展示">效果展示</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-ai-工具与指令">AI 工具</a> •
  <a href="#-安全红线">安全红线</a> •
  <a href="#-开源协议">开源协议</a>
</p>

</div>

---

## 📖 简介

**OctoOps** 是一个专为 **DeepSeek Harness (DSH)** 开发的远程服务器与堡垒机管理插件。

支持直接连接普通 SSH / Telnet 服务器，同时深度支持企业级 **JumpServer 堡垒机**（支持私网跳板中转与终端模拟登录），并提供环境探针、危险命令拦截以及可视化的设备管理面板。

---

## ✨ 核心特性

### 1. 🏰 JumpServer 堡垒机对接
- **双登录机制**：支持标准的 API Token 方式，同时也支持像人工一样在 JumpServer 终端网关（SSH:2222）中自动搜索机器、选账号并登录，兼容各类 JumpServer 版本。
- **多账号选择**：资产存在多个系统账号时，自动弹出选择卡片供用户点选，并在当前会话内自动记住。

### 2. 🛤️ 独立的网络连接入口
- **手动添加的设备**：直接连接目标机器的 IP:端口（如果配置了专属业务跳板机，则通过自定义跳板机连接），完全不依赖堡垒机。
- **堡垒机资产**：自动以 JumpServer 自身作为第一跳 SSH 跳板机中转，安全穿透内网。

### 3. 🔍 环境自动探针与内网 IP 采集
- **自动抓取事实**：测试连通性或执行命令时，自动探测目标主机的内网 IP、操作系统、内核版本及常用软件（如 Docker、Nginx、Git 等）。
- **按 IP 找机器**：自动将内网 IP 回填至设备列表，在对话中直接告诉 AI 某个内网 IP，AI 也能快速识别并定位目标机器。

### 4. 🛡️ 危险操作安全拦截
- **高危操作阻断**：格式化、清空根目录等破坏性指令直接拦截拒绝。
- **危险命令二次确认**：重启、关机、删库、改网络/防火墙等操作强制弹出交互确认，避免误操作。

### 5. 💻 Web 设备管理面板
- **批量操作**：设备列表支持多选，批量修改分组、端口、认证方式或统一设置密码。
- **表单优化**：高级选项支持折叠，堡垒机资产支持按需展开与分页搜索。

---

## 📸 实际效果展示

### 1. AI 智能诊断服务器资源与 SSL 证书状态
AI 自动登录目标机器进行健康检查，输出系统负载、内存使用情况及 SSL 证书到期时间：

<div align="center">
  <img src="./assets/demo-diagnosis.png" alt="AI 智能诊断展示" width="850" />
</div>

---

### 2. JumpServer 堡垒机对接与资产同步
配置 JumpServer 堡垒机地址与 SSH 入口端口，一键测试连通并同步资产列表：

<div align="center">
  <img src="./assets/demo-bastion-config.png" alt="JumpServer 堡垒机对接" width="850" />
</div>

---

### 3. 设备管理面板与 AI 安全红线规则
在 Web 界面统一管理设备、查看连接记忆与配置 AI 运维安全红线：

<div align="center">
  <img src="./assets/demo-panel-rules.png" alt="设备管理面板与 AI 规则" width="850" />
</div>

---

## 🚀 快速开始

### 方式一：使用 DSH 插件命令直接安装（推荐）

在终端中执行 DSH 插件安装命令：

```bash
dsh plugin add hesiwen66/OctoOps
```

或者使用 npm 包名安装：

```bash
dsh plugin add dsh-octoops
```

---

### 方式二：手动 Clone 安装

进入你的 DSH 插件目录进行安装：

```bash
cd ~/.dsh/plugins # 或你项目的 plugins 目录
git clone https://github.com/hesiwen66/OctoOps.git dsh-octoops
cd dsh-octoops
npm install
```

---

### ⚙️ 基础配置说明

在 `cordis.patch.yml` 或 DSH 配置中引入 `dsh-octoops`（也可直接在 Web 设置面板中修改）：

```yaml
plugins:
  dsh-octoops:
    confirmPolicy: auto      # auto (每会话首次确认) | always | never
    dangerPolicy: always-ask  # 危险命令强制询问
    defaultTimeoutMs: 30000  # 命令超时时间 (ms)
    jumpserverSshPort: 2222  # JumpServer 堡垒机 SSH 网关端口 (默认 2222)
```

---

## 🤖 AI 工具与指令

| 工具 / 命令 | 类型 | 功能描述 |
| :--- | :--- | :--- |
| `device_list` | Tool | 查看已添加设备列表与堡垒机资产概览，支持按名称/IP 过滤 |
| `device_find` | Tool | 按内网 IP、外网 IP 或主机名精确匹配设备 |
| `device_exec` | Tool | 在远程设备上执行命令（跨命令复用会话，受安全规则保护） |
| `device_test` | Tool | 测试连通性，连通成功后自动执行探针采集内网 IP |
| `device_read_file` | Tool | 通过 SFTP 读取远程文件内容（上限 1MB） |
| `device_write_file`| Tool | 通过 SFTP 写入远程文件内容 |
| `device_memory` | Tool | 查看设备的环境信息与最近的操作历史 |
| `jumpserver_sync` | Tool | 同步 JumpServer 堡垒机全量资产 |
| `/device-list` | Command | 斜杠命令：快捷展示设备列表 |
| `/device-exec` | Command | 斜杠命令：快捷执行远程命令 |

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

## 📄 开源协议

本项目采用 [MIT License](./LICENSE) 协议开源。
