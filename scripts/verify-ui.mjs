/**
 * 浏览器 UI 真实验证：用 Playwright（chromium-1217）打开 3199 实例：
 * 1. 页面加载，等待侧边栏出现
 * 2. 断言「设备」按钮存在于侧边栏底部
 * 3. 点击打开设备面板，断言面板标题与四个页签
 * 4. 截图存证
 *
 * 用法：node scripts/verify-ui.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.DSH_TEST_URL || 'http://127.0.0.1:3199/'
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200))
})
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)))

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// 1. 侧边栏「设备」按钮
const deviceButton = page.locator('button[title="设备管理"], button:has-text("设备")').first()
const count = await deviceButton.count()
console.log(`设备按钮: ${count > 0 ? '存在' : '不存在'}`)
if (count === 0) {
  // 侧边栏可能处于折叠状态，先截图看全貌
  await page.screenshot({ path: '/tmp/dsh-ui-sidebar.png' })
  console.log('已保存 /tmp/dsh-ui-sidebar.png 供排查')
} else {
  await page.screenshot({ path: '/tmp/dsh-ui-sidebar.png' })
  await deviceButton.click()
  await page.waitForTimeout(1200)

  const title = page.locator('text=设备管理').first()
  console.log(`面板标题: ${await title.count() > 0 ? '已打开' : '未找到'}`)
  for (const tab of ['设备列表', '添加设备', '堡垒机', '快速执行']) {
    const el = page.locator(`button:has-text("${tab}")`).first()
    console.log(`页签「${tab}」: ${await el.count() > 0 ? '存在' : '缺失'}`)
  }
  await page.screenshot({ path: '/tmp/dsh-ui-panel.png' })

  // 切到设备列表页签，验证之前添加的 SSH/Telnet 设备行可见
  await page.locator('button:has-text("设备列表")').first().click()
  await page.waitForTimeout(800)
  const rows = await page.locator('text=本机SSH测试').count()
  console.log(`设备列表含「本机SSH测试」行: ${rows > 0 ? '是' : '否'}`)
  await page.screenshot({ path: '/tmp/dsh-ui-devices.png' })
}

await browser.close()
console.log('UI 验证完成')
