// v5: PNG 解码取真实像素 → 面板区域亮度图 + 面板子树文本样式
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// ---------- 极简 PNG 解码（8bit, colortype 2/6） ----------
function decodePng(buf) {
  let off = 8; // 跳过签名
  let w = 0, h = 0, colortype = 0, bitdepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitdepth = data[8]; colortype = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colortype === 6 ? 4 : colortype === 2 ? 3 : 0;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const bpx = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + bpx) & 255;
      else if (filter === 3) v = (v + ((a + bpx) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + bpx - c, pa = Math.abs(p - a), pb = Math.abs(p - bpx), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bpx : c;
        v = (v + pr) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, bpp, data: out };
}
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---------- 启动浏览器 ----------
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

// 打开设备面板（轮询等待 800x800 面板出现，动画期间 rect 会变）
await p.locator('button:has-text("设备")').first().click();
let panelRect = null;
for (let i = 0; i < 30 && !panelRect; i++) {
  await p.waitForTimeout(200);
  panelRect = await p.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((x) => {
      const r = x.getBoundingClientRect();
      return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3 && x.children.length >= 1;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}
console.log('设备面板 rect:', JSON.stringify(panelRect));

const tabNames = ['设备列表', '添加设备', '堡垒机', '快速执行', '操作记忆', 'AI 规则'];
for (const tab of tabNames) {
  const t = p.locator(`button:has-text("${tab}")`).first();
  if (!(await t.isVisible().catch(() => false))) { console.log(`\n=== ${tab}: 页签不可见 ===`); continue; }
  await t.click(); await p.waitForTimeout(800);
  const shot = await p.screenshot({ path: `/tmp/dev-${tab}.png` });
  const img = decodePng(shot);
  console.log(`\n========== ${tab} (png ${img.w}x${img.h} bpp=${img.bpp}) ==========`);
  const pr = panelRect || { x: 320, y: 50, w: 800, h: 800 };
  // 采样面板区域真实像素
  for (let y = pr.y + 5; y < pr.y + pr.h; y += 10) {
    let row = '';
    for (let x = pr.x + 5; x < pr.x + pr.w; x += 10) {
      const px = (y * img.w + x) * img.bpp;
      const r = img.data[px], g = img.data[px + 1], bl = img.data[px + 2];
      const a = img.bpp === 4 ? img.data[px + 3] : 255;
      const l = lum(r, g, bl);
      row += a < 128 ? ' ' : l < 60 ? '#' : l < 150 ? '+' : l < 220 ? '-' : ' ';
    }
    console.log(String(Math.round((y - pr.y) / 10)).padStart(2) + '|' + row);
  }
  // 面板内可见叶子文本及其真实对比度
  const texts = await p.evaluate(([rx, ry, rw, rh]) => {
    const root = [...document.querySelectorAll('*')].find((x) => {
      const r = x.getBoundingClientRect();
      return Math.abs(r.width - 800) < 3 && Math.abs(r.height - 800) < 3 && x.children.length >= 1;
    });
    if (!root) return [];
    const out = [];
    const walk = (el) => {
      for (const c of el.children) walk(c);
      if (el.childElementCount > 0) return;
      const text = (el.innerText || '').trim();
      if (!text || text.length > 40) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const s = getComputedStyle(el);
      out.push({ text: text.slice(0, 20), rect: [Math.round(r.x - rx), Math.round(r.y - ry), Math.round(r.width), Math.round(r.height)], fg: s.color, bg: s.backgroundColor, fs: s.fontSize, fw: s.fontWeight });
    };
    walk(root);
    return out.slice(0, 60);
  }, [pr.x, pr.y, pr.w, pr.h]);
  console.log('--- 叶子文本(样式) ---');
  for (const t of texts) console.log(JSON.stringify(t));
}

console.log('\n--- 错误 ---');
console.log(errs.join('\n') || '(无)');
await b.close();
