// 复现用户反馈：「点击设备后，里面的UI有问题」
// 打开页面 → 点「设备」→ 逐页签截图 + 收集控制台错误 + 面板 DOM 概要
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME_PATH ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e)));

await page.goto('http://127.0.0.1:3199', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
// 循环关闭所有首次进入的模态（配置等）
for (let i = 0; i < 8; i++) {
  const visibleModal = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=presentation],[role=dialog]')].find((x) => {
      const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
      return r.width > 50 && s.display !== 'none' && s.visibility !== 'hidden';
    });
    if (!d) return null;
    const btns = [...d.querySelectorAll('button')].map((x) => x.innerText.trim()).filter(Boolean);
    return { btns };
  });
  if (!visibleModal) break;
  const skipBtn = visibleModal.btns.find((t) => /稍后|跳过|取消|关闭|下次/.test(t));
  const goBtn = visibleModal.btns.find((t) => /继续|保存|确定|进入/.test(t));
  const target = skipBtn || goBtn;
  if (!target) break;
  await page.locator(`button:has-text("${target}")`).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(900);
}

// 点「设备」按钮
const btn = page.locator('button:has-text("设备")').first();
console.log('设备按钮可见:', await btn.isVisible().catch(() => false));
await btn.click();
await page.waitForTimeout(1500);

await page.screenshot({ path: '/tmp/repro-panel.png' });

// 面板概要
const panelInfo = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('body > *').forEach((el) => {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width > 400 && r.height > 300) {
      out.push({
        tag: el.tagName, cls: String(el.className).slice(0, 80),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        bg: st.backgroundColor, color: st.color, radius: st.borderRadius,
        zIndex: st.zIndex,
      });
    }
  });
  return out;
});
console.log('大面板层:', JSON.stringify(panelInfo, null, 2));

// 逐页签截图
const tabs = ['设备列表', '添加设备', '堡垒机', '快速执行', '操作记忆', 'AI 规则'];
for (const t of tabs) {
  const tab = page.locator(`button:has-text("${t}")`).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `/tmp/repro-tab-${t}.png` });
    console.log(`tab ${t}: ok`);
  } else {
    console.log(`tab ${t}: 不可见`);
  }
}

console.log('--- 错误 ---');
console.log(errors.length ? errors.join('\n') : '(无)');
await browser.close();
