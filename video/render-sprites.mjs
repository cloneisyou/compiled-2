// Renders the output-space overlay sprites (tab keycap up/down) and the end card with headless Chromium.
// Returns raw pixel buffers: sprites as straight-alpha RGBA, end card as RGB24 at W x H.
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const EXE = process.env.CHROME_EXE || path.join(os.homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');

function decodePng(buf, w, h, pix) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'png_pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', pix, '-'], { input: buf, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error('png decode failed ' + r.stderr);
  const need = w * h * (pix === 'rgba' ? 4 : 3);
  if (r.stdout.length !== need) throw new Error(`png decode size ${r.stdout.length} != ${need}`);
  return r.stdout;
}

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
// Keycap at output pixels (2560x1440 frame); visible cap is CAP_W x CAP_H, PAD for the soft shadow.
const CAP_W = 150, CAP_H = 100, PAD = 24;
const capHtml = (down) => `<!doctype html><html><head><style>
html,body{margin:0;background:transparent}
.wrap{padding:${PAD}px;display:inline-block}
.cap{box-sizing:border-box;width:${CAP_W}px;height:${CAP_H}px;border-radius:20px;position:relative;font-family:${FONT};
  background:${down ? 'linear-gradient(#cfe5fb,#bcdcfa)' : 'linear-gradient(#f4f9ff,#e3f0fd)'};
  border:2.5px solid ${down ? '#5aa9ee' : '#9fcbf3'};
  box-shadow:0 ${down ? 2 : 5}px ${down ? 8 : 16}px rgba(20,100,180,${down ? 0.18 : 0.14}), inset 0 -${down ? 1 : 3}px 0 rgba(90,160,230,.25);}
.arr{position:absolute;left:17px;top:10px;font-size:32px;line-height:1;color:#1d8ae8;font-weight:500}
.lbl{position:absolute;left:18px;bottom:12px;font-size:28px;line-height:1;color:#1d8ae8;font-weight:500;letter-spacing:.2px}
</style></head><body><div class="wrap" id="w"><div class="cap"><div class="arr">&#8594;</div><div class="lbl">tab</div></div></div></body></html>`;

const endHtml = (W, H, title) => `<!doctype html><html><head><style>
html,body{margin:0;width:${W}px;height:${H}px;background:#fff;overflow:hidden}
.c{position:absolute;left:0;top:0;width:${W}px;height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center}
svg{width:${Math.round(W * 0.15)}px;height:auto;margin-top:-30px}
.t{margin-top:${Math.round(H * 0.045)}px;font-family:${FONT};font-weight:700;font-size:${Math.round(H * 0.058)}px;color:#111;letter-spacing:-1px}
</style></head><body><div class="c">
<svg viewBox="0 0 170 150" xmlns="http://www.w3.org/2000/svg"><defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22a6f5"/><stop offset="1" stop-color="#0a84ff"/></linearGradient></defs>
<g fill="url(#g)" stroke="url(#g)" stroke-width="9" stroke-linejoin="round">
<path d="M8 8 L76 75 L8 142 L8 108 L42 75 L8 42 Z"/><path d="M78 8 L146 75 L78 142 L78 108 L112 75 L78 42 Z"/></g></svg>
<div class="t">${title}</div></div></body></html>`;

export async function renderSprites({ W, H, title }) {
  const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
    const caps = [];
    for (const down of [false, true]) {
      await page.setContent(capHtml(down));
      await page.evaluate(() => document.fonts.ready);
      const el = await page.$('#w');
      const bb = await el.boundingBox();
      const w = Math.round(bb.width), h = Math.round(bb.height);
      const png = await page.screenshot({ clip: { x: bb.x, y: bb.y, width: w, height: h }, omitBackground: true });
      caps.push({ w, h, vw: CAP_W, vh: CAP_H, data: decodePng(png, w, h, 'rgba') });
    }
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(endHtml(W, H, title));
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
    return { cap: caps[0], capDown: caps[1], endCard: decodePng(png, W, H, 'rgb24') };
  } finally {
    await browser.close();
  }
}
