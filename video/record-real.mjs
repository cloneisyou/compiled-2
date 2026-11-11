// Records the real app with two teammates side by side (Min left, Jun right), live model calls.
// Output: video/work/real.webm + real-markers.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.argv[2] || 'http://127.0.0.1:4317';
const WORK = path.join(path.dirname(new URL(import.meta.url).pathname), 'work');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fetch(`${BASE}/api/reset`, { method: 'POST' });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, recordVideo: { dir: WORK, size: { width: 2560, height: 1440 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (k) => (marks[k] = +((Date.now() - t0) / 1000).toFixed(3));
const room = async () => (await fetch(`${BASE}/api/room`)).json();
await page.goto(`${BASE}/stage.html`);
const min = page.frameLocator('#min'), jun = page.frameLocator('#jun');
await min.locator('.doc h2').waitFor(); await jun.locator('#input').waitFor();
for (const f of page.frames()) if (f !== page.mainFrame()) await f.addStyleTag({ content: '.rcursor:not(#cur-self){display:none}' });
let m = { x: 900, y: 500 };
async function moveTo(x, y, ms = 900) {
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) { const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await page.mouse.move(m.x + (x - m.x) * e, m.y + (y - m.y) * e); await sleep(16); }
  m = { x, y };
}
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function say(text) {
  const input = min.locator('#input'); const c = await center(input);
  await moveTo(c.x - 200, c.y, 800); await page.mouse.click(c.x - 200, c.y);
  const before = (await room()).messages.filter((x) => x.kind === 'ai').length;
  await input.pressSequentially(text, { delay: 28 }); await sleep(300); await input.press('Enter');
  for (;;) { const r = await room(); if (r.messages.filter((x) => x.kind === 'ai').length > before && r.busy === 0) break; await sleep(150); }
}
await sleep(1500);
await say('@Sara should tonight’s demo open with a purple gradient hero?');
mark('answer'); await sleep(6500);
await say('Let’s ship tonight without the end-to-end test.');
mark('proposal'); await sleep(2500);
const approve = jun.locator('.proposal.waiting button[data-vote="1"]').last();
await approve.scrollIntoViewIfNeeded(); await sleep(400);
const c = await center(approve);
await moveTo(c.x, c.y, 1300); await sleep(500);
await page.mouse.click(c.x, c.y); mark('click');
await sleep(5000);
const r = await room();
const video = page.video(); await ctx.close(); await browser.close();
fs.renameSync(await video.path(), path.join(WORK, 'real.webm'));
fs.writeFileSync(path.join(WORK, 'real-markers.json'), JSON.stringify(marks));
console.log(JSON.stringify({ marks, proposals: r.proposals.map((p) => [p.title, p.status, Object.fromEntries(Object.entries(p.votes).map(([k, v]) => [k, v.accept]))]), learned: r.members.map((x) => x.learned.length) }));
