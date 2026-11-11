// Records the product demo against the live server (real model calls).
// Min's window is recorded; Jun is a second real client whose live cursor and
// vote show up in Min's window. Output: video/work/raw.webm + markers.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4317';
const WORK = path.join(path.dirname(new URL(import.meta.url).pathname), 'work');
fs.mkdirSync(WORK, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 1280, height: 720 };

await fetch(`${BASE}/api/reset`, { method: 'POST' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2, recordVideo: { dir: WORK, size: { width: 2560, height: 1440 } } });
const junCtx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const t0 = Date.now();
const markers = [];
const mark = (type, extra = {}) => markers.push({ type, t: +((Date.now() - t0) / 1000).toFixed(3), ...extra });
const room = async () => (await fetch(`${BASE}/api/room`)).json();

let mouse = { x: 640, y: 380 };
async function moveTo(p, x, y, ms = 900) {
  const from = p === page ? mouse : p._m || { x: 900, y: 300 };
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await p.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(16);
  }
  if (p === page) mouse = { x, y };
  else p._m = { x, y };
}
async function center(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function zoomOn(loc, scale = 1.7, dy = 0) {
  const { x, y } = await center(loc);
  const w = VP.width / scale;
  const h = VP.height / scale;
  const zx = Math.min(Math.max(0, x - w / 2), VP.width - w);
  const zy = Math.min(Math.max(0, y + dy - h / 2), VP.height - h);
  mark('zoom', { x: Math.round(zx * 2), y: Math.round(zy * 2), w: Math.round(w * 2), h: Math.round(h * 2), dur: 1.2 });
}
async function waitAi(before) {
  mark('wait_start');
  for (;;) {
    const r = await room();
    if (r.messages.filter((m) => m.kind === 'ai').length > before && r.busy === 0) break;
    await sleep(200);
  }
  await sleep(450);
  mark('wait_end');
}
const aiCount = async () => (await room()).messages.filter((m) => m.kind === 'ai').length;

// S1 — personal workspace → team workspace
await page.goto(`${BASE}/?as=min&pointer=1`);
await page.locator('.empty').waitFor();
await page.mouse.move(mouse.x, mouse.y);
await sleep(1200);
mark('scene:S1');
await sleep(900);
let c = await center(page.locator('#account'));
await moveTo(page, c.x - 30, c.y, 1000);
await page.mouse.click(c.x - 30, c.y);
await sleep(700);
c = await center(page.locator('#wsTeam'));
await moveTo(page, c.x - 40, c.y, 600);
await sleep(350);
await page.mouse.click(c.x - 40, c.y);
await sleep(2600);

// S2 — Jun joins live
mark('scene:S2');
const jun = await junCtx.newPage();
await jun.goto(`${BASE}/?as=jun&ws=team`);
await jun.locator('.doc h2').waitFor();
await jun.mouse.move(1150, 60);
jun._m = { x: 1150, y: 60 };
await sleep(600);
await zoomOn(page.locator('#presence'), 2.2, 110);
await moveTo(jun, 1010, 250, 1200);
await sleep(1500);
mark('unzoom');
await moveTo(jun, 1000, 330, 900);
await moveTo(jun, 760, 420, 1000);
await sleep(2400);

// S3 — ask Sara, who is away; her Clone answers
mark('scene:S3');
const input = page.locator('#input');
c = await center(input);
await moveTo(page, c.x - 120, c.y, 900);
await page.mouse.click(c.x - 120, c.y);
let before = await aiCount();
await input.pressSequentially('@Sara should tonight’s demo open with a purple gradient hero?', { delay: 32 });
await sleep(400);
await input.press('Enter');
await moveTo(jun, 520, 300, 900);
await sleep(900);
await waitAi(before);
await zoomOn(page.locator('.msg.clone').last(), 1.6, 20);
await sleep(5200);
mark('unzoom');
await sleep(1300);

// S4 — Clone predicts Min's next prompt: Tab, Tab
mark('scene:S4');
await page.locator('#ghost .tabhint').waitFor();
await zoomOn(page.locator('#composer'), 1.75, -10);
await sleep(3600);
before = await aiCount();
mark('key:tab');
await input.press('Tab');
await sleep(750);
mark('key:tab');
await input.press('Tab');
await sleep(1500);
mark('unzoom');
await sleep(800);
await waitAi(before);

// S5 — every Clone predicts its human's vote → auto-approved
mark('scene:S5');
await sleep(600);
await zoomOn(page.locator('.proposal').last(), 1.55, 0);
await sleep(6500);
mark('unzoom');
await moveTo(jun, 1040, 470, 1000);
await sleep(4200);

// S5b — fun fact
mark('scene:S5b');
await page.goto(`${BASE}/benchmark.html`);
await sleep(6800);
await page.goto(`${BASE}/?as=min&ws=team&pointer=1`);
await page.locator('.proposal').last().waitFor();
await page.mouse.move(mouse.x, mouse.y);
await sleep(500);

// S6 — risky call: only Jun is asked; he overrides his Clone, and it learns
mark('scene:S6');
c = await center(input);
await moveTo(page, c.x - 120, c.y, 800);
await page.mouse.click(c.x - 120, c.y);
before = await aiCount();
await input.pressSequentially('We’re out of time — let’s ship tonight without the end-to-end test.', { delay: 30 });
await sleep(350);
await input.press('Enter');
await sleep(900);
await waitAi(before);
await sleep(700);
await zoomOn(page.locator('.proposal').last(), 1.45, 10);
await sleep(3800);
const approve = jun.locator('.proposal.waiting button[data-vote="1"]').last();
await approve.scrollIntoViewIfNeeded();
c = await center(approve);
await moveTo(jun, c.x, c.y, 1400);
await sleep(700);
await jun.mouse.click(c.x, c.y);
mark('jun_click');
await sleep(4200);
mark('unzoom');
await sleep(4500);
mark('scene:S7');
await sleep(600);
mark('end');

const r = await room();
const video = page.video();
await ctx.close();
await junCtx.close();
await browser.close();
fs.renameSync(await video.path(), path.join(WORK, 'raw.webm'));
fs.writeFileSync(path.join(WORK, 'markers.json'), JSON.stringify(markers, null, 2));
console.log(JSON.stringify({ proposals: r.proposals.map((p) => [p.title, p.status, p.auto, Object.fromEntries(Object.entries(p.votes).map(([k, v]) => [k, v.accept]))]), kinds: r.messages.map((m) => m.kind).join(',') }));
