/**
 * Web 冒烟测试（自包含）：临时 DSH_HOME 起一个 dsh web 实例，
 * 用 Playwright 打开设备面板，检查页签顺序 / 默认页签 / 切换 / 关闭 /
 * 控制台错误，结束后清理实例与临时目录。
 *
 * 用法：node scripts/smoke-web.mjs（package.json 的 pnpm run smoke:web）
 *
 * 前置：
 * - dsh 在 PATH 中；
 * - 主 profile（$DSH_HOME 或 ~/.dsh/profiles/web）已安装依赖（node_modules 存在，
 *   临时 profile 通过 junction/symlink 复用，无需网络安装）；
 * - 浏览器：优先系统 Chrome / Edge（channel），其次 CHROME_PATH，最后
 *   自动扫描 ms-playwright 缓存目录。
 */

import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, readdirSync,
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import http from 'node:http'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const IS_WIN = process.platform === 'win32'

const fail = (message) => {
  throw new Error(message)
}

/** 取一个空闲端口。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

/** 轮询等待 HTTP 服务就绪。 */
function waitHttp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`等待 http://127.0.0.1:${port} 超时`))
        else setTimeout(tick, 400)
      })
    }
    tick()
  })
}

/** 扫描常见路径找 Playwright 缓存的 Chromium。 */
function findPlaywrightChromium() {
  const roots = [
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'ms-playwright')] : []),
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const dirs = readdirSync(root).filter((name) => /^chromium/.test(name)).sort().reverse()
    for (const dir of dirs) {
      const candidates = [
        join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        join(root, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        join(root, dir, 'chrome-win64', 'chrome.exe'),
        join(root, dir, 'chrome-win', 'chrome.exe'),
        join(root, dir, 'chrome-linux', 'chrome'),
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

/** 依次尝试 系统Chrome → 系统Edge → CHROME_PATH → Playwright 缓存。 */
async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ channel: 'chrome', headless: true }),
    () => chromium.launch({ channel: 'msedge', headless: true }),
    ...(process.env.CHROME_PATH ? [() => chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })] : []),
  ]
  for (const attempt of attempts) {
    try {
      return await attempt()
    } catch {
      // 尝试下一个
    }
  }
  const cached = findPlaywrightChromium()
  if (!cached) fail('找不到可用的浏览器：请安装 Chrome/Edge 或设置 CHROME_PATH')
  return chromium.launch({ executablePath: cached, headless: true })
}

/** 关闭首次进入的配置类模态（稍后配置/跳过/取消/继续…）。 */
async function dismissModals(page) {
  for (let i = 0; i < 8; i++) {
    const modal = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role=presentation],[role=dialog]')].find((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 50 && s.display !== 'none' && s.visibility !== 'hidden'
      })
      if (!dialog) return null
      return [...dialog.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean)
    })
    if (!modal) return
    const target = modal.find((t) => /稍后|跳过|取消|关闭|下次/.test(t))
      || modal.find((t) => /继续|保存|确定|进入/.test(t))
    if (!target) return
    await page.locator(`button:has-text("${target}")`).first().click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(800)
  }
}

const childLog = []

