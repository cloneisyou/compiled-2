#!/usr/bin/env node
// Deterministic frame-by-frame capturer + encoder for a seekable motion-graphics page.
// Usage: node capture-mg.mjs [--url U] [--fps 30] [--workers 4] [--from s] [--to s]
//          [--out file.mp4] [--audio file.wav] [--frames-dir dir] [--format jpeg|png]
//          [--force] [--no-encode]
// Page contract: window.DURATION (s), window.seek(t) (may return a promise), window.READY === true.
import { chromium } from 'playwright';
import ffmpeg from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

const url = opt('url', 'http://127.0.0.1:4317/motion.html?capture=1');
const fps = Number(opt('fps', 30));
const workers = Math.max(1, Number(opt('workers', 4)));
const from = opt('from') !== undefined ? Number(opt('from')) : null;
const to = opt('to') !== undefined ? Number(opt('to')) : null;
const out = path.resolve(opt('out', path.join(here, 'clone-team-rooms-demo.mp4')));
const audio = opt('audio') ? path.resolve(opt('audio')) : null;
const framesDir = path.resolve(opt('frames-dir', path.join(here, 'work', 'mg')));
const format = opt('format', 'jpeg');
const ext = format === 'png' ? 'png' : 'jpg';
const ranged = from !== null || to !== null;
const force = flag('force') || ranged; // a --from/--to run always overwrites its range
const W = 1280, H = 720, DSF = 2;

const t0 = Date.now();
const framePath = (i) => path.join(framesDir, `${String(i).padStart(6, '0')}.${ext}`);
await mkdir(framesDir, { recursive: true });
await mkdir(path.dirname(out), { recursive: true });

async function openPage() {
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.READY === true && typeof window.seek === 'function' && window.DURATION > 0, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  return { browser, page };
}

const first = await openPage();
const duration = await first.page.evaluate(() => window.DURATION);
const total = Math.round(duration * fps);
const a = Math.max(0, Math.min(total, from !== null ? Math.round(from * fps) : 0));
const b = Math.max(a, Math.min(total, to !== null ? Math.round(to * fps) : total));
const have = new Set(await readdir(framesDir));
const todo = [];
for (let i = a; i < b; i++) if (force || !have.has(path.basename(framePath(i)))) todo.push(i);
console.log(`page duration ${duration}s -> ${total} frames @ ${fps} fps; range [${a}, ${b}); rendering ${todo.length} (${b - a - todo.length} cached), ${workers} workers, ${format}`);

let next = 0, done = 0;
const tCap = Date.now();
async function work(w, pre) {
  if (next >= todo.length) { if (pre) await pre.browser.close(); return; }
  const { browser, page } = pre ?? (await openPage());
  try {
    while (next < todo.length) {
      const i = todo[next++]; // shared queue => interleaved shares
      await page.evaluate((t) => window.seek(t), i / fps);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const buf = await page.screenshot(format === 'png' ? { type: 'png' } : { type: 'jpeg', quality: 95 });
      const tmp = `${framePath(i)}.w${w}.tmp`;
      await writeFile(tmp, buf);
      await rename(tmp, framePath(i)); // atomic: an interrupted run never leaves a partial frame
      if (++done % 100 === 0 || done === todo.length) {
        const el = (Date.now() - tCap) / 1000;
        console.log(`  ${done}/${todo.length} frames  ${(el / done).toFixed(3)} s/frame  eta ${((todo.length - done) * el / done).toFixed(0)}s`);
      }
    }
  } finally { await browser.close(); }
}
await Promise.all(Array.from({ length: workers }, (_, w) => work(w, w === 0 ? first : null)));
const capSec = (Date.now() - tCap) / 1000;
if (todo.length) console.log(`captured ${todo.length} frames in ${capSec.toFixed(1)}s (${(capSec / todo.length).toFixed(3)} s/frame wall)`);

if (flag('no-encode')) { console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s (no encode)`); process.exit(0); }

// Encode the full timeline when every frame exists; otherwise just the rendered range.
let s = 0, n = total;
for (let i = 0; i < total; i++) if (!existsSync(framePath(i))) { s = a; n = b - a; console.warn(`frame ${i} missing: encoding only the range [${a}, ${b})`); break; }
if (n <= 0) { console.error('nothing to encode'); process.exit(1); }
const vdur = n / fps;
const vf = [
  `scale=${W * DSF}:${H * DSF}:flags=lanczos:${ext === 'jpg' ? 'in_color_matrix=bt601:in_range=pc:' : ''}out_color_matrix=bt709:out_range=tv`,
  'format=yuv420p',
  'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv',
].join(',');
const args = ['-y', '-hide_banner', '-loglevel', 'error', '-stats',
  '-framerate', String(fps), '-start_number', String(s), '-i', path.join(framesDir, `%06d.${ext}`)];
if (audio) args.push('-i', audio);
args.push('-frames:v', String(n), '-map', '0:v:0', '-vf', vf,
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p',
  '-r', String(fps), '-fps_mode', 'cfr',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
if (audio) {
  const fd = Math.min(1.5, vdur);
  args.push('-map', '1:a:0',
    '-af', `aresample=48000,apad,atrim=0:${vdur.toFixed(6)},afade=t=out:st=${(vdur - fd).toFixed(6)}:d=${fd}`,
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', vdur.toFixed(6));
}
args.push('-movflags', '+faststart', out);
const tEnc = Date.now();
await new Promise((res, rej) => {
  const p = spawn(ffmpeg, args, { stdio: 'inherit' });
  p.on('error', rej);
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))));
});
console.log(`encoded ${out} in ${((Date.now() - tEnc) / 1000).toFixed(1)}s`);
console.log(`frames ${n}  duration ${vdur.toFixed(3)}s  elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
