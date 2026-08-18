/**
 * UI v4 验证：文件选择弹窗（原生 file input）+ 简化后的堡垒机页
 * 用法：PLAYWRIGHT_CHROMIUM=... node scripts/verify-ui-v4.mjs
 */
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto('http://127.0.0.1:3199/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.locator('button[title="设备管理"]').first().click()
await page.waitForTimeout(800)

const results = []
const check = (label, ok) => { results.push([label, ok]); console.log(`${ok ? '✓' : '✗'} ${label}`) }

// ── 添加设备：原生文件选择弹窗 ────────────────────────────────────────
await page.locator('button:has-text("添加设备")').first().click()
await page.waitForTimeout(500)
await page.locator('select').nth(1).selectOption('privateKey')
await page.waitForTimeout(400)
check('「选择私钥文件」按钮存在', await page.locator('button:has-text("选择私钥文件")').count() > 0)
check('file input（原生弹窗载体）存在', await page.locator('input[type="file"]').count() > 0)
// 模拟选择真实私钥文件（走 input change → FileReader → textarea）
await page.locator('input[type="file"]').setInputFiles('/tmp/dsh-sshd/client_key')
await page.waitForTimeout(600)
const textareaValue = await page.locator('textarea').first().inputValue()
check('选中文件后私钥内容自动填入', textareaValue.includes('BEGIN OPENSSH PRIVATE KEY'))
check('读取成功 Toast', await page.locator('text=已读取 client_key').count() > 0)
check('路径兜底输入框仍在', await page.locator('input[placeholder*="本机路径"]').count() > 0)

// ── 堡垒机页：Token/凭据库 UI 已移除 ──────────────────────────────────
await page.locator('button:has-text("堡垒机")').first().click()
await page.waitForTimeout(600)
check('已移除「API Token」字段', await page.locator('text=API Token').count() === 0)
check('已移除「存入 DSH 凭据库」按钮', await page.locator('button:has-text("存入 DSH 凭据库")').count() === 0)
check('已移除凭据库位置提示', await page.locator('text=.credentials.yaml').count() === 0)
check('有「复用 DeepSeek Harness 的 API Key」说明', await page.locator('text=复用 DeepSeek Harness 的 API Key').count() > 0)

await page.screenshot({ path: '/tmp/dsh-ui-v4.png' })
await browser.close()
const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length === 0 ? 0 : 1)
