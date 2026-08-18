/**
 * 堡垒机资产全链路 E2E：
 *   mock JumpServer(2321) + 真实 fake sshd(2223, 私钥认证) + cordis 伪服务面
 *   同步资产 → device_exec 连资产执行（connection-token 直连）→ 环境探针采集内网 IP
 *   → device_find 按「探针内网 IP」命中资产 → device_memory 能读资产记忆（含内网IP）
 *
 * 前置：mock-jms3.mjs 与 /tmp/dsh-sshd 的 sshd 已启动。
 * 用法：node scripts/e2e-asset-lanip.mjs
 */
import { Context } from '@deepseek-ai/cordis'

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
  const webServer = { register: () => () => undefined, routes: [] }
  const skills = { register: () => () => undefined, registeredSkills: [] }
  const userQuestions = { asked: [], ask: async () => { throw new Error('不应触发确认') } }
  return { tools, systemPrompt, settings, webServer, skills, userQuestions }
}

async function main() {
  const ctx = new Context()
  const services = fakeServices()
  await ctx.plugin(createFakeServicesPlugin(services))
  const devicePlugin = await import('../lib/index.js')
  const fiber = await ctx.plugin(devicePlugin, {})

  // 配置堡垒机指向 mock
  const deviceScope = services.settings.namespaces.get('device')
  await deviceScope.update({
    jumpserverUrl: 'http://127.0.0.1:2321',
    jumpserverUsername: 'admin',
    jumpserverPassword: 'mock-pass',
  })

  // 1) 同步资产
  const syncTool = services.tools.list.find((t) => t.name === 'jumpserver_sync')
  const sync = await syncTool.execute({})
  console.log('同步结果:', JSON.stringify(sync))
  if (sync.total !== 1) throw new Error('同步资产数应为 1')

  // 2) device_list 含资产
  const listTool = services.tools.list.find((t) => t.name === 'device_list')
  const listed = await listTool.execute({}, {})
  const asset = listed.assets.find((a) => a.id === 'asset-9')
  if (!asset) throw new Error('device_list 未返回堡垒机资产')
  console.log('资产:', JSON.stringify(asset))

  // 3) device_exec 连资产执行（confirm=no 跳过首次确认，account=root 跳过账号弹窗）
  const execTool = services.tools.list.find((t) => t.name === 'device_exec')
  const executed = await execTool.execute(
    { device: 'asset-9', command: 'echo hello-asset', confirm: 'no', account: 'root' },
    { signal: new AbortController().signal },
  )
  console.log('执行结果: exit=' + executed.exitCode + ' stdout=' + JSON.stringify(executed.stdout))
  if (executed.exitCode !== 0 || !executed.stdout.includes('hello-asset')) {
    throw new Error('堡垒机资产执行失败：' + JSON.stringify(executed))
  }

  // 4) device_find 按探针采集的内网 IP 命中资产（资产地址是域名，不直接匹配）
  const findTool = services.tools.list.find((t) => t.name === 'device_find')
  const byAddress = await findTool.execute({ address: 'web-03.example.com' }, {})
  console.log('按登记地址匹配:', JSON.stringify(byAddress.candidates[0]))
  if (byAddress.candidates[0]?.match !== 'address') throw new Error('按地址匹配失败')

  const byLan = await findTool.execute({ address: '10.1.130.196' }, {})
  console.log('按探针内网IP匹配:', JSON.stringify(byLan.candidates[0]))
  if (byLan.matched !== true || byLan.candidates[0]?.kind !== 'asset'
    || byLan.candidates[0]?.id !== 'asset-9' || byLan.candidates[0]?.match !== 'lanIp(探针)') {
    throw new Error('按探针内网 IP 匹配资产失败：' + JSON.stringify(byLan))
  }

  // 5) device_memory 能读资产记忆（含 lanip）
  const memoryTool = services.tools.list.find((t) => t.name === 'device_memory')
  const memory = await memoryTool.execute({ device: 'asset-9' }, {})
  const mem = memory.memories[0]
  console.log('资产记忆:', JSON.stringify({ deviceName: mem.deviceName, env: mem.env, historyCount: mem.history.length }))
  if (mem.env?.lanip !== '10.1.130.196') throw new Error('资产记忆缺少探针内网 IP：' + JSON.stringify(mem.env))
  if (mem.history.length < 1) throw new Error('资产记忆缺少操作历史')

  await fiber.dispose()
  console.log('\n✅ 堡垒机资产全链路 E2E 通过（执行→探针→内网IP匹配→记忆）')
  process.exit(0)
}

main().catch((error) => {
  console.error('❌ E2E 失败:', error)
  process.exit(1)
})
