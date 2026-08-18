import assert from 'node:assert/strict'
import { JumpServerClient } from '../lib/jumpserver.js'

console.log('--- 测试 JumpServerClient 多账号解析 ---')

const client = new JumpServerClient({
  url: 'http://127.0.0.1:8080',
  username: 'admin',
  password: 'password',
})

// 1. normalizeAsset 提取资产随附 accounts
const mockAsset1 = {
  id: 'asset-1',
  name: 'bigdata-nginx',
  address: '10.0.11.58',
  protocols: ['ssh/22'],
  accounts: [
    { id: 'acc-1', name: 'root', username: 'root' },
    { id: 'acc-2', name: 'nginx', username: 'nginx' },
  ],
}
const norm1 = client.normalizeAsset(mockAsset1)
assert.equal(norm1.accounts.length, 2, '应成功提取 2 个账号')
assert.equal(norm1.accounts[0].name, 'root')
assert.equal(norm1.accounts[1].name, 'nginx')

// 2. 单账号资产
const mockAsset2 = {
  id: 'asset-2',
  name: 'db-master',
  address: '10.0.11.59',
  protocols: ['ssh/22'],
  system_users: ['mysql'],
}
const norm2 = client.normalizeAsset(mockAsset2)
assert.equal(norm2.accounts.length, 1)
assert.equal(norm2.accounts[0].name, 'mysql')

console.log('✓ normalizeAsset 多账号与单账号解析测试通过')
