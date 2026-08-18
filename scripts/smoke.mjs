/**
 * 引擎冒烟测试（不依赖 DSH 运行时）：
 * - telnet 引擎：进程内起一个假 telnet 服务（登录提示 → 命令 → 提示符）
 * - ssh 引擎：错误路径（连接被拒绝的端口）
 * - 会话池：连接复用、空闲逐出、仅连接错误才重试
 * - 输出清洗：ANSI/回显/提示符噪声
 * - 危险命令护栏：命中矩阵
 * - 设备仓库：内存模式的增删查改（无 storage 时自动退化为内存）
 * - skills：确认随包技能可读
 *
 * 用法：node scripts/smoke.mjs
 */
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { telnetExec, telnetTest, telnetConnect, telnetLogin, telnetRun } from '../lib/telnet.js'
import { sshExec } from '../lib/ssh.js'
import { DeviceRepo, normalizeDevice, publicView } from '../lib/repo.js'
import { SessionPool, isRetryableConnectionError } from '../lib/pool.js'
import { inspectDangerousCommand, inspectSensitiveReadPath } from '../lib/guard.js'
import { missingI18nKeys, matchChoice, createTranslator } from '../lib/i18n.js'
import { cleanTerminalOutput, stripCommandEcho } from '../lib/clean.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
let failures = 0

async function check(label, fn) {
  try {
    await fn()
    console.log(`✓ ${label}`)
  } catch (error) {
    failures += 1
    console.error(`✗ ${label}: ${error?.message || error}`)
  }
}

// ── 假 telnet 服务 ────────────────────────────────────────────────────
function startFakeTelnet() {
  let connections = 0
  const server = createServer((socket) => {
    connections += 1
    socket.write('Welcome to FakeSwitch\r\nLogin: ')
    let stage = 'login'
    socket.on('data', (data) => {
      const text = data.toString('utf8')
      if (stage === 'login' && /admin/i.test(text)) {
        socket.write('\r\nPassword: ')
        stage = 'password'
      } else if (stage === 'password') {
        socket.write('\r\n\r\nSWITCH> ')
        stage = 'ready'
      } else if (stage === 'ready') {
        const line = text.trim()
        if (/^exit$/i.test(line)) {
          socket.end('\r\nBye\r\n')
        } else if (line.length > 0) {
          // 输出带 ANSI 色码 + 命令回显噪声，验证清洗
          socket.write(`\r\n${line}\r\n\x1b[32moutput-of-${line.split(' ')[0]}\x1b[0m\r\nSWITCH> `)
        }
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, connections: () => connections }))
  })
}

const fake = await startFakeTelnet()

await check('telnet：登录并执行命令', async () => {
  const result = await telnetExec(
    { host: '127.0.0.1', port: fake.port, username: 'admin', password: 'p@ss' },
    'show version',
    { timeoutMs: 8000, loginTimeoutMs: 5000, promptRegex: 'SWITCH>\\s*$', loginRegex: 'Login:\\s*$', passwordRegex: 'Password:\\s*$' },
  )
  assert.equal(result.timedOut, false)
  assert.ok(result.stdout.includes('output-of-show'), result.stdout)
})

await check('telnet：连通性测试', async () => {
  const result = await telnetTest(
    { host: '127.0.0.1', port: fake.port, username: 'admin', password: 'p@ss' },
    { promptRegex: 'SWITCH>\\s*$', loginRegex: 'Login:\\s*$', passwordRegex: 'Password:\\s*$' },
  )
  assert.equal(result.ok, true, result.message)
})

await check('telnet：错误提示符正则 → 明确报错', async () => {
  await telnetExec(
    { host: '127.0.0.1', port: fake.port, username: 'admin', password: 'bad' },
    'show version',
    { timeoutMs: 2000, loginTimeoutMs: 2000, promptRegex: 'NEVER-MATCH$', loginRegex: 'Login:\\s*$', passwordRegex: 'Password:\\s*$' },
  ).then(
    () => { throw new Error('应当失败') },
    (error) => assert.ok(/超时|不匹配/.test(error.message), error.message),
  )
})

