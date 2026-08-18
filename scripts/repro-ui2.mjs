// 打开设备面板后做像素级采样 + 子树样式转储（不依赖截图）
import { chromium } from 'playwright-core';

const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b = await chromium.launch({ executablePath: EXE, headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
p.on('pageerror', (e) => errs.push('[pageerror] ' + String(e)));
await p.goto('http://127.0.0.1:3199', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2200);
for (let i = 0; i < 8; i++) {
  const m = await p.evaluate(() => {
    const d = [...document.querySelectorAll('[role=presentation],[role=dialog]')].find((x) => {
      const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
      return r.width > 50 && s.display !== 'none' && s.visibility !== 'hidden';
    });
    if (!d) return null;
    return [...d.querySelectorAll('button')].map((x) => x.innerText.trim()).filter(Boolean);
  });
  if (!m) break;
  const t = m.find((x) => /稍后|跳过|取消|关闭|下次/.test(x)) || m.find((x) => /继续|保存|确定|进入/.test(x));
  if (!t) break;
  await p.locator(`button:has-text("${t}")`).first().click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(800);
}
await p.locator('button:has-text("设备")').first().click();
await p.waitForTimeout(1600);

// 1) 找面板根：包含「设备管理」文本的最外层元素
const rootInfo = await p.evaluate(() => {
  const all = [...document.querySelectorAll('*')].filter((x) => x.innerText && x.innerText.includes('设备管理') && x.children.length > 3);
  const cand = all.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
  const r = cand.getBoundingClientRect();
  const s = getComputedStyle(cand);
  return { tag: cand.tagName, cls: String(cand.className).slice(0, 100), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: s.backgroundColor, radius: s.borderRadius, z: s.zIndex, pos: s.position, overflow: s.overflow };
});
console.log('面板根:', JSON.stringify(rootInfo));

// 2) 面板区域像素采样：每 16px 采样一次 → 聚成色块地图
const pxMap = await p.evaluate(([rx, ry, rw, rh]) => {
  const map = [];
  for (let y = ry; y < ry + rh; y += 16) {
    let row = '';
    for (let x = rx; x < rx + rw; x += 16) {
      const el = document.elementFromPoint(x, y);
      if (!el) { row += '.'; continue; }
      const s = getComputedStyle(el);
      let ch = ' ';
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') ch = 'B';
      else if (el.tagName === 'TABLE' || el.tagName === 'TD' || el.tagName === 'TH') ch = 'T';
      else if (el.tagName === 'PRE' || el.tagName === 'CODE') ch = 'P';
      else ch = '·';
      // 用亮度区分背景
      const m = s.backgroundColor.match(/\d+/g);
      const lum = m && m.length >= 3 ? (Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114) : 255;
      row += lum < 60 ? '#' : lum < 150 ? '+' : ch;
    }
    map.push(row);
  }
  return map;
}, rootInfo.rect);
console.log('像素地图(每16px: #=深色背景 +=中色 B=控件 T=表格 P=代码块 ·=浅色):');
pxMap.forEach((r, i) => console.log(String(i).padStart(3) + '|' + r));

// 3) 面板子树文本+样式转储（前 120 个可见元素）
const tree = await p.evaluate(([rx, ry, rw, rh]) => {
  const root = [...document.querySelectorAll('*')].filter((x) => x.innerText && x.innerText.includes('设备管理') && x.children.length > 3)
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
  const out = [];
  const walk = (el, depth, seq) => {
    if (out.length > 150) return;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    if (visible) {
      const text = (el.childElementCount === 0 ? el.innerText : '').trim().slice(0, 24);
      out.push({
        d: depth, s: seq, tag: el.tagName.toLowerCase() + (String(el.className) ? '.' + String(el.className).split(' ')[0].slice(0, 18) : ''),
        rect: [Math.round(r.x - rx), Math.round(r.y - ry), Math.round(r.width), Math.round(r.height)],
        bg: s.backgroundColor, fg: s.color, fs: s.fontSize, fw: s.fontWeight, bd: s.border, br: s.borderRadius,
        text,
      });
    }
    let i = 0;
    for (const c of el.children) { if (out.length > 150) break; walk(c, depth + 1, seq + '.' + i); i++; }
  };
  walk(root, 0, 'R');
  return out;
}, rootInfo.rect);
console.log('\n子树样式(rect相对面板左上, bg/fg=计算后颜色):');
for (const t of tree) {
  console.log(`${String(t.d).padStart(2)} ${t.s.padEnd(8)} ${t.tag.padEnd(22)} rect=[${t.rect}] bg=${t.bg} fg=${t.fg} fs=${t.fs} fw=${t.fw} br=${t.br} ${t.text ? '"' + t.text + '"' : ''}`);
}

console.log('\n--- 错误 ---');
console.log(errs.join('\n') || '(无)');
await b.close();
