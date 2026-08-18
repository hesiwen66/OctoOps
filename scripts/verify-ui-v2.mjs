// 第二轮 UI 验证：图标、记忆页签、私钥读取、凭据库按钮
import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto('http://127.0.0.1:3199/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.locator('button[title="设备管理"]').first().click()
await page.waitForTimeout(1000)
for (const tab of ['设备列表', '添加设备', '堡垒机', '快速执行', '操作记忆']) {
  console.log(`页签「${tab}」:`, await page.locator(`button:has-text("${tab}")`).count() > 0 ? '存在' : '缺失')
}
await page.screenshot({ path: '/tmp/dsh-ui-v2-list.png' })
await page.locator('button:has-text("添加设备")').first().click()
await page.waitForTimeout(500)
await page.locator('select').nth(0).selectOption('ssh')
await page.locator('select').nth(1).selectOption('privateKey')
await page.waitForTimeout(300)
console.log('「读取文件」按钮:', await page.locator('button:has-text("读取文件")').count() > 0 ? '存在' : '缺失')
await page.locator('button:has-text("操作记忆")').first().click()
await page.waitForTimeout(800)
console.log('记忆页签含设备行:', await page.locator('text=记忆测试机').count() > 0 ? '是' : '否')
await page.screenshot({ path: '/tmp/dsh-ui-v2-memory.png' })
await page.locator('button:has-text("堡垒机")').first().click()
await page.waitForTimeout(500)
console.log('「存入 DSH 凭据库」按钮:', await page.locator('button:has-text("存入 DSH 凭据库")').count() > 0 ? '存在' : '缺失')
await page.screenshot({ path: '/tmp/dsh-ui-v2-bastion.png' })
await browser.close()
console.log('UI v2 验证完成')
