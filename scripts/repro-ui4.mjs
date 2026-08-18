// v4: 精确定位 800x800 面板 → 逐页签转储子树样式 + 像素地图；同时转储设置面板做对比
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

const findPanel = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((x) => {
    const r = x.getBoundingClientRect();
    return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3 && x.children.length >= 2;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
});

const dumpPanel = async (label) => {
  const rect = await findPanel();
  console.log(`\n########## ${label} panel rect=${JSON.stringify(rect)} ##########`);
  if (!rect) return;
  const [rx, ry, rw, rh] = rect;
  const pxMap = await p.evaluate(([rx, ry, rw, rh]) => {
    const map = [];
    for (let y = ry + 6; y < ry + rh; y += 12) {
      let row = '';
      for (let x = rx + 6; x < rx + rw; x += 12) {
        const el = document.elementFromPoint(x, y);
        if (!el) { row += '.'; continue; }
        const s = getComputedStyle(el);
        let ch = ' ';
        const tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') ch = 'B';
        else if (tag === 'TABLE' || tag === 'TD' || tag === 'TH') ch = 'T';
        else if (tag === 'PRE' || tag === 'CODE') ch = 'P';
        const m = s.backgroundColor.match(/\d+/g);
        const lum = m && m.length >= 3 ? (Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114) : 255;
        row += lum < 60 ? '#' : lum < 160 ? '+' : ch;
      }
      map.push(row);
    }
    return map;
  }, [rx, ry, rw, rh]);
  console.log('像素地图(#=深底 +=中底 B=控件 T=表格 P=代码块 空=浅底):');
  pxMap.forEach((r, i) => console.log(String(i).padStart(2) + '|' + r));

  const tree = await p.evaluate(([rx, ry, rw, rh]) => {
    const root = [...document.querySelectorAll('*')].find((x) => {
      const r = x.getBoundingClientRect();
      return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3 && x.children.length >= 2;
    });
    const out = [];
    const walk = (el, depth, seq) => {
      if (out.length > 200) return;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const visible = r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden';
      if (visible) {
        const text = (el.childElementCount === 0 ? (el.innerText || '').trim() : '').slice(0, 30).replace(/\s+/g, ' ');
        const cls = typeof el.className === 'string' ? el.className.split(' ').filter((c) => c && !/^_/.test(c) && !/^\d+$/.test(c)).slice(0, 2).join('.') : '';
        out.push({
          d: depth, s: seq,
          tag: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
          rect: [Math.round(r.x - rx), Math.round(r.y - ry), Math.round(r.width), Math.round(r.height)],
          bg: s.backgroundColor, fg: s.color, fs: s.fontSize, fw: s.fontWeight, br: s.borderRadius, bd: s.border, op: s.opacity,
          text,
        });
      }
      let i = 0;
      for (const c of el.children) { if (out.length > 200) break; walk(c, depth + 1, seq + '.' + i); i++; }
    };
    walk(root, 0, 'R');
    return out;
  }, [rx, ry, rw, rh]);
  console.log('子树样式:');
  for (const t of tree) {
    console.log(`${String(t.d).padStart(2)} ${t.s.padEnd(10)} ${t.tag.padEnd(20)} [${t.rect}] bg=${t.bg} fg=${t.fg} fs=${t.fs} fw=${t.fw} br=${t.br} bd=${t.bd.slice(0, 24)} ${t.text ? '"' + t.text + '"' : ''}`);
  }
};

// 设备面板
await p.locator('button:has-text("设备")').first().click();
await p.waitForTimeout(1500);
for (const tab of ['设备列表', '添加设备', '堡垒机', '快速执行', '操作记忆', 'AI 规则']) {
  const t = p.locator(`button:has-text("${tab}")`).first();
  if (await t.isVisible().catch(() => false)) {
    await t.click(); await p.waitForTimeout(700);
    await dumpPanel('设备-' + tab);
  }
}

// 关闭设备面板
await p.keyboard.press('Escape'); await p.waitForTimeout(600);
const st = p.locator('button:has-text("设置")').first();
if (await st.isVisible().catch(() => false)) { await st.click(); await p.waitForTimeout(1500); await dumpPanel('设置面板-默认'); }
await p.keyboard.press('Escape');

console.log('\n--- 错误 ---');
console.log(errs.join('\n') || '(无)');
await b.close();
