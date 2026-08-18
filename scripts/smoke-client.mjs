/**
 * 客户端 bundle 验证：在 Node VM 中模拟 window.__ModuleLoader__ 与
 * 最小 react，执行 lib/client.js 的 factory，验证：
 * - bundle 语法合法、factory 可执行
 * - 导出的插件 {name, inject, apply} 形态正确
 * - apply 时向 sidebar.footer.action 注入面板注册（经 ctx.slots.inject）
 *
 * 用法：node scripts/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(__dirname, '..', 'lib', 'client.js'), 'utf8')

// 捕获 __ModuleLoader__.load 调用
let loaded
const fakeReact = new Proxy({}, {
  get: (_target, prop) => {
    if (prop === 'createElement') return (tag, props, ...children) => ({ tag, props, children })
    if (prop === 'Fragment') return Symbol.for('react.fragment')
    if (prop === 'useState') return (initial) => [initial, () => undefined]
    if (prop === 'useEffect') return () => undefined
    if (prop === 'useRef') return () => ({ current: null })
    if (prop === 'useCallback') return (fn) => fn
    if (prop === 'useMemo') return (fn) => fn()
    return () => undefined
  },
})

const windowMock = {
  __ModuleLoader__: {
    load: (record) => { loaded = record },
  },
}

const context = vm.createContext({
  window: windowMock,
  console,
  fetch: () => Promise.reject(new Error('无浏览器 fetch')),
  URL,
  Date,
  JSON,
  Promise,
  RegExp,
  Set,
  Map,
  WeakMap,
  AbortController,
  Symbol,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  Math,
})

vm.runInContext(source, context, { filename: 'client.js' })
assert.ok(loaded, 'bundle 未调用 window.__ModuleLoader__.load')
assert.equal(loaded.id, '@sailfish/dsh-device')

const moduleExports = loaded.factory((spec) => {
  if (spec === 'react') return fakeReact
  if (spec === 'react/jsx-runtime') return { jsx: fakeReact.createElement }
  throw new Error(`unexpected require: ${spec}`)
})

assert.equal(typeof moduleExports.apply, 'function', '缺少 apply')
assert.equal(typeof moduleExports.name, 'string')
assert.equal(Array.isArray(moduleExports.inject), true, 'inject 应为数组')
assert.deepEqual([...moduleExports.inject], ['slots'], 'inject 应为 [slots]')

// 模拟客户端 cordis 环境执行 apply
const registrations = []
const fakeSlots = {
  inject: (key, callback) => {
    const effect = callback()
    assert.equal(typeof effect, 'function', 'slots.inject 回调应返回 disposer')
    registrations.push(key)
    return () => undefined
  },
  register: () => () => undefined,
}
const fakeCtx = {
  slots: fakeSlots,
  get: () => undefined,
  on: () => () => undefined,
  effect: (fn) => fn(),
}

moduleExports.apply(fakeCtx)
assert.deepEqual(registrations, ['sidebar.footer.action'], '未注入 sidebar.footer.action')

console.log('客户端 bundle 验证通过')
console.log(`- id: ${loaded.id}`)
console.log(`- inject: ${moduleExports.inject.join(', ')}`)
console.log(`- UI 注入点: ${registrations.join(', ')}`)
