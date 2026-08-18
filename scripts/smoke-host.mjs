/**
 * 主机端插件加载冒烟测试：用 cordis 手工组合最小服务面，
 * 验证插件 apply 不抛错、工具已注册、HTTP 路由挂载、
 * 工具管线可执行（device_list / device_add / device_exec 确认路径）。
 *
 * 用法：node scripts/smoke-host.mjs
 */
import { Context } from '@deepseek-ai/cordis'

// ── 伪造最小服务面（模拟 web profile 中已挂载的服务） ────────────────
function createFakeServicesPlugin(services) {
  return {
    name: 'fake-services',
    apply(ctx) {
      ctx.provide('tools', services.tools)
      ctx.provide('systemPrompt', services.systemPrompt)
      ctx.provide('settings', services.settings)
      ctx.provide('webServer', services.webServer)
      ctx.provide('skills', services.skills)
      ctx.provide('userQuestions', services.userQuestions)
      ctx.provide('commands', services.commands)
    },
  }
}

function fakeServices() {
  const tools = {
    register: (tool) => {
      tools.list.push(tool)
      return () => { tools.list = tools.list.filter((entry) => entry !== tool) }
    },
    list: [],
  }
  const systemPrompt = {
    sections: [],
    section: (section) => { systemPrompt.sections.push(section) },
  }
  let settingsDoc = {}
  const settings = {
    namespaces: new Map(),
    register(ns, schema, options) {
      const resolved = schema({ ...(options?.base ?? {}) })
      const doc = {}
      const scope = {
        get: () => ({ ...resolved, ...doc }),
        watch: () => () => undefined,
        update: async (patch) => { Object.assign(doc, patch) },
        replace: async (section) => { Object.assign(doc, section) },
      }
      settings.namespaces.set(String(ns), scope)
      return scope
    },
    get: (ns) => settings.namespaces.get(String(ns))?.get(),
  }
  const routes = []
  const webServer = {
    register: (route) => { routes.push(route); return () => undefined },
    routes,
  }
  const registeredSkills = []
  const skills = {
    register: (skill) => { registeredSkills.push(skill); return () => undefined },
    registeredSkills,
  }
  const userQuestions = {
    asked: [],
    ask: async (req) => {
      userQuestions.asked.push(req)
      // 按问题 id 回「取消」（模拟用户拒绝）
      const answers = req.questions.map((question) => ({ id: question.id, selected: ['取消'] }))
      return { answers }
    },
  }
  const commands = {
    list: [],
    register: (definition) => {
      commands.list.push(definition)
      return () => { commands.list = commands.list.filter((entry) => entry !== definition) }
    },
  }
  return { tools, systemPrompt, settings, webServer, skills, userQuestions, commands }
}

