/**
 * AI 对话真实调用验证：在 3199 测试实例上创建会话、让模型执行
 * device_list 并汇报，随后检查会话历史中的工具调用轨迹。
 *
 * 会消耗少量 API 配额（一次极简对话）。
 *
 * 用法：node scripts/verify-ai.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3199'
let rpcSeq = 0
const call = async (method, payload) => {
  const rpcId = `ai-verify-${++rpcSeq}`
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const body = await res.json()
  if (!body.result?.ok) throw new Error(`${method}: ${JSON.stringify(body.result)}`)
  return body.result.value
}

// 1. 创建会话
const created = await call('session.create', {})
const sessionId = created.sessionId
console.log('会话已创建:', sessionId)

// 2. 提交任务：让模型先查设备再汇报
await call('session.prompt', {
  sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: '用 device_list 工具查看当前可用设备，然后用一句话汇报结果。' }],
})
console.log('prompt 已提交，等待执行…')

// 3. 轮询历史直到出现 assistant/message
let done = false
for (let i = 0; i < 60 && !done; i++) {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  const history = await call('session.history', { sessionId, maxMessages: 30 })
  const events = history.events.map((entry) => entry.event ?? entry)
  const assistant = events.filter((event) => event.type === 'assistant/message')
  if (assistant.length > 0) done = true
  // 打印进度
  if (i % 5 === 0) {
    const toolCalls = events.filter((event) => event.type?.startsWith('tool/'))
    console.log(`  [${i * 2}s] 事件数 ${events.length}，工具事件 ${toolCalls.length}，助手消息 ${assistant.length}`)
  }
  if (done) {
    const toolEvents = events.filter((event) => event.type === 'tool/call' || event.type === 'tool/result')
    console.log('\n工具调用轨迹:')
    for (const event of toolEvents) {
      const data = event.data ?? {}
      const name = data.name ?? event.name ?? '?'
      const args = JSON.stringify(data.arguments ?? {}).slice(0, 160)
      console.log(`  ${event.type} ${name} ${args}`)
    }
    const last = assistant[assistant.length - 1]
    const text = (last?.data?.content ?? last?.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    console.log('\n模型汇报:\n' + text)
    if (!toolEvents.some((event) => event.data?.name === 'device_list')) {
      console.error('\n⚠️ 未观察到 device_list 工具调用')
      process.exit(1)
    }
    console.log('\n✓ AI 真实对话已调用 device_list 工具')
    process.exit(0)
  }
}
console.error('\n超时：模型未在 120s 内完成')
process.exit(1)