// ── 会话池：连接复用 ──────────────────────────────────────────────────
await check('pool：两次执行只建立一条 Telnet 连接', async () => {
  const conn = { host: '127.0.0.1', port: fake.port, username: 'admin', password: 'p@ss' }
  const pool = new SessionPool({ idleTimeoutMs: 60000 })
  let creates = 0
  const factory = {
    key: 'pool-test',
    serialize: true,
    create: async () => {
      creates += 1
      const session = await telnetConnect(conn)
      await telnetLogin(session, conn, { promptRegex: 'SWITCH>\\s*$', loginRegex: 'Login:\\s*$', passwordRegex: 'Password:\\s*$' })
      return session
    },
    run: (session, command) => telnetRun(session, command, {
      timeoutMs: 8000, promptRegex: 'SWITCH>\\s*$', maxOutputChars: 20000,
    }),
    destroy: (session) => session.destroy(),
  }
  const before = fake.connections()
  const r1 = await pool.exec(factory.key, factory, 'show version')
  const r2 = await pool.exec(factory.key, factory, 'show version')
  assert.equal(creates, 1, `create 被调用 ${creates} 次，应复用连接`)
  assert.equal(fake.connections(), before + 1, '服务器侧只应新增一条连接')
  assert.ok(r1.stdout.includes('output-of-show'))
  assert.ok(r2.stdout.includes('output-of-show'))
  // 输出清洗：无 ANSI 色码、无命令回显、无残留提示符
  assert.ok(!r1.stdout.includes('\x1b['), `残留 ANSI：${JSON.stringify(r1.stdout)}`)
  assert.ok(!r1.stdout.includes('show version'), `残留回显：${JSON.stringify(r1.stdout)}`)
  assert.ok(!r1.stdout.includes('SWITCH>'), `残留提示符：${JSON.stringify(r1.stdout)}`)
  pool.dispose()
})

await check('pool：空闲逐出与 dispose', async () => {
  const pool = new SessionPool({ idleTimeoutMs: 400 })
  const factory = {
    key: 'idle-test',
    serialize: true,
    create: async () => {
      const session = await telnetConnect({ host: '127.0.0.1', port: fake.port, username: 'admin', password: 'p@ss' })
      await telnetLogin(session, { username: 'admin', password: 'p@ss' }, { promptRegex: 'SWITCH>\\s*$', loginRegex: 'Login:\\s*$', passwordRegex: 'Password:\\s*$' })
      return session
    },
    run: () => Promise.resolve({ exitCode: 0, stdout: 'x', stderr: '', timedOut: false, aborted: false }),
    destroy: (session) => session.destroy(),
  }
  await pool.exec(factory.key, factory, 'x')
  assert.equal(pool.size, 1)
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal(pool.size, 0, '空闲超时后应逐出')
  await pool.exec(factory.key, factory, 'x')
  pool.dispose()
  assert.equal(pool.size, 0)
})

await check('pool：仅连接错误才重试', () => {
  assert.equal(isRetryableConnectionError(new Error('ECONNRESET')), true)
  assert.equal(isRetryableConnectionError(new Error('Connection lost')), true)
  assert.equal(isRetryableConnectionError(new Error('Socket closed')), true)
  assert.equal(isRetryableConnectionError(new Error('command not found')), false)
  assert.equal(isRetryableConnectionError(new Error('All configured authentication methods failed')), false)
  assert.equal(isRetryableConnectionError(new Error('等待提示符超时')), false)
  assert.equal(isRetryableConnectionError(new Error('ETIMEDOUT')), false)
  const aborted = new Error('被取消')
  aborted.name = 'AbortError'
  assert.equal(isRetryableConnectionError(aborted), false)
})

await check('pool：业务错误不重连不重跑', async () => {
  const pool = new SessionPool({ idleTimeoutMs: 60000 })
  let creates = 0
  let runs = 0
  const factory = {
    key: 'biz-fail',
    create: async () => {
      creates += 1
      return { id: creates }
    },
    run: async () => {
      runs += 1
      throw new Error('command not found')
    },
    destroy: () => {},
  }
  await pool.exec(factory.key, factory, 'bad').then(
    () => { throw new Error('应当失败') },
    (error) => assert.match(error.message, /command not found/),
  )
  assert.equal(creates, 1, '业务错误不应重建连接')
  assert.equal(runs, 1, '业务错误不应重跑命令')
  assert.equal(pool.size, 1, '业务失败应保留原会话')
  pool.dispose()
})

await check('pool：连接错误销毁后重试一次', async () => {
  const pool = new SessionPool({ idleTimeoutMs: 60000 })
  let creates = 0
  let runs = 0
  const factory = {
    key: 'conn-fail',
    create: async () => {
      creates += 1
      return { id: creates }
    },
    run: async () => {
      runs += 1
      if (runs === 1) throw new Error('ECONNRESET')
      return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }
    },
    destroy: () => {},
  }
  const result = await pool.exec(factory.key, factory, 'x')
  assert.equal(result.stdout, 'ok')
  assert.equal(creates, 2, '连接错误应重建一次')
  assert.equal(runs, 2, '连接错误应重跑一次')
  pool.dispose()
})

await check('pool：withSession 业务错误不重试', async () => {
  const pool = new SessionPool({ idleTimeoutMs: 60000 })
  let creates = 0
  const factory = {
    key: 'ws-biz',
    create: async () => {
      creates += 1
      return { id: creates }
    },
    destroy: () => {},
  }
  await pool.withSession(factory.key, factory, async () => {
    throw new Error('SFTP 路径不存在')
  }).then(
    () => { throw new Error('应当失败') },
    (error) => assert.match(error.message, /路径不存在/),
  )
  assert.equal(creates, 1)
  assert.equal(pool.size, 1)
  pool.dispose()
})

