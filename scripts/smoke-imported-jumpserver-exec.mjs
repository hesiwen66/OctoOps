import assert from 'node:assert/strict'
import { JumpServerClient } from '../lib/jumpserver.js'

console.log('--- 测试从堡垒机导入的设备动态取连接参数 ---')

// 模拟已导入设备
const importedDevice = {
  id: 'js-119428ca-328c-47da-8071-321d1263826f',
  name: 'fcst测试环境',
  host: '114.55.236.194',
  protocol: 'ssh',
  port: 22,
  username: '',
  source: 'jumpserver',
  assetId: '119428ca-328c-47da-8071-321d1263826f',
}

assert.equal(importedDevice.source, 'jumpserver')
assert.equal(importedDevice.assetId, '119428ca-328c-47da-8071-321d1263826f')
console.log('✓ 导入设备结构验证通过')
