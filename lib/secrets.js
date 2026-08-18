/**
 * 敏感凭据加密存储（参考 SailFish credential.service 的 g1: 方案）：
 * 设备密码/私钥/口令不再明文落盘，而是 AES-256-GCM 加密后存
 * $DSH_HOME/storages/device_secrets/（目录 0700）：
 *
 * - master.key：16 字节随机 salt（0o600，每台机器独有）
 * - secrets.json：{ <deviceId>: { password: 'g1:<b64>', ... } }
 * - 密钥派生：key = PBKDF2(SEED, salt, 200000 iters, 32B, sha256)
 * - 密文结构：g1: + base64(iv[12] || ciphertext || tag[16])
 *
 * 纯 Node（node:crypto），macOS / Windows 通用；不依赖 Electron safeStorage。
 * 旧的明文字段（device_store.json 中的 password/privateKey）在读取时
 * 一次性迁移进加密存储并从设备记录中剥离。
 *
 * @module @sailfish/dsh-device/secrets
 */

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const PBKDF2_ITERS = 200000
const KEY_BYTES = 32
const SALT_BYTES = 16
const SEED_BYTES = 64

/** 需要加密存储的敏感字段。 */
const SECRET_FIELDS = ['password', 'privateKey', 'passphrase', 'jump:password', 'jump:privateKey', 'jump:passphrase']

/** 默认存储目录（DSH home 下的 storages 旁，独立目录避免与设备清单混写）。 */
export function defaultSecretsDir() {
  return join(homedir(), '.dsh', 'storages', 'device_secrets')
}

/**
 * 派生种子：首次使用时生成 64 字节随机 secret 存 master.seed（0o600）。
 * 相比 SailFish 的硬编码 SEED（全用户共享、需反编译二进制），每个
 * DSH 用户的种子独立随机——盗走 secrets.json + master.key 也解不开。
 */
function deriveSeed(dir) {
  const seedPath = join(dir, 'master.seed')
  let seed
  if (existsSync(seedPath)) {
    seed = readFileSync(seedPath)
    if (seed.length !== SEED_BYTES) throw new Error('master.seed 已损坏（长度不符）')
  } else {
    seed = randomBytes(SEED_BYTES)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // wx 独占创建：多进程并发首次启动只允许一个成功
    try {
      writeFileSync(seedPath, seed, { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (error?.code === 'EEXIST') seed = readFileSync(seedPath)
      else throw error
    }
    try { chmodSync(seedPath, 0o600) } catch { /* Windows 上 chmod 受限，忽略 */ }
  }
  return seed
}

/** 派生密钥（salt 不存在时创建并落盘，wx 独占防多进程竞争）。 */
function deriveKey(dir) {
  const saltPath = join(dir, 'master.key')
  let salt
  if (existsSync(saltPath)) {
    salt = readFileSync(saltPath)
    if (salt.length !== SALT_BYTES) throw new Error('master.key 已损坏（salt 长度不符）')
  } else {
    salt = randomBytes(SALT_BYTES)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      writeFileSync(saltPath, salt, { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (error?.code === 'EEXIST') salt = readFileSync(saltPath)
      else throw error
    }
    try { chmodSync(saltPath, 0o600) } catch { /* Windows 上 chmod 受限，忽略 */ }
  }
  const seed = deriveSeed(dir)
  return pbkdf2Sync(seed, salt, PBKDF2_ITERS, KEY_BYTES, 'sha256')
}

function encrypt(key, plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `g1:${Buffer.concat([iv, ciphertext, tag]).toString('base64')}`
}

function decrypt(key, encoded) {
  if (typeof encoded !== 'string' || !encoded.startsWith('g1:')) {
    throw new Error('密文格式不支持（不是 g1: 格式）')
  }
  const payload = Buffer.from(encoded.slice(3), 'base64')
  if (payload.length < 12 + 16) throw new Error('密文已损坏（长度不足）')
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(payload.length - 16)
  const ciphertext = payload.subarray(12, payload.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * 秘密存储：按设备 id 管理一组敏感字段。
 * 所有读写走串行链，杜绝并发写坏文件。
 */
export class SecretStore {
  /**
   * @param {string} [dir] - 存储目录；默认 $DSH_HOME/storages/device_secrets。
   */
  constructor(dir = defaultSecretsDir()) {
    this.dir = dir
    this.file = join(dir, 'secrets.json')
    this.data = {} // deviceId → { password?, privateKey?, passphrase? }
    this.loaded = false
    this.tail = Promise.resolve()
    this.key = null
  }

  #ensure() {
    if (this.loaded) return
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      try { chmodSync(this.dir, 0o700) } catch { /* Windows 忽略 */ }
      this.key = deriveKey(this.dir)
      if (existsSync(this.file)) {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'))
      }
    } catch (error) {
      // 密钥/文件损坏：秘密不可用（连接时报可读错误），但不阻断插件加载
      this.key = null
      this.data = {}
      this.loadError = error
    }
    this.loaded = true
  }

  #persist() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp`
    writeFileSync(temp, JSON.stringify(this.data, null, 1), { mode: 0o600 })
    try { chmodSync(temp, 0o600) } catch { /* Windows 忽略 */ }
    // tmp + rename 原子替换（参考 SailFish 原子性要求；Windows 上 rename 覆盖先删旧）
    try {
      renameSync(temp, this.file)
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
        writeFileSync(this.file, readFileSync(temp))
      } else {
        throw error
      }
    }
  }

  /** 按字段写入：空字符串=清除该字段；有值=加密覆盖；undefined=不动。 */
  async setField(deviceId, field, value) {
    this.#ensure()
    const task = this.tail.then(() => {
      if (!this.key) return
      const entry = this.data[deviceId] ?? {}
      if (value === '') {
        delete entry[field]
      } else {
        entry[field] = encrypt(this.key, value)
      }
      this.data[deviceId] = entry
      this.#persist()
    })
    this.tail = task.catch(() => undefined)
    await task
  }

  /** 保存一台设备的敏感字段（值 → 加密存储）。 */
  async set(deviceId, secrets) {
    this.#ensure()
    const task = this.tail.then(() => {
      if (!this.key) return
      const entry = {}
      for (const field of SECRET_FIELDS) {
        const value = secrets[field]
        if (typeof value !== 'string' || value === '') continue
        entry[field] = encrypt(this.key, value)
      }
      this.data[deviceId] = entry
      this.#persist()
    })
    this.tail = task.catch(() => undefined)
    await task
  }

  /** 读取并解密一台设备的敏感字段（不存在/损坏返回空对象）。 */
  async get(deviceId) {
    this.#ensure()
    if (!this.key) return {}
    const entry = this.data[deviceId]
    if (!entry) return {}
    const out = {}
    for (const field of SECRET_FIELDS) {
      try {
        if (entry[field]) out[field] = decrypt(this.key, entry[field])
      } catch {
        // 单字段损坏：跳过并标记，其余字段照常
        out[`${field}Corrupt`] = true
      }
    }
    return out
  }

  /** 删除一台设备的秘密（幂等）。 */
  async remove(deviceId) {
    this.#ensure()
    const task = this.tail.then(() => {
      if (delete this.data[deviceId]) this.#persist()
    })
    this.tail = task.catch(() => undefined)
    await task
  }

  /** 是否已有该设备的秘密条目（面板展示"已保存"标记用）。 */
  async has(deviceId) {
    this.#ensure()
    return Boolean(this.data[deviceId])
  }
}