// ── 输出清洗与危险命令护栏 ────────────────────────────────────────────
await check('clean：ANSI/CRLF/回显/提示符', () => {
  const dirty = '\x1b[31mred\x1b[0m line1\r\nline2\r\nSWITCH> '
  assert.equal(cleanTerminalOutput(dirty), 'red line1\nline2\nSWITCH>')
  assert.equal(stripCommandEcho('show version\r\noutput', 'show version'), 'output')
})

await check('guard：危险命令命中矩阵', () => {
  const dangerous = ['rm -rf /var/log', 'reboot', 'shutdown -h now', 'iptables -F', 'DROP TABLE users', 'DELETE FROM logs', 'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', ':(){ :|:& };:',
    // Windows（跨平台兼容）
    'del /f /q C:\\temp\\*', 'rd /s /q build', 'format c:', 'shutdown /r /f', 'Remove-Item -Recurse -Force foo', 'Clear-Content log.txt', 'netsh interface set interface "以太网" disabled']
  for (const command of dangerous) {
    assert.equal(inspectDangerousCommand(command).dangerous, true, `${command} 应命中`)
  }
  const blocked = ['diskpart', 'write erase', 'reload', 'reload in 5', 'reload force']
  for (const command of blocked) {
    assert.equal(inspectDangerousCommand(command).blocked, true, `${command} 应硬墙拒绝`)
  }
  const safe = ['cat /etc/hosts', 'echo hi', 'systemctl status nginx', 'systemctl reload nginx', 'nginx -s reload', 'service nginx reload', 'df -h', 'rm /tmp/app.log', 'apt list --installed', 'del temp.txt', 'dir', 'Get-Process']
  for (const command of safe) {
    assert.equal(inspectDangerousCommand(command).dangerous, false, `${command} 不应命中`)
  }
  // 危险命令加安全后缀不改变判定（如 rm -rf /var/log --preserve-root 仍是危险）
  assert.equal(inspectDangerousCommand('sudo rm -rf /var/cache/*').dangerous, true)
  assert.equal(inspectSensitiveReadPath('/etc/passwd').sensitive, true)
  assert.equal(inspectSensitiveReadPath('/etc/shadow').sensitive, true)
  assert.equal(inspectSensitiveReadPath('/etc/sudoers').sensitive, true)
  assert.equal(inspectSensitiveReadPath('/etc/hosts').sensitive, false)
})

await check('ssh：连接被拒绝 → 可读错误', async () => {
  await sshExec({ host: '127.0.0.1', port: 1, username: 'root' }, 'echo hi', { timeoutMs: 3000 }).then(
    () => { throw new Error('应当失败') },
    (error) => assert.ok(/ECONNREFUSED|refused|连接被拒绝/.test(error.message), error.message),
  )
})

