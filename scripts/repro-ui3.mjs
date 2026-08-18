// v3: 稳健定位设备面板 → 像素地图 + 样式树
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
    return [...d.querySelectorAll('button')].map((x) => (x.innerText || x.textContent || '').trim()).filter(Boolean);
  });
  if (!m) break;
  const t = m.find((x) => /稍后|跳过|取消|关闭|下次/.test(x)) || m.find((x) => /继续|保存|确定|进入/.test(x));
  if (!t) break;
  await p.locator(`button:has-text("${t}")`).first().click({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(800);
}
const hasDevice = await p.locator('button:has-text("设备")').first().isVisible().catch(() => false);
console.log('设备按钮可见:', hasDevice);
if (hasDevice) { await p.locator('button:has-text("设备")').first().click(); await p.waitForTimeout(1800); }

const info = await p.evaluate(() => {
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  // 面板根：同时含「设备列表」「堡垒机」「添加设备」的最大元素
  const cands = [...document.querySelectorAll('*')].filter((x) => {
    const t = x.innerText || '';
    return t.includes('设备列表') && t.includes('堡垒机') && t.includes('添加设备');
  });
  const sorted = cands.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  const panel = sorted[0];
  const tabNodes = [...document.querySelectorAll('button')].filter((x) => ['设备列表', '添加设备', '堡垒机', '快速执行', '操作记忆', 'AI 规则'].includes((x.innerText || '').trim()) && (x.innerText || '').trim().length < 8);
  const tabs = tabNodes.map((x) => { const r = x.getBoundingClientRect(); return { t: x.innerText.trim(), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: getComputedStyle(x).backgroundColor, fg: getComputedStyle(x).color }; });
  let pr = null;
  if (panel) {
    const r = panel.getBoundingClientRect(); const s = getComputedStyle(panel);
    pr = { tag: panel.tagName, cls: String(panel.className).slice(0, 90), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: s.backgroundColor, radius: s.borderRadius, z: s.zIndex, pos: s.position, overflow: s.overflow };
  }
  return { bodyBg, panel: pr, tabs, panelCount: cands.length };
});
console.log('body背景:', info.bodyBg);
console.log('面板根:', JSON.stringify(info.panel));
console.log('面板候选数:', info.panelCount);
console.log('页签:', JSON.stringify(info.tabs, null, 1));

if (info.panel) {
  const [rx, ry, rw, rh] = info.panel.rect;
  const pxMap = await p.evaluate(([rx, ry, rw, rh]) => {
    const map = [];
    for (let y = ry + 8; y < ry + rh; y += 14) {
      let row = '';
      for (let x = rx + 8; x < rx + rw; x += 14) {
        const el = document.elementFromPoint(x, y);
        if (!el) { row += '.'; continue; }
        const s = getComputedStyle(el);
        let ch = ' ';
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') ch = 'B';
        else if (tag === 'TABLE' || tag === 'TD' || tag === 'TH') ch = 'T';
        else if (tag === 'PRE' || tag === 'CODE') ch = 'P';
        else if (/^\s*$/.test(el.textContent || '')) ch = ' ';
        const m = s.backgroundColor.match(/\d+/g);
        const lum = m && m.length >= 3 ? (Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114) : 255;
        row += lum < 60 ? '#' : lum < 160 ? '+' : ch;
      }
      map.push(row);
    }
    return map;
  }, [rx, ry, rw, rh]);
  console.log('\n像素地图(#=深底 +=中底 B=控件 T=表格 P=代码块 空=浅底):');
  pxMap.forEach((r, i) => console.log(String(i).padStart(3) + '|' + r));

  const tree = await p.evaluate(([rx, ry, rw, rh]) => {
    const cands = [...document.querySelectorAll('*')].filter((x) => {
      const t = x.innerText || '';
      return t.includes('设备列表') && t.includes('堡垒机') && t.includes('添加设备');
    });
    const root = cands.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    const out = [];
    const walk = (el, depth, seq) => {
      if (out.length > 160) return;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const visible = r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden';
      if (visible) {
        const text = (el.childElementCount === 0 ? (el.innerText || '').trim() : '').slice(0, 26);
        out.push({
          d: depth, s: seq,
          tag: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0].slice(0, 16) : ''),
          rect: [Math.round(r.x - rx), Math.round(r.y - ry), Math.round(r.width), Math.round(r.height)],
          bg: s.backgroundColor, fg: s.color, fs: s.fontSize, fw: s.fontWeight, br: s.borderRadius, op: s.opacity,
          text,
        });
      }
      let i = 0;
      for (const c of el.children) { if (out.length > 160) break; walk(c, depth + 1, seq + '.' + i); i++; }
    };
    walk(root, 0, 'R');
    return out;
  }, [rx, ry, rw, rh]);
  console.log('\n子树样式:');
  for (const t of tree) {
    console.log(`${String(t.d).padStart(2)} ${t.s.padEnd(9)} ${t.tag.padEnd(24)} [${t.rect}] bg=${t.bg} fg=${t.fg} fs=${t.fs} fw=${t.fw} br=${t.br} ${t.text ? '"' + t.text + '"' : ''}`);
  }
}

console.log('\n--- 错误 ---');
console.log(errs.join('\n') || '(无)');
await b.close();