async function main() {
  const ctx = new Context()
  const services = fakeServices()
  await ctx.plugin(createFakeServicesPlugin(services))
  const devicePlugin = await import('../lib/index.js')
  const fiber = await ctx.plugin(devicePlugin, {})

  const toolNames = services.tools.list.map((tool) => tool.name).sort()
  console.log('已注册工具:', toolNames.join(', '))
  const expected = ['device_add', 'device_exec', 'device_find', 'device_list', 'device_memory', 'device_remove', 'device_test', 'jumpserver_sync']
  for (const name of expected) {
    if (!toolNames.includes(name)) throw new Error(`缺少工具 ${name}`)
  }
  if (services.systemPrompt.sections.length === 0) throw new Error('未注册系统提示词片段')
  if (services.skills.registeredSkills.length < 20) {
    throw new Error(`随包技能注册数异常：${services.skills.registeredSkills.length}`)
  }
  const routePaths = services.webServer.routes.map((route) => route.path).sort()
  console.log('HTTP 路由:', routePaths.join(', '))
  for (const path of ['/plugins/device/devices', '/plugins/device/config', '/plugins/device/exec', '/plugins/device/sync', '/plugins/device/assets', '/plugins/device/memory', '/plugins/device/assets/accounts', '/plugins/device/read-file', '/plugins/device/probe', '/plugins/device/i18n']) {
    if (!routePaths.includes(path)) throw new Error(`缺少路由 ${path}`)
  }

  // 直接驱动工具（走真实 execute）
  const listTool = services.tools.list.find((tool) => tool.name === 'device_list')
  const result = await listTool.execute({}, { signal: new AbortController().signal })
  if (!Array.isArray(result.devices)) throw new Error('device_list 返回异常')

  const addTool = services.tools.list.find((tool) => tool.name === 'device_add')
  const added = await addTool.execute({ name: '测试', host: '127.0.0.1', port: 1, username: 'root' }, {})
  const execTool = services.tools.list.find((tool) => tool.name === 'device_exec')
  const declined = await execTool.execute(
    { device: added.id, command: 'echo hi', confirm: 'yes' },
    { signal: new AbortController().signal },
  )
  if (services.userQuestions.asked.length !== 1) throw new Error('确认通道未被调用')
  if (declined.device.id !== added.id) throw new Error('device_exec 返回异常')
  if (declined.declined !== true) throw new Error('确认被拒后应返回 declined')

  // 危险命令护栏（dangerous 级）：confirm=no 跳过普通确认，仍强制弹窗（此处被拒）
  services.userQuestions.asked.length = 0
  const dangerDeclined = await execTool.execute(
    { device: added.id, command: 'reboot', confirm: 'no' },
    { signal: new AbortController().signal },
  )
  if (services.userQuestions.asked.length !== 1) throw new Error('危险命令未触发强制确认')
  if (!services.userQuestions.asked[0].questions[0].question.includes('reboot')) {
    throw new Error('危险确认未携带命令内容')
  }
  if (dangerDeclined.declined !== true) throw new Error('危险命令被拒后应返回 declined')

  // 危险命令护栏（blocked 硬墙）：不弹确认，直接拒绝
  services.userQuestions.asked.length = 0
  const blocked = await execTool.execute(
    { device: added.id, command: 'rm -rf /etc/nginx', confirm: 'no' },
    { signal: new AbortController().signal },
  )
  if (services.userQuestions.asked.length !== 0) throw new Error('blocked 命令不应弹确认')
  if (blocked.blocked !== true) throw new Error('blocked 命令应返回 blocked: true')
  if (!blocked.blockedReason?.includes('拒绝')) throw new Error('blocked 应带拒绝原因')

  services.userQuestions.asked.length = 0
  const diskpartBlocked = await execTool.execute(
    { device: added.id, command: 'diskpart', confirm: 'no' },
    { signal: new AbortController().signal },
  )
  if (services.userQuestions.asked.length !== 0) throw new Error('diskpart 不应弹确认')
  if (diskpartBlocked.blocked !== true) throw new Error('diskpart 应硬墙拒绝')

  const addSchema = addTool.parameters?.encoding?.enum
    || addTool.def?.parameters?.encoding?.enum
    || addTool.schema?.properties?.encoding?.enum
  if (Array.isArray(addSchema) && !addSchema.includes('latin1')) {
    throw new Error('device_add 编码 enum 应包含 latin1/utf16le')
  }

  const removeTool = services.tools.list.find((tool) => tool.name === 'device_remove')
  await removeTool.execute({ device: added.id }, {})

  // ── 内网 IP 字段 + device_find 按地址精确匹配 ────────────────────────
  const ipAdded = await addTool.execute(
    { name: 'IP测试机', host: '10.1.2.3', port: 22, username: 'root', lanIp: '192.168.10.5' },
    {},
  )
  const listTool2 = services.tools.list.find((tool) => tool.name === 'device_list')
  const withIp = await listTool2.execute({ query: '192.168.10' }, {})
  if (!withIp.devices.some((d) => d.id === ipAdded.id && d.lanIp === '192.168.10.5')) {
    throw new Error('device_list 应按内网 IP 过滤且输出 lanIp')
  }
  const findTool = services.tools.list.find((tool) => tool.name === 'device_find')
  const byLan = await findTool.execute({ address: '192.168.10.5' }, {})
  if (byLan.matched !== true || byLan.candidates[0]?.match !== 'lanIp' || byLan.candidates[0]?.id !== ipAdded.id) {
    throw new Error('device_find 按内网 IP 匹配失败')
  }
  const byHost = await findTool.execute({ address: '10.1.2.3' }, {})
  if (byHost.matched !== true || byHost.candidates[0]?.match !== 'host') {
    throw new Error('device_find 按主机地址匹配失败')
  }
  const noMatch = await findTool.execute({ address: '10.9.9.9' }, {})
  if (noMatch.matched !== false || noMatch.candidates.length !== 0) {
    throw new Error('device_find 未匹配时返回异常')
  }
  await removeTool.execute({ device: ipAdded.id }, {})

  // ── 堡垒机资产：按登记地址匹配（探针 lanIp 路径走真实连接流程，此处校验 address 路径） ──
  const cacheScope = services.settings.namespaces.get('device-cache')
  if (!cacheScope) throw new Error('device-cache 命名空间未注册')
  await cacheScope.update({
    assets: [
      { id: 'asset-1', name: '资产A', address: '10.20.30.40', protocols: [{ name: 'ssh', port: 22 }], platform: 'Linux', orgName: 'ops' },
      { id: 'asset-2', name: '资产B', address: 'b.example.com', protocols: [{ name: 'ssh', port: 22 }], platform: 'Linux' },
    ],
    total: 2,
    lastSyncAt: Date.now(),
    error: '',
  })
  const byAsset = await findTool.execute({ address: '10.20.30.40' }, {})
  if (byAsset.matched !== true || byAsset.candidates[0]?.kind !== 'asset' || byAsset.candidates[0]?.id !== 'asset-1' || byAsset.candidates[0]?.match !== 'address') {
    throw new Error('device_find 按堡垒机资产地址匹配失败')
  }
  const assetList = await listTool2.execute({ query: '资产A' }, {})
  if (!assetList.assets.some((a) => a.id === 'asset-1')) {
    throw new Error('device_list 应按资产名过滤堡垒机资产')
  }

  const commandNames = services.commands.list.map((item) => item.name).sort()
  console.log('斜杠命令:', commandNames.join(', '))
  const expectedCommands = ['device-exec', 'device-list', 'device-memory', 'jumpserver-sync']
  for (const name of expectedCommands) {
    if (!commandNames.includes(name)) throw new Error(`缺少斜杠命令 ${name}`)
  }
  const listCmd = services.commands.list.find((item) => item.name === 'device-list')
  if (!listCmd.description) throw new Error('device-list 缺少 description 备注')
  const listed = await listCmd.handler({ rawInput: '', agent: {}, signal: new AbortController().signal })
  if (listed.kind !== 'success' || !String(listed.text).includes('手动添加的设备')) {
    throw new Error(' /device-list 未返回清单文本')
  }
  const execCmd = services.commands.list.find((item) => item.name === 'device-exec')
  const execBad = await execCmd.handler({ rawInput: '', agent: {}, signal: new AbortController().signal })
  if (execBad.kind !== 'error') throw new Error('/device-exec 缺参数应返回 error')
  const slashDevice = await addTool.execute(
    { name: '斜杠测试机', host: '10.8.8.8', port: 22, username: 'root' },
    {},
  )
  const memCmd = services.commands.list.find((item) => item.name === 'device-memory')
  const mem = await memCmd.handler({ rawInput: slashDevice.id, agent: {}, signal: new AbortController().signal })
  if (mem.kind !== 'success' || !String(mem.text).includes('斜杠测试机')) {
    throw new Error(`/device-memory 应返回成功文本：${mem?.text}`)
  }
  const execDeclined = await execCmd.handler({
    rawInput: `${slashDevice.id} echo hi`,
    agent: {},
    signal: new AbortController().signal,
  })
  if (execDeclined.kind !== 'success' || !String(execDeclined.text).includes('取消')) {
    throw new Error(`/device-exec 确认拒绝应返回取消文案：${execDeclined?.text}`)
  }
  const syncCmd = services.commands.list.find((item) => item.name === 'jumpserver-sync')
  const synced = await syncCmd.handler({ rawInput: '', agent: {}, signal: new AbortController().signal })
  if (synced.kind !== 'error' || !String(synced.text).includes('JumpServer')) {
    throw new Error('/jumpserver-sync 未配置时应返回 error')
  }

  // 设置命名空间已注册（settings 描述可用）
  console.log('设置命名空间:', [...services.settings.namespaces.keys()].join(', '))

  // （注册的注销由真实 dsh-tools 服务通过 ctx.effect 保证，本测试的伪造
  //  register 无法绑定调用方 fiber，故不在此断言卸载行为。）
  await fiber.dispose()

  console.log('\n主机端插件冒烟测试通过')
  process.exit(0)
}

main().catch((error) => {
  console.error('冒烟测试失败:', error)
  process.exit(1)
})
