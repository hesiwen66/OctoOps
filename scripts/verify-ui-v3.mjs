/**
 * 交互体验验证（第三轮）：Playwright 驱动真实浏览器：
 * 1. 设备列表：状态点（绿）、上次操作摘要、hover 按钮
 * 2. 「测试」→ 成功 Toast（绿色 ✓）
 * 3. 「删除」→ 内联二次确认 → 取消
 * 4. 快速执行：输入命令 → ⌘+Enter → 输出区 + 复制/清空按钮
 * 5. Esc 关闭面板；再次打开仍可用
 * 6. 操作记忆：相对时间（刚刚/n 分钟前）+ 刷新按钮
 *
 * 用法：PLAYWRIGHT_CHROMIUM=... node scripts/verify-ui-v3.mjs
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

// 1. 设备列表状态点 + lastOp
check('设备行渲染', await page.locator('text=UX测试机').count() > 0)
check('上次操作摘要（pre-populated-history）', await page.locator('text=pre-populated-history').count() > 0)
check('相对时间或状态标记（exit 0）', await page.locator('text=exit 0').count() > 0)

// 2. 测试 → 成功 toast
await page.locator('button:has-text("测试")').first().click()
await page.waitForTimeout(1500)
check('测试成功 Toast（✓ SSH 连接正常）', await page.locator('text=SSH 连接正常').count() > 0)

// 3. 删除 → 内联确认 → 取消
await page.locator('button:has-text("删除")').first().click()
await page.waitForTimeout(300)
check('删除二次确认文案', await page.locator('text=删除将同时清除该设备的记忆').count() > 0)
await page.locator('button:has-text("取消")').first().click()
await page.waitForTimeout(300)
check('取消后设备仍存在', await page.locator('text=UX测试机').count() > 0)

// 4. 快速执行
await page.locator('button:has-text("快速执行")').first().click()
await page.waitForTimeout(500)
await page.locator('select').first().selectOption({ index: 0 })
await page.locator('textarea').first().fill('echo ui-interaction-ok')
await page.locator('textarea').first().press('Meta+Enter')
await page.waitForTimeout(2500)
check('执行输出（ui-interaction-ok）', await page.locator('text=ui-interaction-ok').count() > 0)
check('复制按钮', await page.locator('button:has-text("复制")').count() > 0)
check('清空按钮', await page.locator('button:has-text("清空")').count() > 0)
check('最近命令下拉', await page.locator('text=最近命令').count() > 0)

// 5. Esc 关闭面板
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check('Esc 关闭面板', await page.locator('text=设备管理').count() === 0)
await page.locator('button[title="设备管理"]').first().click()
await page.waitForTimeout(400)
check('重新打开面板', await page.locator('text=设备管理').count() > 0)

// 6. 操作记忆
await page.locator('button:has-text("操作记忆")').first().click()
await page.waitForTimeout(800)
check('记忆页含设备', await page.locator('text=UX测试机').count() > 0)
check('刷新按钮', await page.locator('button:has-text("刷新")').count() > 0)
const relative = await page.locator('text=/秒前|分钟前|刚刚/').count()
check(`相对时间显示（${relative} 处）`, relative > 0)

await page.screenshot({ path: '/tmp/dsh-ui-v3.png' })
await browser.close()
const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length === 0 ? 0 : 1)