async function main() {
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh-web-smoke-'))
  let child
  let browser
  try {
    // 1) 临时 profile：复用主 profile 的 node_modules（junction/symlink，无网络）
    const profileDir = join(tempHome, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@sailfish/dsh-device'],
        },
      },
      dependencies: { '@sailfish/dsh-device': `link:${ROOT}` },
    }, null, 2))
    const srcNodeModules = join(MAIN_HOME, 'profiles', 'web', 'node_modules')
    if (!existsSync(srcNodeModules)) {
      fail(`主 profile 缺少 node_modules（${srcNodeModules}）：请先完成 web profile 安装`)
    }
    symlinkSync(srcNodeModules, join(profileDir, 'node_modules'), IS_WIN ? 'junction' : 'dir')

    // 2) 起 dsh web
    const port = await freePort()
    child = spawn(IS_WIN ? 'dsh.cmd' : 'dsh', ['web', '--port', String(port)], {
      env: { ...process.env, DSH_HOME: tempHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => childLog.push(String(chunk)))
    child.stderr.on('data', (chunk) => childLog.push(String(chunk)))
    await waitHttp(port)
    console.log(`dsh web 已就绪：http://127.0.0.1:${port}（临时 HOME: ${tempHome}）`)

    // 3) 浏览器检查
    browser = await launchBrowser()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`) })
    page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e)}`))
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await dismissModals(page)

    const deviceButton = page.locator('button:has-text("设备")').first()
    if (!(await deviceButton.isVisible().catch(() => false))) fail('侧边栏未找到「设备」按钮')
    await deviceButton.click()
    // 面板开启动画期间尺寸渐变，轮询等待 800×800
    let panelReady = false
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(200)
      panelReady = await page.evaluate(() => Boolean([...document.querySelectorAll('*')].find((el) => {
        const r = el.getBoundingClientRect()
        return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3
      })))
      if (panelReady) break
    }
    if (!panelReady) fail('设备面板未出现（800×800）')

    const info = await page.evaluate(() => {
      const root = [...document.querySelectorAll('*')].find((el) => {
        const r = el.getBoundingClientRect()
        return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3
      })
      const rootRect = root.getBoundingClientRect()
      // 只扫描左导航栏（188px 宽 + 少许余量）内的按钮，排除内容区按钮
      const navButtons = [...root.querySelectorAll('button')].map((b) => ({
        text: (b.innerText || '').trim(),
        bg: getComputedStyle(b).backgroundColor,
        x: b.getBoundingClientRect().x,
      })).filter((b) =>
        b.x >= rootRect.x && b.x < rootRect.x + 190
        && b.text.length > 0 && b.text.length < 8 && b.text !== '✕')
      return navButtons.slice(0, 8).map(({ text, bg }) => ({ text, bg }))
    })
    const expectedTabs = ['AI 规则', '设备列表', '添加设备', '堡垒机', '快速执行', '操作记忆']
    const gotTabs = info.map((b) => b.text)
    for (const tab of expectedTabs) {
      if (!gotTabs.includes(tab)) fail(`页签缺失「${tab}」（实际：${gotTabs.join(', ')}）`)
    }
    if (gotTabs.indexOf('AI 规则') !== 0) fail(`「AI 规则」应在页签栏第一位（实际：${gotTabs.join(', ')}）`)
    const active = info.find((b) => b.text === 'AI 规则')
    if (!active || active.bg === 'rgba(0, 0, 0, 0)') fail('默认页签应为「AI 规则」（选中态）')

    // 遍历切换全部页签（渲染不崩溃）
    for (const tab of expectedTabs) {
      await page.locator(`button:has-text("${tab}")`).first().click()
      await page.waitForTimeout(500)
    }

    // 关闭按钮
    await page.locator('button[title="关闭"]').first().click().catch(() => undefined)
    await page.waitForTimeout(600)
    const stillOpen = await page.evaluate(() => Boolean([...document.querySelectorAll('*')].find((el) => {
      const r = el.getBoundingClientRect()
      return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3
    })))
    if (stillOpen) fail('点击 ✕ 后面板未关闭')

    if (errors.length > 0) fail(`浏览器控制台错误：\n${errors.join('\n')}`)
    console.log('✓ 设备按钮存在')
    console.log(`✓ 面板 800×800，页签顺序：${gotTabs.join(' / ')}`)
    console.log('✓ 默认页签 = AI 规则（选中态）')
    console.log('✓ 6 个页签切换渲染正常，✕ 关闭正常')
    console.log('✓ 控制台无错误')
    console.log('\nWeb 冒烟测试通过')
  } finally {
    // 注意：清理必须在进程退出前完成（不能依赖 process.exit 跳过 finally）
    if (child) { try { child.kill('SIGTERM') } catch { /* 忽略 */ } }
    if (browser) { try { await browser.close() } catch { /* 忽略 */ } }
    // 等子进程释放文件句柄（Windows 上立刻删会 EBUSY）
    await new Promise((resolve) => setTimeout(resolve, 400))
    try { rmSync(tempHome, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('✗ Web 冒烟测试失败:', error?.message ?? error)
    if (childLog.length > 0) console.error('--- dsh web 日志 ---\n' + childLog.join('').slice(-2000))
    process.exit(1)
  },
)
