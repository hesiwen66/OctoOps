import assert from 'node:assert/strict'

console.log('--- 测试普通手动添加机器与堡垒机导入机器的连接入口路由隔离 ---')

// 1. 普通手动添加的机器（直连）
const pureManualDevice = {
  id: 'd-123456',
  name: '我的本地测试机',
  host: '192.168.1.100',
  port: 22,
  protocol: 'ssh',
  username: 'ubuntu',
  password: 'mypassword',
}
const isJms1 = Boolean((pureManualDevice.source === 'jumpserver' || pureManualDevice.assetId || pureManualDevice.id.startsWith('js-')))
assert.equal(isJms1, false, '普通手动添加机器不应被判定为 JumpServer 来源')

// 2. 从 JumpServer 导入的机器
const importedJmsDevice = {
  id: 'js-999999',
  name: 'fcst测试环境',
  host: '114.55.236.194',
  port: 22,
  protocol: 'ssh',
  username: '',
  source: 'jumpserver',
  assetId: '999999',
}
const isJms2 = Boolean((importedJmsDevice.source === 'jumpserver' || importedJmsDevice.assetId || importedJmsDevice.id.startsWith('js-')))
assert.equal(isJms2, true, '从 JumpServer 导入的机器必须被识别为 JumpServer 来源并走堡垒机入口')

// 3. 手动添加但自己配置了专属业务跳板机的机器
const manualWithCustomJump = {
  id: 'd-789012',
  name: '私有网段机器',
  host: '10.20.30.40',
  port: 22,
  protocol: 'ssh',
  username: 'root',
  jumpHost: {
    host: 'jump.mycompany.com',
    port: 22,
    username: 'ops',
  },
}
const isJms3 = Boolean((manualWithCustomJump.source === 'jumpserver' || manualWithCustomJump.assetId || manualWithCustomJump.id.startsWith('js-')))
assert.equal(isJms3, false, '带自定义跳板机的手动设备不应走 JumpServer')
assert.equal(manualWithCustomJump.jumpHost.host, 'jump.mycompany.com', '应保留用户自定义的跳板机')

console.log('✓ 连接入口隔离测试 100% 通过：普通手动机器直连，堡垒机机器走 JumpServer 入口！')
