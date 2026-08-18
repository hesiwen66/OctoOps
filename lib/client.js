/**
 * dsh-device 浏览器端插件（设备管理面板）。
 *
 * 以 dsh 客户端模块系统要求的 factory 形态手写打包：
 * window.__ModuleLoader__.load({ id, factory(require) })，
 * 仅依赖 shell 已注册的 react 模块。UI 注入点：侧边栏底部的
 * `sidebar.footer.action` 列表槽位（Settings 按钮旁），打开一个
 * 设备管理弹层：设备列表 / 添加设备 / 堡垒机 / 快速执行。
 *
 * 数据传输全部走插件自有的 HTTP 路由（/plugins/device/*）：
 * settings RPC 的 Web 暴露面是内置白名单（settings-not-exposed），
 * 第三方命名空间无法经 /api/settings.* 读写，因此面板直连本插件的
 * 路由，主机端再落到 settings 用户层。
 *
 * @module @sailfish/dsh-device/client
 */
(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return
  window.__ModuleLoader__.load({
    id: '@sailfish/dsh-device',
    factory: function (require) {
      const React = require('react')
      const { useState, useEffect, useRef, useCallback, useMemo } = React

      // 注入现代设计系统 CSS（动画、按钮、输入框、卡片、滚动条等）
      if (typeof document !== 'undefined' && !document.querySelector('style[data-dsh-device-css]')) {
        const style = document.createElement('style')
        style.dataset.dshDeviceCss = '1'
        style.textContent = `
          @keyframes dsh-device-toast-in {
            from { opacity: 0; transform: translate(-50%, -10px); }
            to { opacity: 1; transform: translate(-50%, 0); }
          }
          .dsh-device-scroll::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .dsh-device-scroll::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.15);
            border-radius: 4px;
          }
          .dsh-device-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(0, 0, 0, 0.25);
          }
          .dsh-device-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .dsh-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            height: 32px;
            padding: 0 12px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid var(--dsw-alias-border-l2, #e2e5ea);
            background: var(--dsw-alias-bg-layer-2, #ffffff);
            color: var(--dsw-alias-label-primary, #0f1115);
            transition: all .16s ease;
            white-space: nowrap;
            outline: none;
            user-select: none;
            font-family: inherit;
            box-sizing: border-box;
          }
          .dsh-btn:hover {
            background: var(--dsw-alias-fill-l2, #f2f3f5);
            border-color: rgba(0, 0, 0, 0.16);
          }
          .dsh-btn:active {
            transform: scale(0.98);
          }
          .dsh-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            transform: none;
          }
          .dsh-btn-primary {
            background: #4D6BFE !important;
            border-color: #4D6BFE !important;
            color: #ffffff !important;
            box-shadow: 0 1px 3px rgba(77, 107, 254, 0.28);
          }
          .dsh-btn-primary:hover {
            background: #3b5bf5 !important;
            border-color: #3b5bf5 !important;
            box-shadow: 0 3px 8px rgba(77, 107, 254, 0.38);
          }
          .dsh-btn-subtle {
            background: rgba(77, 107, 254, 0.08) !important;
            border-color: rgba(77, 107, 254, 0.22) !important;
            color: #4D6BFE !important;
            font-weight: 500;
          }
          .dsh-btn-subtle:hover {
            background: #4D6BFE !important;
            border-color: #4D6BFE !important;
            color: #ffffff !important;
            box-shadow: 0 2px 8px rgba(77, 107, 254, 0.25);
          }
          .dsh-btn-danger {
            background: rgba(229, 72, 77, 0.08) !important;
            border-color: rgba(229, 72, 77, 0.2) !important;
            color: #e5484d !important;
          }
          .dsh-btn-danger:hover {
            background: #e5484d !important;
            border-color: #e5484d !important;
            color: #ffffff !important;
          }
          .dsh-btn-sm {
            height: 26px;
            padding: 0 10px;
            font-size: 11px;
            border-radius: 6px;
          }
          .dsh-btn-ghost {
            background: transparent !important;
            border-color: transparent !important;
            color: var(--dsw-alias-label-secondary, #64748b);
          }
          .dsh-btn-ghost:hover {
            background: var(--dsw-alias-fill-l2, #f2f3f5) !important;
            border-color: transparent !important;
            color: var(--dsw-alias-label-primary, #0f1115);
          }
          .dsh-input {
            box-sizing: border-box;
            width: 100%;
            height: 32px;
            background: var(--dsw-alias-fill-l2, #f4f5f7);
            color: var(--dsw-alias-label-primary, #0f1115);
            border: 1px solid var(--dsw-alias-border-l2, #e2e5ea);
            border-radius: 8px;
            padding: 0 10px;
            font-size: 12px;
            outline: none;
            font-family: inherit;
            transition: border-color .15s, box-shadow .15s, background .15s;
          }
          .dsh-input:hover {
            border-color: #c4c9d2;
          }
          .dsh-input:focus {
            background: var(--dsw-alias-bg-layer-2, #ffffff);
            border-color: var(--dsw-alias-brand-primary, #4D6BFE);
            box-shadow: 0 0 0 2px rgba(77, 107, 254, 0.18);
          }
          .dsh-input-sm {
            height: 28px;
            padding: 0 8px;
            font-size: 11px;
            border-radius: 6px;
          }
          .dsh-card {
            border-radius: 10px;
            background: var(--dsw-alias-bg-layer-2, #ffffff);
            border: 1px solid var(--dsw-alias-border-l2, #e6e8ec);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
            transition: all .16s ease;
          }
          .dsh-card:hover {
            border-color: #d0d5dd;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
          }
          .dsh-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            line-height: 14px;
          }
        `
        document.head.appendChild(style)
      }

      // ── 基础样式（内联 + dsh 设计变量） ──────────────────────────────
      const tokens = {
        text: 'var(--dsw-alias-label-primary, #0f1115)',
        text2: 'var(--dsw-alias-label-secondary, #5b6470)',
        text3: 'var(--dsw-alias-label-tertiary, #81858c)',
        fill: 'var(--dsw-alias-fill-l2, #f4f5f7)',
        fill2: 'var(--dsw-alias-fill-l3, #eaebef)',
        border: 'var(--dsw-alias-border-l2, #e2e5ea)',
        menu: 'var(--dsw-alias-bg-overlay, #ffffff)',
        accent: 'var(--dsw-alias-brand-primary, #4D6BFE)',
        danger: '#e5484d',
        ok: '#30a46c',
        shadow: 'var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 0 4px rgba(0,0,0,0.02), 0 12px 32px rgba(0,0,0,0.08))',
        mono: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      }

      const inputStyle = {
        boxSizing: 'border-box',
        width: '100%',
        background: tokens.fill,
        color: tokens.text,
        border: `1px solid ${tokens.border}`,
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
        lineHeight: '18px',
        outline: 'none',
        fontFamily: 'inherit',
      }

      const buttonStyle = {
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        color: tokens.text,
        border: `1px solid ${tokens.border}`,
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        boxSizing: 'border-box',
      }
      const buttonPrimary = { ...buttonStyle, background: tokens.accent, borderColor: tokens.accent, color: '#fff' }
      const buttonDanger = { ...buttonStyle, background: 'rgba(229, 72, 77, 0.08)', borderColor: 'rgba(229, 72, 77, 0.2)', color: tokens.danger }

      // ── 工具函数 ─────────────────────────────────────────────────────
      function fetchJson(path, options) {
        return fetch(path, options).then(async (res) => {
          let body = {}
          try { body = await res.json() } catch { /* 非 JSON 响应 */ }
          if (!res.ok || body.ok === false) {
            throw new Error(body.error || `HTTP ${res.status}`)
          }
          return body
        })
      }
      const postJson = (path, body) => fetchJson(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })

      const I18N_NS = 'dsh-device'
      const i18nListeners = new Set()
      const fallbackZh = {
        'common.cancel': '取消',
        'common.close': '关闭',
        'common.loading': '加载中…',
        'common.refresh': '刷新',
        'common.copy': '复制',
        'common.clear': '清空',
        'common.save': '保存修改',
        'common.add': '添加设备',

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
        'list.empty': '还没有添加任何设备。可在「添加设备」页录入 SSH / Telnet 服务器，或在「堡垒机」页对接 JumpServer 导入资产。',
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
      }
      /**
       * 替换 ``{name}`` 占位符（locale.bind 通常只回字面量）。
       * :param {string} template: 文案。
       * :param {object} [vars]: 占位符。
       * :return {string}
       */
      function interpolate(template, vars) {
        if (!vars || typeof template !== 'string') return template || ''
        return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])))
      }
      let i18nT = (key, vars) => interpolate(fallbackZh[key] || key, vars)
      const notifyI18n = () => { for (const fn of i18nListeners) fn() }
      /**
       * 订阅语言变化，让面板随 DSH 界面语言重绘。
       * :return {function}
       */
      function useT() {
        const [, setN] = useState(0)
        useEffect(() => {
          const bump = () => setN((n) => n + 1)
          i18nListeners.add(bump)
          return () => i18nListeners.delete(bump)
        }, [])
        return i18nT
      }

      /** 相对时间（刚刚 / n 秒前 / n 分钟前 / n 小时前 / n 天前）。 */
      function relativeTime(timestamp, t) {
        if (!timestamp) return t('time.never')
        const delta = Date.now() - timestamp
        if (delta < 10 * 1000) return t('time.justNow')
        if (delta < 60 * 1000) return t('time.secondsAgo', { n: Math.floor(delta / 1000) })
        if (delta < 3600 * 1000) return t('time.minutesAgo', { n: Math.floor(delta / 60000) })
        if (delta < 24 * 3600 * 1000) return t('time.hoursAgo', { n: Math.floor(delta / 3600000) })
        return t('time.daysAgo', { n: Math.floor(delta / 86400000) })
      }

      /** 设备状态点颜色：绿=上次成功，红=上次失败，黄=超时/未知，灰=从未操作。 */
      function statusColorOf(lastOp) {
        if (!lastOp) return tokens.text3
        if (lastOp.timedOut) return '#d9a514'
        if (lastOp.exitCode === 0) return tokens.ok
        if (lastOp.exitCode === null) return '#d9a514'
        return tokens.danger
      }

      function Field(props) {
        return React.createElement('label', { style: { display: 'block', marginBottom: 14, fontSize: 12, color: tokens.text2 } },
          React.createElement('div', { style: { marginBottom: 5, fontWeight: 500, color: tokens.text } },
            props.label, props.required ? React.createElement('span', { style: { color: tokens.danger, marginLeft: 2 } }, ' *') : null),
          React.createElement(props.textarea ? 'textarea' : 'input', {
            ...(props.textarea ? { rows: props.rows || 4 } : { type: props.type || 'text' }),
            className: props.textarea ? 'dsh-input dsh-device-scroll' : 'dsh-input',
            style: {
              ...(props.textarea ? { height: 'auto', padding: '8px 10px' } : {}),
              fontFamily: props.mono ? tokens.mono : 'inherit',
            },
            value: props.value ?? '',
            placeholder: props.placeholder,
            onChange: (event) => props.onChange(event.target.value),
            ...(props.onKeyDown ? { onKeyDown: props.onKeyDown } : {}),
          }),
          props.hint ? React.createElement('div', { style: { marginTop: 4, fontSize: 11, color: tokens.text3, lineHeight: '16px' } }, props.hint) : null,
        )
      }

      function SelectField(props) {
        return React.createElement('label', { style: { display: 'block', marginBottom: 14, fontSize: 12, color: tokens.text2 } },
          React.createElement('div', { style: { marginBottom: 5, fontWeight: 500, color: tokens.text } }, props.label),
          React.createElement('select', {
            className: 'dsh-input',
            style: { appearance: 'auto', cursor: 'pointer' },
            value: props.value ?? '',
            onChange: (event) => props.onChange(event.target.value),
          }, props.options.map((opt) => React.createElement('option', { key: opt.value, value: opt.value }, opt.label))),
        )
      }

      function SectionTitle(props) {
        return React.createElement('div', {
          style: { fontSize: 14, fontWeight: 600, color: tokens.text, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 },
        }, props.children)
      }

      // ── 图标（内联 SVG，随 color/size 缩放） ─────────────────────────
      const IconSvg = (paths) => function Icon(props) {
        return React.createElement('svg', {
          width: props.size || 14, height: props.size || 14, viewBox: '0 0 24 24',
          fill: 'none', stroke: props.color || 'currentColor', strokeWidth: 2,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
          style: props.style,
        }, paths.map((d) => React.createElement('path', { d, key: d })))
      }
      const SshIcon = IconSvg([
        'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
        'm8 10 3 3-3 3', 'M13 15h3',
      ])
      const TelnetIcon = IconSvg(['M3 12h4l2 6 4-14 2 8h6'])
      const BastionIcon = IconSvg(['M12 3 3 7v4c0 5 4 9 9 10 5-1 9-5 9-10V7z', 'M9 12l2 2 4-4'])
      const HistoryIcon = IconSvg(['M3 12a9 9 0 1 0 3-6.7', 'M3 3v5h5', 'M12 7v5l3 3'])
      const KeyIcon = IconSvg(['M15 7a5 5 0 1 0-4.9 6l.9-.9V15l1 1h2v2h2v1h2l2-2-1-1-3-3a5 5 0 0 0-1-6z'])
      const FileIcon = IconSvg(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'])
      const PlayIcon = IconSvg(['M6 4v16l14-8z'])
      const WrenchIcon = IconSvg(['M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4L14 13l-3-3z'])
      const TrashIcon = IconSvg(['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14'])
      const EditIcon = IconSvg(['M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'])
      const CpuIcon = IconSvg(['M7 7h10v10H7z', 'M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3'])
      const RulesIcon = IconSvg(['M9 5H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10l-5-5z', 'M9 5v5h5', 'm7 13 2 2 4-4'])
      const SearchIcon = IconSvg(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.35-4.35'])
      const CheckIcon = IconSvg(['M20 6 9 17l-5-5'])
      const SyncIcon = IconSvg(['M21.5 2v6h-6', 'M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67'])
      const ChevronLeft = IconSvg(['m15 18-6-6 6-6'])
      const ChevronRight = IconSvg(['m9 18 6-6-6-6'])
      const ChevronDown = IconSvg(['m6 9 6 6 6-6'])
      const ChevronsLeft = IconSvg(['m11 17-5-5 5-5', 'm18 17-5-5 5-5'])
      const ChevronsRight = IconSvg(['m6 17 5-5-5-5', 'm13 17 5-5-5-5'])
      const LayersIcon = IconSvg(['m12 2 10 5-10 5L2 7l10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'])

      // ── 设备面板 ─────────────────────────────────────────────────────
      function DevicePanel(props) {
        const t = useT()
        const { onClose, actions } = props
        // 默认页签与 tabs[0] 一致（当前为「AI 规则」）
        const [tab, setTab] = useState('rules')
        const [devices, setDevices] = useState(null)
        const [loadError, setLoadError] = useState('')
        const [busy, setBusy] = useState(false)
        const [toasts, setToasts] = useState([])
        const [draft, setDraft] = useState(null)
        const [execDevice, setExecDevice] = useState('')

        const reloadDevices = useCallback(() => {
          fetchJson('/plugins/device/devices')
            .then((body) => { setDevices(body.devices); setLoadError('') })
            .catch((error) => setLoadError(error.message))
        }, [])

        useEffect(() => { reloadDevices() }, [reloadDevices])

        // Esc 关闭面板
        useEffect(() => {
          const onKey = (event) => { if (event.key === 'Escape') onClose() }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [onClose])

        // Toast 通知：自动 3.5s 消失
        const pushToast = useCallback((kind, text) => {
          const id = `${Date.now()}-${Math.random()}`
          setToasts((list) => [...list, { id, kind, text }])
          setTimeout(() => setToasts((list) => list.filter((entry) => entry.id !== id)), 3500)
        }, [])
        const flash = useCallback((text, kind) => pushToast(kind || 'info', text), [pushToast])
        const flashOk = useCallback((text) => pushToast('ok', text), [pushToast])

        const runBusy = useCallback(async (fn) => {
          setBusy(true)
          try {
            await fn()
          } catch (error) {
            pushToast('error', String(error?.message || error))
          } finally {
            setBusy(false)
          }
        }, [pushToast])

        const tabs = [
          { key: 'rules', label: t('nav.rules'), icon: RulesIcon },
          { key: 'devices', label: t('nav.devices'), icon: BastionIcon },
          { key: 'add', label: t('nav.add'), icon: EditIcon },
          { key: 'bastion', label: t('nav.bastion'), icon: KeyIcon },
          { key: 'exec', label: t('nav.exec'), icon: PlayIcon },
          { key: 'memory', label: t('nav.memory'), icon: HistoryIcon },
        ]

        // 面板整体规格对齐 DSH 设置面板（SettingsRoot.module.css）：
        // 800x800 圆角 24 面板 + 188px 左导航 + 54px header + 24px 边距内容区
        const panelStyle = {
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          width: 800,
          height: 'min(800px, calc(100vh - 48px))',
          maxWidth: 'calc(100vw - 48px)',
          borderRadius: 24,
          overflow: 'hidden',
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          boxShadow: 'var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,0.2), 0 0 4px rgba(0,0,0,0.02), 0 12px 32px rgba(0,0,0,0.08))',
        }
        const navStyle = {
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          width: 188,
          padding: '22px 12px 0',
          boxSizing: 'border-box',
        }
        const navTitleStyle = {
          padding: '0 12px',
          fontSize: 16,
          lineHeight: '24px',
          fontWeight: 500,
          color: 'var(--dsw-alias-label-primary, #0f1115)',
        }
        const navCellStyle = (active) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 40,
          padding: '9px 16px 9px 12px',
          boxSizing: 'border-box',
          border: 'none',
          borderRadius: 12,
          background: active ? 'var(--dsw-specific-sidebar-nav-item-active, #ebEEF2)' : 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: '22px',
          fontWeight: 400,
          color: 'var(--dsw-alias-label-primary, #0f1115)',
          textAlign: 'left',
          width: '100%',
        })
        const activeTab = tabs.find((entry) => entry.key === tab) ?? tabs[0]

        return React.createElement('div', {
          style: {
            position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          },
        },
        // 遮罩（对齐设置面板的 mask + 模糊）
        React.createElement('div', {
          style: {
            position: 'absolute', inset: 0,
            background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))',
            backdropFilter: 'var(--dsw-mask-blur, blur(2px))',
          },
          onClick: onClose,
        }),
        React.createElement('div', { style: panelStyle },
          // ── 左导航 ────────────────────────────────────────────────
          React.createElement('div', { style: navStyle },
            React.createElement('div', { style: navTitleStyle }, t('nav.title')),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              tabs.map((entry) => React.createElement('button', {
                key: entry.key,
                type: 'button',
                onClick: () => setTab(entry.key),
                style: navCellStyle(tab === entry.key),
                onMouseEnter: (event) => { if (tab !== entry.key) event.currentTarget.style.background = 'var(--dsw-specific-sidebar-nav-item-hover, rgba(15,17,21,0.05))' },
                onMouseLeave: (event) => { if (tab !== entry.key) event.currentTarget.style.background = 'transparent' },
              },
              React.createElement('span', { style: { flex: 'none', display: 'inline-flex' } },
                React.createElement(entry.icon, { size: 16 })),
              React.createElement('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, entry.label))))),
          // ── 内容列 ────────────────────────────────────────────────
          React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
            // header：当前页签名 + 关闭按钮（28x28 圆形，hover 对齐设置面板）
            React.createElement('div', {
              style: {
                flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                gap: 8, height: 54, padding: '20px 14px 8px 10px', boxSizing: 'border-box',
              },
            },
            React.createElement('span', {
              style: {
                fontSize: 14, lineHeight: '22px', fontWeight: 500,
                color: 'var(--dsw-alias-label-secondary, #5b6470)',
              },
            }, activeTab.label),
            React.createElement('button', {
              type: 'button',
              style: {
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, padding: 0, border: 'none', borderRadius: 28,
                background: 'transparent', cursor: 'pointer',
                color: 'var(--dsw-alias-label-primary, #0f1115)',
              },
              onMouseEnter: (event) => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, transparent)' },
              onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
              onClick: onClose,
              title: t('common.close'),
            }, '✕')),
            React.createElement('div', {
              style: { flex: 1, minHeight: 0, padding: '0 24px 24px', overflowY: 'auto' },
            },
            tab === 'devices' && React.createElement(DeviceListTab, {
              devices, loadError, busy, reloadDevices, actions, flash, flashOk, runBusy,
              onEdit: (device) => { setDraft(device); setTab('add') },
              onExec: (device) => { setExecDevice(device.id); setTab('exec') },
            }),
            tab === 'add' && React.createElement(AddDeviceTab, {
              runBusy, flash, flashOk, reloadDevices,
              onSaved: () => { reloadDevices(); setTab('devices') },
              draft, onDraft: setDraft,
            }),
            tab === 'bastion' && React.createElement(BastionTab, { actions, runBusy, flash, flashOk, onImported: reloadDevices }),
            tab === 'exec' && React.createElement(ExecTab, { actions, execDevice, setExecDevice, flash, flashOk }),
            tab === 'memory' && React.createElement(MemoryTab, { flash, runBusy }),
            tab === 'rules' && React.createElement(AiRulesTab, { runBusy, flash, flashOk })))),
        // Toast 层（打开插件的顶部位置）
        toasts.length > 0 && React.createElement('div', {
          style: {
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 2200,
            display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
            width: 'calc(100% - 48px)', maxWidth: 520, pointerEvents: 'none',
          },
        },
        toasts.map((toast) => {
          const color = toast.kind === 'ok' ? tokens.ok : toast.kind === 'error' ? tokens.danger : tokens.accent
          const icon = toast.kind === 'ok' ? '✓' : toast.kind === 'error' ? '✕' : 'ℹ'
          return React.createElement('div', {
            key: toast.id,
            style: {
              background: 'var(--dsw-alias-bg-layer-2, #ffffff)', border: `1px solid ${tokens.border}`, borderLeft: `4px solid ${color}`,
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.14), 0 0 1px rgba(0,0,0,0.15)', padding: '10px 16px',
              fontSize: 13, color: tokens.text, width: '100%', boxSizing: 'border-box', wordBreak: 'break-all',
              display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'auto',
              animation: 'dsh-device-toast-in .18s ease-out',
            },
          },
          React.createElement('span', { style: { color, fontWeight: 700, fontSize: 14 } }, icon),
          React.createElement('span', { style: { flex: 1, lineHeight: '18px' } }, toast.text))
        })),
        )
      }

      function BatchEditModal(props) {
        const t = useT()
        const { selectedDevices, onClose, onSaved, runBusy, flash, flashOk } = props
        const [fields, setFields] = useState({
          group: false,
          protocol: false,
          port: false,
          username: false,
          authType: false,
          password: false,
          privateKey: false,
          encoding: false,
          comment: false,
        })
        const [form, setForm] = useState({
          group: '',
          protocol: 'ssh',
          port: 22,
          username: '',
          authType: 'password',
          password: '',
          privateKey: '',
          privateKeyPath: '',
          passphrase: '',
          encoding: 'utf8',
          comment: '',
        })
        const keyFileInputRef = useRef(null)

        const toggleField = (key) => setFields((prev) => ({ ...prev, [key]: !prev[key] }))
        const setVal = (key, val) => setForm((prev) => ({ ...prev, [key]: val }))

        const save = () => runBusy(async () => {
          const hasAny = Object.values(fields).some(Boolean)
          if (!hasAny) {
            flash('请勾选至少一个需要批量修改的字段', 'error')
            return
          }
          const patch = {}
          if (fields.group) patch.group = form.group
          if (fields.protocol) patch.protocol = form.protocol
          if (fields.port) patch.port = Number(form.port) || (form.protocol === 'telnet' ? 23 : 22)
          if (fields.username) patch.username = form.username
          if (fields.authType) patch.authType = form.authType
          if (fields.password && form.authType === 'password') patch.password = form.password
          if (fields.privateKey && form.authType === 'privateKey') {
            patch.privateKey = form.privateKey
            patch.passphrase = form.passphrase
          }
          if (fields.encoding) patch.encoding = form.encoding
          if (fields.comment) patch.comment = form.comment

          const ids = selectedDevices.map((d) => d.id)
          const res = await postJson('/plugins/device/devices/batch-update', { ids, patch })
          flashOk(t('list.batchEditOk', { count: res.count ?? ids.length }))
          onSaved()
          onClose()
        })

        const formItem = (key, label, control) => React.createElement('div', {
          style: {
            padding: '10px 14px', borderRadius: 8, marginBottom: 10,
            background: fields[key] ? 'rgba(77, 107, 254, 0.05)' : 'var(--dsw-alias-fill-l2, #f8f9fa)',
            border: `1px solid ${fields[key] ? 'rgba(77, 107, 254, 0.4)' : tokens.border}`,
            transition: 'all .16s ease',
          },
        },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: fields[key] ? 8 : 0 } },
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: tokens.text, cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox', checked: Boolean(fields[key]),
              onChange: () => toggleField(key),
              style: { cursor: 'pointer', width: 15, height: 15, accentColor: tokens.accent },
            }),
            label),
          React.createElement('span', { style: { fontSize: 11, color: fields[key] ? tokens.accent : tokens.text3 } },
            fields[key] ? '已开启覆盖' : '保持不变')),
        fields[key] && React.createElement('div', { style: { marginTop: 6 } }, control))

        return React.createElement('div', {
          style: {
            position: 'fixed', inset: 0, zIndex: 2300, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          },
        },
        React.createElement('div', {
          style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.36)', backdropFilter: 'blur(3px)' },
          onClick: onClose,
        }),
        React.createElement('div', {
          style: {
            position: 'relative', zIndex: 1, width: 540, maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100vh - 64px)', overflowY: 'auto', borderRadius: 16,
            background: 'var(--dsw-alias-bg-layer-2, #ffffff)', padding: '24px',
            boxShadow: '0 20px 48px rgba(0, 0, 0, 0.18), 0 0 1px rgba(0, 0, 0, 0.2)',
            boxSizing: 'border-box',
          },
          className: 'dsh-device-scroll',
        },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
          React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: tokens.text, display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement(EditIcon, { size: 18, color: tokens.accent }),
            t('list.batchEditTitle', { count: selectedDevices.length })),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
            style: { width: 28, height: 28, padding: 0, borderRadius: '50%' },
            onClick: onClose,
          }, '✕')),
        React.createElement('div', { style: { fontSize: 12, color: tokens.text3, marginBottom: 16, lineHeight: '18px' } },
          t('list.batchEditHelp')),

        formItem('group', t('form.group'), React.createElement('input', {
          className: 'dsh-input', value: form.group, placeholder: '输入统一分组名称（如：生产节点）',
          onChange: (e) => setVal('group', e.target.value),
        })),

        formItem('protocol', t('form.protocol'), React.createElement('select', {
          className: 'dsh-input', value: form.protocol,
          onChange: (e) => setVal('protocol', e.target.value),
        },
        React.createElement('option', { value: 'ssh' }, 'SSH'),
        React.createElement('option', { value: 'telnet' }, 'Telnet'))),

        formItem('port', '端口', React.createElement('input', {
          className: 'dsh-input', type: 'number', value: String(form.port || ''), placeholder: '如 22 或 23',
          onChange: (e) => setVal('port', e.target.value ? Number(e.target.value) : undefined),
        })),

        formItem('username', t('form.username'), React.createElement('input', {
          className: 'dsh-input', value: form.username, placeholder: '统一登录用户名（如：root）',
          onChange: (e) => setVal('username', e.target.value),
        })),

        formItem('authType', t('form.authType'), React.createElement('select', {
          className: 'dsh-input', value: form.authType,
          onChange: (e) => setVal('authType', e.target.value),
        },
        React.createElement('option', { value: 'password' }, t('form.password')),
        React.createElement('option', { value: 'privateKey' }, t('form.privateKey')))),

        form.authType === 'password' && formItem('password', t('form.password'), React.createElement('input', {
          className: 'dsh-input', type: 'password', value: form.password, placeholder: '统一设置密码',
          onChange: (e) => setVal('password', e.target.value),
        })),

        form.authType === 'privateKey' && formItem('privateKey', t('form.pem'), React.createElement('div', null,
          React.createElement('textarea', {
            rows: 3, className: 'dsh-input dsh-device-scroll',
            style: { height: 'auto', padding: '8px 10px', fontFamily: tokens.mono, fontSize: 11 },
            value: form.privateKey, placeholder: '粘贴统一私钥内容',
            onChange: (e) => setVal('privateKey', e.target.value),
          }),
          React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            React.createElement('input', {
              type: 'file', style: { display: 'none' }, ref: keyFileInputRef,
              onChange: (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (file.size > 128 * 1024) {
                  flash(t('form.fileTooLarge', { size: (file.size / 1024).toFixed(1) }), 'error')
                  return
                }
                const reader = new FileReader()
                reader.onload = () => {
                  setVal('privateKey', String(reader.result ?? ''))
                  flashOk(t('form.readPersist', { name: file.name }))
                }
                reader.onerror = () => flash(t('form.readFail'), 'error')
                reader.readAsText(file)
              },
            }),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-sm',
              onClick: () => keyFileInputRef.current?.click(),
            }, React.createElement(FileIcon, { size: 12 }), t('form.pickKey'))),
          React.createElement('input', {
            className: 'dsh-input', style: { marginTop: 6 }, type: 'password',
            value: form.passphrase, placeholder: '私钥口令（可选）',
            onChange: (e) => setVal('passphrase', e.target.value),
          }))),

        formItem('encoding', t('form.encoding'), React.createElement('select', {
          className: 'dsh-input', value: form.encoding,
          onChange: (e) => setVal('encoding', e.target.value),
        },
        React.createElement('option', { value: 'utf8' }, 'UTF-8'),
        React.createElement('option', { value: 'gbk' }, t('form.gbk')),
        React.createElement('option', { value: 'latin1' }, t('form.latin1')),
        React.createElement('option', { value: 'utf16le' }, 'UTF-16 LE'))),

        formItem('comment', t('form.comment'), React.createElement('input', {
          className: 'dsh-input', value: form.comment, placeholder: '统一设置备注',
          onChange: (e) => setVal('comment', e.target.value),
        })),

        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 14, borderTop: `1px solid ${tokens.border}` } },
          React.createElement('button', { type: 'button', className: 'dsh-btn', onClick: onClose }, t('common.cancel')),
          React.createElement('button', { type: 'button', className: 'dsh-btn dsh-btn-primary', onClick: save }, t('list.apply'))),
        ))
      }

      function DeviceListTab(props) {
        const t = useT()
        const { devices, loadError, busy, reloadDevices, actions, flash, flashOk, runBusy, onEdit, onExec } = props
        const [confirmDelete, setConfirmDelete] = useState(null)
        const [selectedIds, setSelectedIds] = useState(new Set())
        const [showBatchEdit, setShowBatchEdit] = useState(false)
        const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)

        if (loadError) {
          return React.createElement('div', { style: { color: tokens.danger, fontSize: 13 } }, t('list.loadFailed', { error: loadError }))
        }
        if (devices === null) return React.createElement('div', { style: { color: tokens.text3, fontSize: 13 } }, t('common.loading'))
        if (devices.length === 0) {
          return React.createElement('div', {
            style: {
              padding: '48px 24px', textAlign: 'center', borderRadius: 12,
              background: 'var(--dsw-alias-fill-l2, #f8f9fa)', border: `1px dashed ${tokens.border}`,
            },
          },
          React.createElement(BastionIcon, { size: 36, color: tokens.text3, style: { marginBottom: 12, opacity: 0.6 } }),
          React.createElement('div', { style: { fontSize: 13, color: tokens.text2, lineHeight: '22px', maxWidth: 420, margin: '0 auto' } },
            t('list.empty')))
        }

        const selectedCount = selectedIds.size
        const isAllSelected = devices.length > 0 && selectedCount === devices.length
        const selectedDeviceList = devices.filter((d) => selectedIds.has(d.id))

        const toggleSelect = (id) => {
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }

        const toggleSelectAll = () => {
          if (isAllSelected) {
            setSelectedIds(new Set())
          } else {
            setSelectedIds(new Set(devices.map((d) => d.id)))
          }
        }

        const runBatchTest = () => runBusy(async () => {
          const ids = [...selectedIds]
          if (ids.length === 0) return
          flash(t('list.batchTesting'), 'info')
          let okCount = 0
          let failCount = 0
          await Promise.all(ids.map(async (id) => {
            try {
              const res = await postJson('/plugins/device/devices/test', { id })
              if (res.ok) okCount++
              else failCount++
            } catch {
              failCount++
            }
          }))
          reloadDevices()
          flashOk(t('list.batchTestOk', { ok: okCount, fail: failCount }))
        })

        const runBatchDelete = () => runBusy(async () => {
          const ids = [...selectedIds]
          const res = await postJson('/plugins/device/devices/batch-delete', { ids })
          setConfirmBatchDelete(false)
          setSelectedIds(new Set())
          reloadDevices()
          flashOk(t('list.batchDeleted', { count: res.count ?? ids.length }))
        })

        const rows = devices.map((device) => {
          const cred = device.authType === 'privateKey'
            ? `${t('list.authKey')}${device.hasPrivateKey ? t('list.configured') : ''}`
            : `${t('list.authPassword')}${device.hasPassword ? t('list.configured') : t('list.unconfigured')}`
          const ProtocolIcon = device.protocol === 'telnet' ? TelnetIcon : SshIcon
          const lastOp = device.lastOp
          const deleting = confirmDelete === device.id
          const isSelected = selectedIds.has(device.id)

          return React.createElement('div', {
            key: device.id,
            className: 'dsh-card',
            style: {
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 10, marginBottom: 8,
              background: isSelected ? 'rgba(77, 107, 254, 0.06)' : undefined,
              borderColor: isSelected ? tokens.accent : undefined,
            },
          },
          React.createElement('input', {
            type: 'checkbox',
            checked: isSelected,
            onChange: () => toggleSelect(device.id),
            style: { cursor: 'pointer', width: 16, height: 16, accentColor: tokens.accent },
          }),
          React.createElement('div', {
            style: {
              width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: device.protocol === 'telnet' ? 'rgba(217, 165, 20, 0.12)' : 'rgba(77, 107, 254, 0.12)',
              color: device.protocol === 'telnet' ? '#d9a514' : tokens.accent, flexShrink: 0,
            },
          }, React.createElement(ProtocolIcon, { size: 16 })),
          React.createElement('div', {
            style: { flex: 1, minWidth: 0, cursor: 'pointer' },
            onClick: () => toggleSelect(device.id),
          },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: tokens.text, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              React.createElement('span', {
                style: {
                  width: 8, height: 8, borderRadius: '50%', background: statusColorOf(lastOp),
                  boxShadow: lastOp ? `0 0 0 2px ${statusColorOf(lastOp)}22` : 'none', flexShrink: 0,
                },
                title: lastOp ? t('list.lastOp', { command: lastOp.command }) : t('list.neverOp'),
              }),
              device.name,
              device.group && React.createElement('span', {
                className: 'dsh-badge',
                style: { background: 'rgba(77, 107, 254, 0.1)', color: tokens.accent },
              }, device.group),
              device.jumpHost ? React.createElement('span', {
                className: 'dsh-badge',
                style: { background: 'rgba(129, 133, 140, 0.12)', color: tokens.text3 },
              }, t('list.jump')) : null),
            React.createElement('div', { style: { fontSize: 12, color: tokens.text2, fontFamily: tokens.mono, marginTop: 2 } },
              `${device.username ? device.username + '@' : ''}${device.host}:${device.port} · ${cred}${device.lanIp ? t('list.lan', { ip: device.lanIp }) : ''}`),
            lastOp ? React.createElement('div', {
              style: { fontSize: 11, color: tokens.text3, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' },
            },
            React.createElement('span', null, relativeTime(lastOp.startedAt, t)),
            React.createElement('span', { style: { color: statusColorOf(lastOp), fontFamily: tokens.mono, fontWeight: 500 } },
              lastOp.timedOut ? t('list.timeout') : lastOp.exitCode === null ? t('list.aborted') : `exit ${lastOp.exitCode}`),
            React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280, fontFamily: tokens.mono } },
              lastOp.command)) : null),
          deleting
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement('span', { style: { fontSize: 12, color: tokens.danger } }, t('list.deleteConfirm')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-danger dsh-btn-sm',
                onClick: () => runBusy(async () => {
                  await fetchJson('/plugins/device/devices', {
                    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: device.id }),
                  })
                  setConfirmDelete(null)
                  reloadDevices()
                  flashOk(t('list.deleted', { name: device.name }))
                }),
              }, React.createElement(TrashIcon, { size: 12 }), t('list.confirmDelete')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
                onClick: () => setConfirmDelete(null),
              }, t('common.cancel')))
            : React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-sm', disabled: busy,
                onClick: () => runBusy(async () => {
                  const body = await postJson('/plugins/device/devices/test', { id: device.id })
                  if (body.ok) flashOk(body.message)
                  else flash(body.message, 'error')
                }),
              }, React.createElement(WrenchIcon, { size: 12 }), t('list.test')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-sm', disabled: busy,
                onClick: () => onExec(device),
              }, React.createElement(PlayIcon, { size: 12 }), t('list.exec')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-sm', disabled: busy,
                onClick: () => onEdit(device),
              }, React.createElement(EditIcon, { size: 12 }), t('list.edit')),
              React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-danger dsh-btn-sm', disabled: busy,
                onClick: () => setConfirmDelete(device.id),
              }, React.createElement(TrashIcon, { size: 12 }), t('list.delete')))
          )
        })

        return React.createElement('div', null,
          // ── 顶部多选与批量操作栏 ─────────────────────────────────────
          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderRadius: 10, background: 'var(--dsw-alias-fill-l2, #f4f5f7)',
              border: `1px solid ${tokens.border}`, marginBottom: 12, flexWrap: 'wrap', gap: 10,
            },
          },
          React.createElement('label', {
            style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: tokens.text, cursor: 'pointer' },
          },
          React.createElement('input', {
            type: 'checkbox', checked: isAllSelected,
            onChange: toggleSelectAll,
            style: { cursor: 'pointer', width: 16, height: 16, accentColor: tokens.accent },
          }),
          t('list.selectAll'),
          React.createElement('span', { style: { color: tokens.text3, fontSize: 12, fontWeight: 400 } },
            `（共 ${devices.length} 台）`),
          selectedCount > 0 && React.createElement('span', {
            className: 'dsh-badge',
            style: { background: tokens.accent, color: '#ffffff', marginLeft: 4 },
          }, `${selectedCount} 已选`)),

          selectedCount > 0 && (
            confirmBatchDelete
              ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                React.createElement('span', { style: { fontSize: 12, color: tokens.danger } },
                  t('list.batchDeleteConfirm', { count: selectedCount })),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-danger dsh-btn-sm',
                  onClick: runBatchDelete,
                }, t('list.confirmDelete')),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
                  onClick: () => setConfirmBatchDelete(false),
                }, t('common.cancel')))
              : React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-primary dsh-btn-sm',
                  onClick: () => setShowBatchEdit(true),
                }, React.createElement(EditIcon, { size: 12 }), t('list.batchEdit')),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-sm',
                  onClick: runBatchTest,
                }, React.createElement(WrenchIcon, { size: 12 }), t('list.batchTest')),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-danger dsh-btn-sm',
                  onClick: () => setConfirmBatchDelete(true),
                }, React.createElement(TrashIcon, { size: 12 }), t('list.batchDelete')),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
                  onClick: () => setSelectedIds(new Set()),
                }, t('list.clearSelect')))
          )),

          rows,

          showBatchEdit && React.createElement(BatchEditModal, {
            selectedDevices: selectedDeviceList,
            onClose: () => setShowBatchEdit(false),
            onSaved: () => {
              reloadDevices()
              setSelectedIds(new Set())
            },
            runBusy, flash, flashOk,
          }),
        )
      }

      function AddDeviceTab(props) {
        const t = useT()
        const { runBusy, flash, flashOk, onSaved, draft, onDraft, reloadDevices } = props
        const [showAdvanced, setShowAdvanced] = useState(false)
        const keyFileInputRef = useRef(null)
        const form = draft || { protocol: 'ssh', authType: 'password', encoding: 'utf8' }
        const set = (key, value) => onDraft({ ...form, [key]: value })
        const isTelnet = form.protocol === 'telnet'

        const save = () => runBusy(async () => {
          if (!String(form.host || '').trim()) throw new Error(t('form.needHost'))
          if (isTelnet && !String(form.username || '').trim()) throw new Error(t('form.needTelnetUser'))
          const payload = { ...form }
          const saved = await fetchJson('/plugins/device/devices', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device: payload }),
          })
          onDraft(null)
          onSaved()
          flashOk(form.id ? t('form.savedEdit') : t('form.savedAdd'))
          const savedId = saved?.device?.id ?? form.id
          if (!isTelnet && !String(form.lanIp || '').trim() && savedId) {
            (async () => {
              try {
                const probe = await fetchJson('/plugins/device/probe', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: savedId }),
                })
                if (probe?.lanIp) {
                  flashOk(t('form.probedLan', { ip: probe.lanIp }))
                  reloadDevices()
                }
              } catch { /* 静默 */ }
            })()
          }
        })

        return React.createElement('div', { className: 'dsh-card', style: { padding: '20px 24px', maxWidth: 520 } },
          React.createElement(SectionTitle, null,
            React.createElement(EditIcon, { size: 16, color: tokens.accent }),
            form.id ? t('form.savedEdit') : t('nav.add')),
          React.createElement('div', { style: { marginTop: 14 } },
            // ── 基础常用设置 ──────────────────────────────────────────
            React.createElement(Field, { label: t('form.name'), required: true, value: form.name, placeholder: '如：Web-Server-01', onChange: (v) => set('name', v) }),
            React.createElement(Field, { label: t('form.host'), required: true, value: form.host, placeholder: '192.168.1.100 或 server.local', onChange: (v) => set('host', v), mono: true }),
            React.createElement(SelectField, {
              label: t('form.protocol'), value: form.protocol,
              onChange: (v) => set('protocol', v),
              options: [{ value: 'ssh', label: 'SSH' }, { value: 'telnet', label: 'Telnet' }],
            }),
            React.createElement(Field, { label: t('form.port', { port: isTelnet ? 23 : 22 }), value: String(form.port || ''), placeholder: isTelnet ? '23' : '22', onChange: (v) => set('port', v ? Number(v) : undefined) }),
            React.createElement(Field, { label: t('form.username'), required: isTelnet, value: form.username, placeholder: '登录账号，如 root', onChange: (v) => set('username', v) }),
            React.createElement(SelectField, {
              label: t('form.authType'), value: form.authType,
              onChange: (v) => set('authType', v),
              options: [{ value: 'password', label: t('form.password') }, { value: 'privateKey', label: t('form.privateKey') }],
            }),
            form.authType === 'password' && React.createElement(Field, {
              label: t('form.password'), type: 'password', value: form.password,
              placeholder: form.hasPassword ? t('form.keepPassword') : '输入设备密码',
              onChange: (v) => set('password', v),
            }),
            form.authType === 'privateKey' && React.createElement('div', { style: { marginBottom: 14 } },
              React.createElement(Field, {
                label: t('form.pem'), textarea: true, value: form.privateKey,
                placeholder: form.hasPrivateKey ? t('form.keepSecret') : '粘贴 PEM 私钥或点击下方按钮选择私钥文件',
                onChange: (v) => set('privateKey', v), mono: true,
              }),
              React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' } },
                React.createElement('input', {
                  type: 'file', style: { display: 'none' }, ref: keyFileInputRef,
                  onChange: (event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    if (file.size > 128 * 1024) {
                      flash(t('form.fileTooLarge', { size: (file.size / 1024).toFixed(1) }), 'error')
                      return
                    }
                    const reader = new FileReader()
                    reader.onload = () => {
                      set('privateKey', String(reader.result ?? ''))
                      flashOk(t('form.readPersist', { name: file.name }))
                    }
                    reader.onerror = () => flash(t('form.readFail'), 'error')
                    reader.readAsText(file)
                  },
                }),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-sm',
                  onClick: () => keyFileInputRef.current?.click(),
                }, React.createElement(FileIcon, { size: 12 }), t('form.pickKey')),
                React.createElement('span', { style: { fontSize: 11, color: tokens.text3 } }, t('form.pickHint'))),
            ),

            // ── 高级设置折叠栏 ────────────────────────────────────────
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 8, background: 'var(--dsw-alias-fill-l2, #f4f5f7)',
                cursor: 'pointer', margin: '16px 0 12px', userSelect: 'none',
                border: `1px solid ${tokens.border}`,
              },
              onClick: () => setShowAdvanced((v) => !v),
            },
            React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: tokens.text, display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement(showAdvanced ? ChevronDown : ChevronRight, { size: 14, color: tokens.accent }),
              '高级设置',
              React.createElement('span', { style: { fontSize: 11, color: tokens.text3, fontWeight: 400 } }, '（内网IP、分组、编码、备注等）')),
            React.createElement('span', { style: { fontSize: 11, color: tokens.accent, fontWeight: 500 } }, showAdvanced ? '收起 ▲' : '展开 ▼')),

            showAdvanced && React.createElement('div', {
              style: { padding: '12px 14px', borderRadius: 8, background: 'var(--dsw-alias-fill-l2, #f8f9fa)', border: `1px solid ${tokens.border}`, marginBottom: 14 },
            },
              React.createElement(Field, { label: t('form.lanIp'), value: form.lanIp, placeholder: '留空将在首次连接时自动探测', onChange: (v) => set('lanIp', v), mono: true }),
              form.authType === 'privateKey' && React.createElement(Field, { label: t('form.passphrase'), type: 'password', value: form.passphrase, placeholder: '可选私钥口令', onChange: (v) => set('passphrase', v) }),
              form.authType === 'privateKey' && React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 14 } },
                React.createElement('input', {
                  className: 'dsh-input dsh-input-sm', placeholder: t('form.orPathWin'),
                  value: form.privateKeyPath || '',
                  onChange: (event) => set('privateKeyPath', event.target.value),
                }),
                React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-sm',
                  onClick: () => runBusy(async () => {
                    const body = await postJson('/plugins/device/read-file', { path: form.privateKeyPath })
                    set('privateKey', body.content)
                    flashOk(t('form.readHostOk', { path: body.path, size: body.size }))
                  }),
                  disabled: !form.privateKeyPath,
                }, t('form.readPath')),
              ),
              React.createElement(Field, { label: t('form.group'), value: form.group, placeholder: '如：生产集群、测试节点', onChange: (v) => set('group', v) }),
              React.createElement(SelectField, {
                label: t('form.encoding'), value: form.encoding,
                onChange: (v) => set('encoding', v),
                options: [
                  { value: 'utf8', label: 'UTF-8' },
                  { value: 'gbk', label: t('form.gbk') },
                  { value: 'latin1', label: t('form.latin1') },
                  { value: 'utf16le', label: 'UTF-16 LE' },
                ],
              }),
              isTelnet && React.createElement(Field, { label: t('form.prompt'), value: form.promptRegex, onChange: (v) => set('promptRegex', v), mono: true }),
              React.createElement(Field, { label: t('form.comment'), value: form.comment, placeholder: '设备用途或备注说明', onChange: (v) => set('comment', v) }),
            ),

            React.createElement('div', { style: { display: 'flex', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${tokens.border}` } },
              React.createElement('button', { type: 'button', className: 'dsh-btn dsh-btn-primary', onClick: save, disabled: !form.host }, form.id ? t('common.save') : t('common.add')),
              form.id ? React.createElement('button', { type: 'button', className: 'dsh-btn', onClick: () => onDraft(null) }, t('form.cancelEdit')) : null),
          ))
      }

      function BastionTab(props) {
        const t = useT()
        const { actions, runBusy, flash, flashOk, onImported } = props
        const [configInfo, setConfigInfo] = useState(null)
        const [historyList, setHistoryList] = useState([])
        const [assets, setAssets] = useState([])
        const [cacheMeta, setCacheMeta] = useState({})
        const [devices, setDevices] = useState([])
        const [form, setForm] = useState(null)
        const [searchQuery, setSearchQuery] = useState('')
        const [page, setPage] = useState(1)
        const [pageSize, setPageSize] = useState(10)
        const [showAssets, setShowAssets] = useState(false)

        const reload = useCallback(() => {
          fetchJson('/plugins/device/config').then((body) => setConfigInfo(body.config)).catch(() => setConfigInfo({}))
          fetchJson('/plugins/device/assets').then((body) => {
            setAssets(body.assets || [])
            setCacheMeta({ total: body.total, lastSyncAt: body.lastSyncAt, error: body.error })
          }).catch(() => undefined)
          fetchJson('/plugins/device/bastion/history').then((body) => setHistoryList(body.history || [])).catch(() => undefined)
          fetchJson('/plugins/device/devices').then((body) => setDevices(body.devices || [])).catch(() => undefined)
        }, [])

        useEffect(() => { reload() }, [reload])

        const info = configInfo || {}
        if (form === null && configInfo !== null) {
          setForm({
            jumpserverUrl: info.jumpserverUrl || '',
            jumpserverUsername: info.jumpserverUsername || '',
            jumpserverPassword: '',
            jumpserverSshPort: info.jumpserverSshPort || 2222,
            jumpserverDefaultAccount: info.jumpserverDefaultAccount || '',
            jumpserverRejectUnauthorized: info.jumpserverRejectUnauthorized !== false,
          })
        }
        const f = form || {}
        const set = (key, value) => setForm({ ...f, [key]: value })

        const validateUrl = (url) => {
          const trimmed = String(url || '').trim()
          if (!trimmed) {
            flash(t('bastion.needUrl'), 'error')
            return false
          }
          if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            flash(t('bastion.urlProtocolRequired'), 'error')
            return false
          }
          return true
        }

        const save = () => runBusy(async () => {
          if (!validateUrl(f.jumpserverUrl)) return
          const body = await postJson('/plugins/device/config', f)
          setConfigInfo(body.config)
          setForm({ ...f, jumpserverPassword: '' })
          flashOk(t('bastion.saved'))
          reload()
        })

        const sync = () => runBusy(async () => {
          if (!validateUrl(f.jumpserverUrl)) return
          const body = await postJson('/plugins/device/sync', {})
          reload()
          setShowAssets(true)
          flashOk(t('bastion.synced', { total: body.total }))
        })

        const test = () => runBusy(async () => {
          if (!validateUrl(f.jumpserverUrl)) return
          const body = await postJson('/plugins/device/jumpserver/test', f)
          if (body.ok) {
            flashOk(body.message)
            reload()
          } else {
            flash(body.message, 'error')
          }
        })

        const loadHistory = (id) => runBusy(async () => {
          const body = await postJson('/plugins/device/bastion/history/use', { id })
          setConfigInfo(body.config)
          setForm({
            jumpserverUrl: body.config.jumpserverUrl || '',
            jumpserverUsername: body.config.jumpserverUsername || '',
            jumpserverPassword: '',
            jumpserverDefaultAccount: body.config.jumpserverDefaultAccount || '',
            jumpserverRejectUnauthorized: body.config.jumpserverRejectUnauthorized !== false,
          })
          flashOk(t('bastion.historyUse'))
          reload()
        })

        const deleteHistory = (id, event) => {
          event?.stopPropagation()
          runBusy(async () => {
            await fetchJson('/plugins/device/bastion/history', {
              method: 'DELETE', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id }),
            })
            flashOk(t('bastion.historyDelete'))
            reload()
          })
        }

        // 已导入设备映射
        const importedSet = useMemo(() => {
          const set = new Set()
          for (const d of devices) {
            if (d.assetId) set.add(String(d.assetId))
            if (d.id && d.id.startsWith('js-')) set.add(d.id.slice(3))
            if (d.host) set.add(d.host)
          }
          return set
        }, [devices])

        // 搜索过滤资产
        const filteredAssets = useMemo(() => {
          const q = String(searchQuery || '').trim().toLowerCase()
          if (!q) return assets
          return assets.filter((a) => {
            const name = String(a.name || '').toLowerCase()
            const addr = String(a.address || '').toLowerCase()
            const comment = String(a.comment || '').toLowerCase()
            const protos = (a.protocols || []).map((p) => String(p.name || '')).join(' ').toLowerCase()
            return name.includes(q) || addr.includes(q) || comment.includes(q) || protos.includes(q) || String(a.id).includes(q)
          })
        }, [assets, searchQuery])

        // 分页计算（默认10条/页）
        const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize))
        const currentPage = Math.min(Math.max(1, page), totalPages)
        const pagedAssets = useMemo(() => {
          const start = (currentPage - 1) * pageSize
          return filteredAssets.slice(start, start + pageSize)
        }, [filteredAssets, currentPage, pageSize])

        // 单项导入
        const importAsset = (asset) => runBusy(async () => {
          await fetchJson('/plugins/device/devices', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device: {
                id: `js-${asset.id}`, name: asset.name, host: asset.address,
                protocol: asset.protocols?.[0]?.name === 'telnet' ? 'telnet' : 'ssh',
                port: asset.protocols?.[0]?.port, username: '', authType: 'password',
                source: 'jumpserver', assetId: asset.id, comment: asset.comment || 'Imported from JumpServer',
              },
            }),
          })
          flashOk(t('bastion.importOk'))
          onImported()
          reload()
        })

        // 一键批量导入全部未导入资产
        const importAll = () => runBusy(async () => {
          const unimported = filteredAssets.filter((a) => !importedSet.has(String(a.id)) && !importedSet.has(a.address))
          if (unimported.length === 0) {
            flash('当前列表中资产已全部导入', 'info')
            return
          }
          const list = unimported.map((asset) => ({
            id: `js-${asset.id}`, name: asset.name, host: asset.address,
            protocol: asset.protocols?.[0]?.name === 'telnet' ? 'telnet' : 'ssh',
            port: asset.protocols?.[0]?.port, username: '', authType: 'password',
            source: 'jumpserver', assetId: asset.id, comment: asset.comment || 'Imported from JumpServer',
          }))
          const body = await postJson('/plugins/device/devices/batch', { devices: list })
          flashOk(t('bastion.importBatchOk', { count: body.count ?? list.length }))
          onImported()
          reload()
        })

        const assetRows = pagedAssets.map((asset) => {
          const isImported = importedSet.has(String(asset.id)) || importedSet.has(asset.address)
          const isTelnet = (asset.protocols || []).some((p) => p.name === 'telnet')
          return React.createElement('div', {
            key: asset.id,
            className: 'dsh-card',
            style: {
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 10, marginBottom: 8,
            },
          },
          React.createElement('div', {
            style: {
              width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isTelnet ? 'rgba(217, 165, 20, 0.12)' : 'rgba(77, 107, 254, 0.12)',
              color: isTelnet ? '#d9a514' : tokens.accent, flexShrink: 0,
            },
          }, React.createElement(isTelnet ? TelnetIcon : SshIcon, { size: 16 })),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: tokens.text, display: 'flex', alignItems: 'center', gap: 8 } },
              asset.name,
              React.createElement('span', {
                className: 'dsh-badge',
                style: {
                  background: isTelnet ? 'rgba(217, 165, 20, 0.12)' : 'rgba(77, 107, 254, 0.1)',
                  color: isTelnet ? '#d9a514' : tokens.accent,
                },
              }, isTelnet ? 'Telnet' : 'SSH'),
              isImported && React.createElement('span', {
                className: 'dsh-badge',
                style: { background: 'rgba(48, 164, 108, 0.12)', color: tokens.ok },
              }, React.createElement(CheckIcon, { size: 11 }), t('bastion.imported'))),
            React.createElement('div', { style: { color: tokens.text2, fontFamily: tokens.mono, fontSize: 12, marginTop: 2 } },
              asset.address,
              asset.comment ? React.createElement('span', { style: { color: tokens.text3, fontFamily: 'inherit', marginLeft: 8 } }, `· ${asset.comment}`) : '')),
          isImported
            ? React.createElement('span', { style: { fontSize: 12, color: tokens.text3, padding: '4px 8px' } }, t('bastion.imported'))
            : React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-subtle dsh-btn-sm',
              style: { whiteSpace: 'nowrap', flexShrink: 0, padding: '0 12px' },
              onClick: () => importAsset(asset),
            }, '+ ' + t('bastion.import')))
        })

        return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
          // ── 模块 1：配置与历史卡片 ──────────────────────────────────
          React.createElement('div', { className: 'dsh-card', style: { padding: '18px 20px' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
              React.createElement(SectionTitle, null,
                React.createElement(KeyIcon, { size: 16, color: tokens.accent }),
                'JumpServer 堡垒机对接'),
              historyList.length > 0 && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                React.createElement('span', { style: { fontSize: 12, color: tokens.text3 } }, t('bastion.historyTitle') + ':'),
                React.createElement('select', {
                  className: 'dsh-input dsh-input-sm',
                  style: { width: 190, appearance: 'auto', cursor: 'pointer' },
                  value: '',
                  onChange: (e) => { if (e.target.value) loadHistory(e.target.value) },
                },
                React.createElement('option', { value: '' }, t('bastion.historyPlaceholder')),
                historyList.map((h) => React.createElement('option', { key: h.id, value: h.id }, `${h.url} (${h.username || '匿名'})`))),
              )),

            // 历史快捷卡片（若有历史）
            historyList.length > 0 && React.createElement('div', {
              style: {
                display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12,
              },
              className: 'dsh-device-scroll',
            },
            historyList.map((h) => React.createElement('div', {
              key: h.id,
              style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
                borderRadius: 6, background: 'var(--dsw-alias-fill-l2, #f4f5f7)',
                border: `1px solid ${tokens.border}`, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
              },
            },
            React.createElement('span', {
              style: { fontFamily: tokens.mono, fontWeight: 500, color: tokens.text, cursor: 'pointer' },
              onClick: () => loadHistory(h.id),
              title: '点击载入配置',
            }, h.url),
            h.username && React.createElement('span', { style: { color: tokens.text3 } }, `@${h.username}`),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
              style: { width: 18, height: 18, padding: 0, fontSize: 12, color: tokens.text3, marginLeft: 2 },
              onClick: (e) => deleteHistory(h.id, e),
              title: t('bastion.historyDelete'),
            }, '✕')))),

            // 配置表单
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' } },
              React.createElement('div', { style: { gridColumn: '1 / -1' } },
                React.createElement(Field, {
                  label: t('bastion.url'), required: true, value: f.jumpserverUrl,
                  onChange: (v) => set('jumpserverUrl', v), mono: true,
                  placeholder: 'http://192.168.1.100:8080 或 https://jms.example.com',
                })),
              React.createElement(Field, { label: t('form.username'), value: f.jumpserverUsername, placeholder: 'JumpServer 用户名', onChange: (v) => set('jumpserverUsername', v) }),
              React.createElement(Field, {
                label: info.hasPassword ? t('bastion.passwordSaved') : t('bastion.password'),
                type: 'password', value: f.jumpserverPassword,
                placeholder: info.hasPassword ? t('bastion.passwordSaved') : '输入密码',
                onChange: (v) => set('jumpserverPassword', v),
              }),
              React.createElement(Field, {
                label: '堡垒机 SSH 端口（入口）',
                type: 'number',
                value: f.jumpserverSshPort !== undefined ? f.jumpserverSshPort : 2222,
                placeholder: '默认 2222',
                onChange: (v) => set('jumpserverSshPort', Number(v) || 2222),
              }),
              React.createElement(Field, { label: t('bastion.defaultAccount'), value: f.jumpserverDefaultAccount, placeholder: '可选，默认优先资产账号', onChange: (v) => set('jumpserverDefaultAccount', v) }),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: 34, marginTop: 22 } },
                React.createElement('label', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: tokens.text, cursor: 'pointer' } },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: f.jumpserverRejectUnauthorized !== false,
                    onChange: (event) => set('jumpserverRejectUnauthorized', event.target.checked),
                    style: { cursor: 'pointer', width: 15, height: 15, accentColor: tokens.accent },
                  }),
                  t('bastion.ssl'))),
            ),

            React.createElement('div', { style: { fontSize: 11, color: tokens.text3, lineHeight: '16px', marginBottom: 14 } },
              t('bastion.apiHint')),

            // 操作工具栏
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 12, borderTop: `1px solid ${tokens.border}` } },
              React.createElement('div', { style: { display: 'flex', gap: 8 } },
                React.createElement('button', { type: 'button', className: 'dsh-btn dsh-btn-primary', onClick: save }, t('bastion.save')),
                React.createElement('button', { type: 'button', className: 'dsh-btn', onClick: test }, React.createElement(WrenchIcon, { size: 13 }), t('bastion.test')),
                React.createElement('button', { type: 'button', className: 'dsh-btn', onClick: sync }, React.createElement(SyncIcon, { size: 13 }), t('bastion.sync'))),
              React.createElement('div', { style: { fontSize: 12, color: tokens.text3 } },
                cacheMeta.error
                  ? React.createElement('span', { style: { color: tokens.danger } }, t('bastion.lastError', { error: cacheMeta.error }))
                  : (cacheMeta.lastSyncAt ? t('bastion.lastSync', { time: new Date(cacheMeta.lastSyncAt).toLocaleString(), total: cacheMeta.total }) : t('bastion.neverSync')))),
          ),

          // ── 模块 2：资产管理区 ──────────────────────────────────────
          React.createElement('div', { className: 'dsh-card', style: { padding: '18px 20px' } },
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showAssets ? 14 : 0, flexWrap: 'wrap', gap: 10 },
            },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement(SectionTitle, null,
                React.createElement(LayersIcon, { size: 16, color: tokens.accent }),
                t('bastion.assets')),
              assets.length > 0 && React.createElement('span', {
                className: 'dsh-badge',
                style: { background: 'rgba(77, 107, 254, 0.1)', color: tokens.accent },
              }, `共 ${assets.length} 个`),
              importedSet.size > 0 && React.createElement('span', {
                className: 'dsh-badge',
                style: { background: 'rgba(48, 164, 108, 0.12)', color: tokens.ok },
              }, `已导入 ${importedSet.size}`)),

            assets.length > 0 && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              showAssets && React.createElement('div', { style: { position: 'relative', display: 'flex', alignItems: 'center' } },
                React.createElement(SearchIcon, { size: 13, color: tokens.text3, style: { position: 'absolute', left: 8, pointerEvents: 'none' } }),
                React.createElement('input', {
                  className: 'dsh-input dsh-input-sm',
                  style: { width: 190, paddingLeft: 26, paddingRight: searchQuery ? 24 : 8 },
                  placeholder: t('bastion.searchPlaceholder'),
                  value: searchQuery,
                  onChange: (e) => { setSearchQuery(e.target.value); setPage(1) },
                }),
                searchQuery && React.createElement('button', {
                  type: 'button',
                  className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
                  style: { position: 'absolute', right: 2, width: 20, height: 20, padding: 0, color: tokens.text3 },
                  onClick: () => setSearchQuery(''),
                }, '✕')),
              showAssets && React.createElement('select', {
                className: 'dsh-input dsh-input-sm',
                style: { width: 90, appearance: 'auto', cursor: 'pointer' },
                value: String(pageSize),
                onChange: (e) => { setPageSize(Number(e.target.value)); setPage(1) },
              },
              [10, 20, 50, 100].map((sz) => React.createElement('option', { key: sz, value: sz }, t('bastion.pageSize', { size: sz })))),
              showAssets && React.createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-primary dsh-btn-sm',
                style: { whiteSpace: 'nowrap', flexShrink: 0, padding: '0 12px' },
                onClick: importAll,
              }, t('bastion.importAll')),
              React.createElement('button', {
                type: 'button',
                className: showAssets ? 'dsh-btn dsh-btn-sm' : 'dsh-btn dsh-btn-subtle dsh-btn-sm',
                onClick: () => setShowAssets((v) => !v),
              }, showAssets ? '收起资产列表 ▲' : '查看资产列表 ▼'))),

            // 默认收起时的极简引导卡片
            (!showAssets && assets.length > 0) && React.createElement('div', {
              style: {
                marginTop: 12, padding: '12px 14px', borderRadius: 8,
                background: 'var(--dsw-alias-fill-l2, #f8f9fa)', border: `1px solid ${tokens.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
              },
            },
            React.createElement('span', { style: { fontSize: 12, color: tokens.text2 } },
              `当前已缓存 ${assets.length} 个堡垒机资产（已导入纳管 ${importedSet.size} 个）。默认保持折叠，需要时点击右上方「查看资产列表」或点击「同步资产」展开管理。`),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-sm',
              onClick: () => setShowAssets(true),
            }, '展开查看')),

            // 展开时的资产列表内容
            showAssets && (assets.length === 0
              ? React.createElement('div', {
                style: {
                  padding: '36px 20px', textAlign: 'center', borderRadius: 8,
                  background: 'var(--dsw-alias-fill-l2, #f4f5f7)', border: `1px dashed ${tokens.border}`,
                },
              },
              React.createElement('div', { style: { fontSize: 13, color: tokens.text3 } },
                '暂无堡垒机资产缓存。请在上方输入 JumpServer 地址并点击「同步资产」。'))
              : (filteredAssets.length === 0
                ? React.createElement('div', { style: { padding: '24px', textAlign: 'center', color: tokens.text3, fontSize: 13 } }, '未找到匹配的资产')
                : React.createElement('div', null,
                  assetRows,
                  totalPages > 1 && React.createElement('div', {
                    style: {
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 6, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${tokens.border}`,
                      fontSize: 12, color: tokens.text2,
                    },
                  },
                  React.createElement('button', {
                    type: 'button',
                    className: 'dsh-btn dsh-btn-sm',
                    disabled: currentPage <= 1,
                    onClick: () => setPage(1),
                  }, React.createElement(ChevronsLeft, { size: 12 }), t('bastion.firstPage')),
                  React.createElement('button', {
                    type: 'button',
                    className: 'dsh-btn dsh-btn-sm',
                    disabled: currentPage <= 1,
                    onClick: () => setPage((p) => Math.max(1, p - 1)),
                  }, React.createElement(ChevronLeft, { size: 12 }), t('bastion.prevPage')),
                  React.createElement('span', { style: { padding: '0 8px', fontFamily: tokens.mono, fontSize: 12 } },
                    t('bastion.pageInfo', { current: currentPage, total: totalPages })),
                  React.createElement('button', {
                    type: 'button',
                    className: 'dsh-btn dsh-btn-sm',
                    disabled: currentPage >= totalPages,
                    onClick: () => setPage((p) => Math.min(totalPages, p + 1)),
                  }, t('bastion.nextPage'), React.createElement(ChevronRight, { size: 12 })),
                  React.createElement('button', {
                    type: 'button',
                    className: 'dsh-btn dsh-btn-sm',
                    disabled: currentPage >= totalPages,
                    onClick: () => setPage(totalPages),
                  }, t('bastion.lastPage'), React.createElement(ChevronsRight, { size: 12 }))),
                ))),
          ),
        )
      }

      function ExecTab(props) {
        const t = useT()
        const { actions, execDevice, setExecDevice, flash, flashOk } = props
        const [command, setCommand] = useState('')
        const [output, setOutput] = useState('')
        const [running, setRunning] = useState(false)
        const [targets, setTargets] = useState([])
        const [recent, setRecent] = useState([]) // 本面板会话的最近命令
        const [needAccount, setNeedAccount] = useState(null) // 资产多账号时弹窗
        const [danger, setDanger] = useState(null) // 危险命令内联确认
        const [firstConfirm, setFirstConfirm] = useState(null) // 本会话首设备确认
        const [firstConfirmed, setFirstConfirmed] = useState(false)

        useEffect(() => {
          Promise.all([
            fetchJson('/plugins/device/devices'),
            fetchJson('/plugins/device/assets').catch(() => ({ assets: [] })),
          ]).then(([devBody, assetBody]) => {
            const manuals = (devBody.devices || []).map((d) => ({
              value: d.id,
              label: `${d.name}（${d.protocol} ${d.host}:${d.port}）`,
            }))
            const assets = (assetBody.assets || []).map((asset) => ({
              value: asset.id,
              label: t('exec.bastionLabel', { name: asset.name, address: asset.address }),
            }))
            setTargets([...manuals, ...assets])
          }).catch(() => undefined)
        }, [t])

        const renderOutput = (r) => {
          const text = [r.stdout, r.stderr ? `[stderr]\n${r.stderr}` : ''].filter(Boolean).join('\n')
          return `${text || t('exec.emptyOutput')}${r.timedOut ? '\n[timed out]' : r.exitCode !== 0 && r.exitCode !== null ? `\n[exit code: ${r.exitCode}]` : ''}`
        }

        const runWith = async (account, dangerConfirmed, sessionConfirmed) => {
          if (!execDevice || !command.trim()) return
          const confirmed = sessionConfirmed || firstConfirmed
          setRunning(true)
          setOutput(t('exec.running'))
          setNeedAccount(null)
          setDanger(null)
          setFirstConfirm(null)
          setRecent((list) => [command, ...list.filter((entry) => entry !== command)].slice(0, 10))
          try {
            const body = await postJson('/plugins/device/exec', {
              device: execDevice, command,
              ...(account ? { account } : {}),
              ...(dangerConfirmed ? { dangerConfirmed: true } : {}),
              ...(confirmed ? { firstConfirmed: true } : {}),
            })
            if (body.needFirstConfirm) {
              setFirstConfirm(body)
              setOutput('')
              return
            }
            if (body.needAccount) {
              setNeedAccount(body.accounts)
              setOutput('')
              return
            }
            if (body.blocked) {
              setOutput(t('exec.blocked', { category: body.category, reason: body.reason }))
              setDanger(null)
              return
            }
            if (body.dangerous) {
              setDanger(body)
              setOutput('')
              return
            }
            setOutput(renderOutput(body.result))
          } catch (error) {
            setOutput(t('exec.failed', { error: error.message }))
            flash(error.message, 'error')
          } finally {
            setRunning(false)
          }
        }

        const run = () => runWith(undefined, false, false)

        const onCommandKeyDown = (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void run()
          }
        }

        const copyOutput = () => {
          if (!output) return
          navigator.clipboard?.writeText(output)
            .then(() => flashOk(t('exec.copied')))
            .catch(() => flash(t('exec.copyFail'), 'error'))
        }

        return React.createElement('div', { style: { maxWidth: 640 } },
          React.createElement(SelectField, {
            label: t('exec.target'), value: execDevice || '',
            onChange: (v) => {
              setExecDevice(v)
              setNeedAccount(null)
              setDanger(null)
              setFirstConfirm(null)
              setFirstConfirmed(false)
            },
            options: targets,
          }),
          recent.length > 0 && React.createElement(SelectField, {
            label: t('exec.recent'), value: '',
            onChange: (v) => { if (v) setCommand(v) },
            options: [{ value: '', label: t('exec.pickRecent') }, ...recent.map((cmd) => ({ value: cmd, label: cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd }))],
          }),
          React.createElement(Field, { label: t('exec.command'), textarea: true, rows: 4, value: command, onChange: setCommand, onKeyDown: onCommandKeyDown, mono: true, placeholder: '输入待执行的 Shell 命令...' }),
          React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 } },
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-primary',
              onClick: run, disabled: running || !execDevice || !command.trim(),
            }, React.createElement(PlayIcon, { size: 13 }), running ? t('exec.running') : t('exec.run')),
            React.createElement('span', { style: { fontSize: 11, color: tokens.text3 } }, t('exec.shortcut'))),

          firstConfirm && React.createElement('div', {
            className: 'dsh-card',
            style: { marginTop: 12, padding: '12px 14px', background: 'rgba(77, 107, 254, 0.05)', borderColor: tokens.accent },
          },
          React.createElement('div', { style: { fontSize: 13, color: tokens.text, marginBottom: 8 } },
            t('exec.firstConfirm', { name: firstConfirm.device?.name || execDevice })),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-primary dsh-btn-sm',
              onClick: () => { setFirstConfirmed(true); void runWith(undefined, false, true) },
            }, firstConfirm.remember ? t('confirm.remember') : t('exec.allowOnce')),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
              onClick: () => setFirstConfirm(null),
            }, t('common.cancel')))),

          needAccount && React.createElement('div', {
            className: 'dsh-card',
            style: {
              marginTop: 12, padding: '14px 16px', borderRadius: 10,
              background: 'rgba(77, 107, 254, 0.05)', border: '1px solid rgba(77, 107, 254, 0.3)',
            },
          },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: tokens.accent, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 } },
            React.createElement(KeyIcon, { size: 15 }),
            '该资产包含多个登录账号，请选择连接身份：'),
          React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            needAccount.map((account) => React.createElement('button', {
              key: account.name || account.id,
              type: 'button',
              className: 'dsh-btn dsh-btn-subtle dsh-btn-sm',
              onClick: () => runWith(account.name || account.id, false, true),
            }, `${account.name}${account.username && account.username !== account.name ? `（${account.username}）` : ''}`)),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
              onClick: () => setNeedAccount(null),
            }, t('common.cancel')))),

          danger && React.createElement('div', {
            style: { marginTop: 12, padding: '12px 14px', borderRadius: 10, background: 'rgba(229,72,77,0.08)', border: `1px solid ${tokens.danger}` },
          },
          React.createElement('div', { style: { fontSize: 13, color: tokens.danger, fontWeight: 600, marginBottom: 6 } },
            t('exec.danger', { category: danger.category, reason: danger.reason })),
          React.createElement('div', { style: { fontSize: 12, color: tokens.text, fontFamily: tokens.mono, marginBottom: 10, wordBreak: 'break-all' } }, danger.command),
          React.createElement('div', { style: { display: 'flex', gap: 8 } },
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-danger dsh-btn-sm',
              onClick: () => runWith(undefined, true, true),
            }, t('exec.dangerConfirm')),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-ghost dsh-btn-sm',
              onClick: () => setDanger(null),
            }, t('common.cancel')))),

          React.createElement('div', {
            style: { marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
          },
          React.createElement('div', { style: { fontSize: 12, fontWeight: 500, color: tokens.text2 } },
            output && output !== t('exec.running') ? t('exec.output') : ''),
          output ? React.createElement('div', { style: { display: 'flex', gap: 6 } },
            React.createElement('button', { type: 'button', className: 'dsh-btn dsh-btn-sm', onClick: copyOutput }, t('common.copy')),
            React.createElement('button', { type: 'button', className: 'dsh-btn dsh-btn-ghost dsh-btn-sm', onClick: () => setOutput('') }, t('common.clear'))) : null),

          React.createElement('pre', {
            className: 'dsh-device-scroll',
            style: {
              marginTop: 6, padding: 14, background: 'var(--dsw-alias-fill-l2, #f4f5f7)', borderRadius: 10,
              border: `1px solid ${tokens.border}`,
              color: 'var(--dsw-alias-label-primary, #0f1115)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap',
              wordBreak: 'break-all', maxHeight: 320, overflow: 'auto', fontFamily: tokens.mono,
            },
          }, output || t('exec.noOutput')),
        )
      }

      // ── 操作记忆页签 ─────────────────────────────────────────────────
      function MemoryTab(props) {
        const t = useT()
        const { flash, runBusy } = props
        const [memories, setMemories] = useState(null)
        const [devices, setDevices] = useState([])
        const [selected, setSelected] = useState('')

        const reload = useCallback(() => {
          postJson('/plugins/device/memory', { ...(selected ? { device: selected } : {}) })
            .then((body) => setMemories(body.memories))
            .catch((error) => flash(error.message, 'error'))
        }, [selected, flash])

        useEffect(() => {
          fetchJson('/plugins/device/devices').then((body) => setDevices(body.devices || [])).catch(() => undefined)
        }, [])

        useEffect(() => { reload() }, [reload])

        if (memories === null) return React.createElement('div', { style: { color: tokens.text3, fontSize: 13 } }, t('common.loading'))
        if (memories.length === 0) {
          return React.createElement('div', {
            style: {
              padding: '36px 20px', textAlign: 'center', borderRadius: 10,
              background: 'var(--dsw-alias-fill-l2, #f4f5f7)', border: `1px dashed ${tokens.border}`,
            },
          },
          React.createElement('div', { style: { color: tokens.text3, fontSize: 13, lineHeight: '22px', marginBottom: 12 } },
            t('memory.empty')),
          React.createElement('button', { type: 'button', className: 'dsh-btn dsh-btn-sm', onClick: () => reload() }, t('common.refresh')))
        }

        return React.createElement('div', null,
          React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 } },
            React.createElement('div', { style: { flex: 1, maxWidth: 300 } },
              React.createElement(SelectField, {
                label: t('memory.filter'), value: selected,
                onChange: (v) => setSelected(v),
                options: [{ value: '', label: t('memory.all') }, ...devices.map((d) => ({ value: d.id, label: d.name }))],
              })),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-sm',
              style: { height: 34, marginBottom: 12 },
              onClick: () => reload(),
            }, React.createElement(SyncIcon, { size: 12 }), t('common.refresh'))),

          memories.map((memory) => {
            let envText = t('memory.noEnv')
            if (memory.env && Object.keys(memory.env).length > 0) {
              const env = memory.env
              envText = env.host ? t('memory.host', { host: env.host }) : t('memory.envReady')
              if (env.os) envText += ` · ${env.os}`
              if (env.kernel) envText += ` ${env.kernel}`
              if (env.user) envText += t('memory.user', { user: env.user })
              if (env.raw) envText += t('memory.raw', { raw: String(env.raw).slice(0, 60).replace(/\n/g, '⏎') })
            }
            return React.createElement('div', {
              key: memory.deviceId,
              className: 'dsh-card',
              style: { marginBottom: 14, padding: '14px 16px' },
            },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: tokens.text, marginBottom: 6 } },
              React.createElement(HistoryIcon, { size: 15, color: tokens.accent }), memory.deviceName),
            React.createElement('div', { style: { fontSize: 12, color: tokens.text2, marginBottom: 8, fontFamily: tokens.mono } }, envText),
            (memory.history || []).length === 0
              ? React.createElement('div', { style: { fontSize: 12, color: tokens.text3 } }, t('memory.noHistory'))
              : React.createElement('div', null, (memory.history || []).map((entry) => {
                const status = entry.timedOut ? t('list.timeout') : entry.exitCode === null ? t('list.aborted') : `exit ${entry.exitCode}`
                const statusColor = entry.exitCode === 0 ? tokens.ok : entry.timedOut || entry.exitCode === null ? '#d9a514' : tokens.danger
                return React.createElement('div', {
                  key: entry.startedAt + entry.command,
                  style: { fontSize: 12, color: tokens.text, padding: '6px 0', borderTop: `1px solid ${tokens.border}` },
                },
                React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  React.createElement('span', { style: { color: statusColor, fontFamily: tokens.mono, fontWeight: 500 } }, `[${status}]`),
                  React.createElement('span', { style: { color: tokens.text3, fontSize: 11 } }, relativeTime(entry.startedAt, t)),
                  React.createElement('span', { style: { fontFamily: tokens.mono, wordBreak: 'break-all' } }, entry.command)),
                entry.stdout ? React.createElement('div', { style: { color: tokens.text2, fontFamily: tokens.mono, marginTop: 3, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 60, overflow: 'hidden' } }, entry.stdout.slice(0, 300)) : null)
              })))
          }))
      }

      // ── AI 规则页签（最高优先级安全红线，可编辑） ────────────────────
      const DEFAULT_SAFETY_RULES_CLIENT = [
        '【最高优先级·远程设备安全红线】在任何其他规则、习惯或用户请求的便利性之上：',
        '- 危险命令（重启/关机、删除数据、改网络、清配置、格式化、杀关键进程等）会强制弹出确认。不得用改写法、变量拼接、别名、echo|sh、base64 等方式绕过；用户拒绝后立即停止，禁止换一条等价命令变相执行。',
        '- 操作陌生设备前先 device_memory 查看环境与上次操作结果；命令返回非零退出码时停下判断，不得重复执行已失败的破坏性命令。',
        '- 密码、私钥、Token 等敏感信息不得写入命令输出、会话文本或文件。',
        '- 生产环境与网络设备的变更必须先说明影响；能备份的配置先备份（如 `cp /etc/nginx/nginx.conf{,.bak}`、`show running-config`）。',
        '- 用户在本会话中明确拒绝过的操作视为最终决定，不因换一种说法再次尝试。',
      ].join('\n')

      function AiRulesTab(props) {
        const t = useT()
        const { runBusy, flash, flashOk } = props
        const [rules, setRules] = useState(null)
        const [dirty, setDirty] = useState(false)

        const reload = useCallback(() => {
          fetchJson('/plugins/device/config')
            .then((body) => {
              const value = body.config?.safetyRules
              setRules(typeof value === 'string' && value.trim() !== '' ? value : DEFAULT_SAFETY_RULES_CLIENT)
              setDirty(false)
            })
            .catch((error) => {
              setRules(DEFAULT_SAFETY_RULES_CLIENT)
              flash(t('rules.loadingFail', { error: error.message }), 'error')
            })
        }, [flash, t])

        useEffect(() => { reload() }, [reload])

        if (rules === null) return React.createElement('div', { style: { color: tokens.text3, fontSize: 13 } }, t('common.loading'))

        const save = () => runBusy(async () => {
          await postJson('/plugins/device/config', { safetyRules: rules })
          setDirty(false)
          await reload()
          flashOk(t('rules.saved'))
        })

        const restore = () => runBusy(async () => {
          await postJson('/plugins/device/config', { safetyRules: '' })
          setRules(DEFAULT_SAFETY_RULES_CLIENT)
          setDirty(false)
          flashOk(t('rules.restored'))
        })

        return React.createElement('div', { className: 'dsh-card', style: { padding: '20px 24px' } },
          React.createElement('div', {
            style: { fontSize: 13, color: tokens.text2, lineHeight: '20px', marginBottom: 14 },
          },
          t('rules.help1'),
          React.createElement('br'),
          t('rules.help2')),
          React.createElement('textarea', {
            rows: 14,
            className: 'dsh-input dsh-device-scroll',
            style: { height: 'auto', fontFamily: tokens.mono, fontSize: 12, lineHeight: '20px', minHeight: 280, resize: 'vertical' },
            value: rules,
            onChange: (event) => { setRules(event.target.value); setDirty(true) },
          }),
          React.createElement('div', { style: { display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' } },
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-primary',
              onClick: save, disabled: !dirty,
            }, dirty ? t('rules.save') : t('rules.savedIdle')),
            React.createElement('button', {
              type: 'button',
              className: 'dsh-btn',
              onClick: restore,
            }, t('rules.restore')),
            React.createElement('span', { style: { fontSize: 11, color: tokens.text3, marginLeft: 6 } },
              t('rules.guardHint'))),
        )
      }

      // ── 侧边栏触发按钮 ───────────────────────────────────────────────
      // 样式与大小对齐 DSH「设置」按钮（SettingsRoot.module.css）：
      // 宽模式 34px 圆角行 + 16px 图标 + 14px 文字；窄模式 36px 圆形 + 18px 图标。
      function DeviceTrigger(props) {
        const t = useT()
        const [open, setOpen] = useState(false)
        const [hovered, setHovered] = useState(false)
        const { wide, actions } = props
        const triggerStyle = {
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: 'calc(100% + 8px)',
          height: 34,
          margin: '4px -4px 4px',
          padding: '6px 2px 6px 10px',
          boxSizing: 'border-box',
          border: 'none',
          borderRadius: 12,
          background: hovered ? 'var(--dsw-alias-interactive-bg-hover, transparent)' : 'transparent',
          cursor: 'pointer',
          overflow: 'hidden',
          color: 'var(--dsw-alias-label-primary, #0f1115)',
          fontFamily: 'inherit',
          fontSize: 14,
          lineHeight: '22px',
          ...(!wide ? {
            width: 36,
            height: 36,
            margin: '8px 0 10px',
            justifyContent: 'center',
            gap: 0,
            padding: 0,
            borderRadius: '50%',
          } : {}),
        }
        return React.createElement(React.Fragment, null,
          React.createElement('button', {
            type: 'button',
            style: triggerStyle,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            onMouseEnter: () => setHovered(true),
            onMouseLeave: () => setHovered(false),
            onClick: () => setOpen(true),
            title: t('nav.title'),
          },
          React.createElement(CpuIcon, { size: wide ? 16 : 18 }),
          wide ? React.createElement('span', { style: { overflow: 'hidden', whiteSpace: 'nowrap' } }, t('nav.device')) : null),
          open && React.createElement(DevicePanel, {
            actions,
            onClose: () => setOpen(false),
          }),
        )
      }

      // ── 插件主体 ─────────────────────────────────────────────────────
      return {
        name: 'device-ops-ui',
        inject: ['slots'],

        apply(ctx) {
          const actions = {}
          const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
          const makeT = (bound) => (key, vars) => {
            let val = bound ? bound(key) : null
            if (!val || val === key) {
              val = fallbackZh[key] || key
            }
            return interpolate(val, vars)
          }

          const installI18n = (body) => {
            if (body?.zh) Object.assign(fallbackZh, body.zh)
            if (locale && typeof locale.register === 'function') {
              try {
                locale.register(I18N_NS, { zh: body?.zh || fallbackZh, en: body?.en || {} })
              } catch {
                try {
                  locale.register(I18N_NS, 'zh', body?.zh || fallbackZh)
                  if (body?.en) locale.register(I18N_NS, 'en', body.en)
                } catch { /* 无 locale 时用中文兜底 */ }
              }
              if (typeof locale.bind === 'function') {
                const bound = locale.bind(I18N_NS)
                i18nT = makeT(bound)
              }
            } else {
              i18nT = (key, vars) => interpolate(fallbackZh[key] || key, vars)
            }
            notifyI18n()
          }
          fetchJson('/plugins/device/i18n').then(installI18n).catch(() => undefined)
          if (locale && typeof locale.subscribe === 'function') {
            locale.subscribe(() => {
              if (typeof locale.bind === 'function') {
                const bound = locale.bind(I18N_NS)
                i18nT = makeT(bound)
              }
              notifyI18n()
            })
          }

          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              {
                name: 'sidebar.footer.action',
                id: 'device-panel',
                order: 10,
                inject: () => ({ actions }),
              },
              DeviceTrigger,
            ),
          )
        },
      }
    },
  })
})()