await check('ssh：AbortSignal 取消', async () => {
  const controller = new AbortController()
  const pending = sshExec({ host: '203.0.113.1', port: 22, username: 'root' }, 'echo hi', {
    timeoutMs: 15000,
    readyTimeoutMs: 15000,
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 200)
  await pending.then(
    () => { throw new Error('应当失败') },
    (error) => assert.ok(/取消/.test(error.message), error.message),
  )
})

// ── 设备仓库（内存模式 + 加密秘密存储） ───────────────────────────────
await check('repo：秘密加密落盘 / upsert 保留 / 清除 / hydrate', async () => {
  const { rmSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const testDir = join(homedir(), '.dsh', 'storages', 'device_secrets_smoke')
  rmSync(testDir, { recursive: true, force: true })
  const repo = new DeviceRepo({ get: () => undefined, logger: console }, testDir)
  const added = await repo.upsert({ name: '测试机', host: '10.0.0.1', username: 'root', password: 'secret1', privateKey: 'KEY-DATA' })
  assert.equal(added.id.length > 0, true)
  // 设备记录不含明文秘密
  assert.equal('password' in added, false, '设备记录不得含明文密码')
  assert.equal(added.secretFlags.password, true)
  // 明文不得落盘
  const raw = readFileSync(join(testDir, 'secrets.json'), 'utf8')
  assert.ok(!raw.includes('secret1') && !raw.includes('KEY-DATA'), '秘密不得明文落盘')
  assert.ok(raw.includes('g1:'), '应为 g1: 加密格式')
  // hydrate 解密注入
  const hydrated = await repo.hydrateSecrets(added)
  assert.equal(hydrated.password, 'secret1')
  assert.equal(hydrated.privateKey, 'KEY-DATA')
  // 不带密码的更新保留旧秘密（flag 保留 + hydrate 可读）
  const updated = await repo.upsert({ id: added.id, name: '测试机2', host: '10.0.0.1', username: 'root' })
  assert.equal(updated.secretFlags.password, true)
  assert.equal((await repo.hydrateSecrets(updated)).password, 'secret1')
  // 空字符串清除秘密
  const cleared = await repo.upsert({ id: added.id, name: '测试机2', host: '10.0.0.1', username: 'root', password: '' })
  assert.equal(cleared.secretFlags.password, false)
  assert.equal((await repo.hydrateSecrets(cleared)).password, undefined)
  // 跳板机秘密同样加密
  await repo.upsert({ id: added.id, name: '测试机2', host: '10.0.0.1', username: 'root', jumpHost: { host: 'jump', username: 'ops', password: 'jump-pw' } })
  const withJump = await repo.find(added.id)
  const hydratedJump = await repo.hydrateSecrets(withJump)
  assert.equal(hydratedJump.jumpHost.password, 'jump-pw')
  assert.equal('password' in withJump.jumpHost, false)
  const view = publicView(withJump)
  assert.equal(view.jumpHost.hasPassword, true)
  // 删除设备连带清秘密
  await repo.remove(added.id)
  assert.equal(await repo.find(added.id), undefined)
  assert.deepEqual(await repo.secrets.get(added.id), {})
  rmSync(testDir, { recursive: true, force: true })
  await repo.close()
})

await check('repo：旧明文秘密自动迁移加密', async () => {
  const { rmSync, readFileSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const dir = join(homedir(), '.dsh', 'storages', 'device_secrets_migrate')
  rmSync(dir, { recursive: true, force: true })
  const storeDir = join(homedir(), '.dsh', 'storages')
  mkdirSync(storeDir, { recursive: true })
  const storeFile = join(storeDir, 'device_store.json')
  // 模拟旧版带明文秘密的记录
  const legacy = {
    unit: { name: 'device_store', version: 1 },
    tables: { devices: { 'legacy-1': { id: 'legacy-1', name: '旧设备', host: '10.0.0.9', port: 22, protocol: 'ssh', username: 'root', authType: 'password', password: 'legacy-pw' } } },
  }
  writeFileSync(storeFile, JSON.stringify(legacy, null, 1))
  const fakeStorage = {
    backend: {
      get: () => ({
        kv: {
          open: async () => ({
            loadAll: async () => ({ tables: JSON.parse(readFileSync(storeFile, 'utf8')).tables ?? {}, global: null }),
            putRecord: async () => undefined,
            deleteRecord: async () => undefined,
            close: async () => undefined,
          }),
        },
      }),
    },
  }
  const repo = new DeviceRepo({ get: () => fakeStorage, logger: console }, dir)
  const device = await repo.find('legacy-1')
  assert.equal('password' in device, false, '迁移后记录应剥离明文')
  assert.equal(device.secretFlags?.password, true)
  const hydrated = await repo.hydrateSecrets(device)
  assert.equal(hydrated.password, 'legacy-pw')
  await repo.close()
  rmSync(storeFile, { force: true })
  rmSync(dir, { recursive: true, force: true })
})

await check('repo：normalize 校验', () => {
  assert.throws(() => normalizeDevice({ host: '' }))
  const d = normalizeDevice({ host: 'x', protocol: 'telnet' })
  assert.equal(d.port, 23)
  assert.equal(d.protocol, 'telnet')
})

await check('i18n：中英 key 对齐且确认选项可反查', () => {
  const missing = missingI18nKeys()
  assert.equal(missing.length, 0, `字典不对齐：${missing.join(', ')}`)
  assert.equal(matchChoice('取消', ['common.cancel', 'danger.confirm']), 'common.cancel')
  assert.equal(matchChoice('Cancel', ['common.cancel', 'danger.confirm']), 'common.cancel')
  assert.equal(matchChoice('确认执行', ['danger.confirm', 'common.cancel']), 'danger.confirm')
  assert.equal(matchChoice('Confirm', ['danger.confirm', 'common.cancel']), 'danger.confirm')
  assert.equal(createTranslator('en')('cmd.list.desc').includes('JumpServer'), true)
})

// ── skills ───────────────────────────────────────────────────────────
await check('skills：随包技能可读且 frontmatter 合法', () => {
  const skillsDir = join(__dirname, '..', 'skills')
  const dirs = readdirSync(skillsDir)
  assert.ok(dirs.length >= 20, `expected >= 20 skills, got ${dirs.length}`)
  for (const dir of dirs) {
    const content = readFileSync(join(skillsDir, dir, 'SKILL.md'), 'utf8')
    assert.ok(/^---\nname: [a-z0-9-]+\ndescription: /.test(content), `${dir} frontmatter 不合法`)
  }
})

fake.server.close()
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
