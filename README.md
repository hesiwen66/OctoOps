# OctoOps

DeepSeek Harness 的服务器运维与 JumpServer 堡垒机插件。

[![License](https://img.shields.io/github/license/hesiwen66/OctoOps)](./LICENSE)
[![Topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-orange)](https://nodejs.org)

---

## 特性

- **命令执行与状态巡检**：通过 SSH / Telnet 执行远程命令，支持 CPU、内存、磁盘负载及 SSL 证书状态检查。
- **远程文件读写**：内置 SFTP 支持，可直接读取和编辑远程配置文件与日志。
- **连接会话复用**：维护底层 SSH 连接池，同设备连续操作无需重复建立连接。
- **JumpServer 对接**：支持 API 认证与终端交互登录，自动通过堡垒机 SSH 网关代理访问内网资产；多账号资产支持弹窗选择。
- **环境信息采集**：连通时自动探测内网 IP、系统版本及已安装工具（Docker、Nginx、Git 等），支持按内网 IP 检索设备。
- **高危操作拦截**：`rm -rf`、`reboot`、清空防火墙等破坏性命令执行前强制拦截并要求二次确认。
- **Web 管理界面**：提供设备管理面板，支持设备列表管理、批量修改（分组/端口/密码）以及堡垒机资产搜索。

---

## 演示

### 状态巡检与证书检查
![状态巡检](assets/demo-diagnosis.png)

### JumpServer 堡垒机对接
![堡垒机对接](assets/demo-bastion-config.png)

### 设备管理面板与安全规则
![管理面板](assets/demo-panel-rules.png)

---

## 安装

### 方式 1：DSH 命令
```bash
dsh plugin add hesiwen66/OctoOps
# 或
dsh plugin add dsh-octoops
```

### 方式 2：npm
```bash
npm install git+https://github.com/hesiwen66/OctoOps.git
```

### 方式 3：Git Clone
```bash
cd plugins
git clone https://github.com/hesiwen66/OctoOps.git dsh-octoops
cd dsh-octoops && npm install
```

---

## 配置

在 `cordis.patch.yml` 中配置：

```yaml
plugins:
  dsh-octoops:
    confirmPolicy: auto      # 每会话首次执行确认 (auto / always / never)
    dangerPolicy: always-ask  # 高危命令强制确认
    defaultTimeoutMs: 30000  # 命令超时时间 (ms)
    jumpserverSshPort: 2222  # JumpServer 堡垒机 SSH 端口
```

---

## 工具列表

- `device_list` - 列出纳管设备与堡垒机资产
- `device_find` - 按 IP 或主机名查找设备
- `device_exec` - 在目标机器上执行命令
- `device_test` - 测试连通性并采集内网 IP
- `device_read_file` / `device_write_file` - 通过 SFTP 读写远程文件
- `device_memory` - 查看设备环境信息与历史记录
- `jumpserver_sync` - 同步 JumpServer 资产列表
- `/device-list`、`/device-exec` - 快捷斜杠命令

---

## License

[MIT](./LICENSE)
