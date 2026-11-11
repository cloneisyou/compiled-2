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
await sleep(1200);
// 1) Min picks whose Clone predicts the next prompt: Clone Jun
let c0 = await center(min.locator('#author'));
await moveTo(c0.x, c0.y, 900); await page.mouse.click(c0.x, c0.y); await sleep(700);
c0 = await center(min.locator('#cloneMenu button[data-clone="jun"]'));
await moveTo(c0.x - 30, c0.y, 600); await sleep(300); await page.mouse.click(c0.x - 30, c0.y); mark('pick');
for (;;) { const r = await room(); if (r.suggestions?.jun && !r.predicting) break; await sleep(150); }
await min.locator('#ghost .tabhint').waitFor(); mark('ghost');
await min.locator('#input').focus();
await sleep(1500);
let before = (await room()).messages.filter((x) => x.kind === 'ai').length;
await min.locator('#input').press('Tab'); mark('tab1'); await sleep(700);
await min.locator('#input').press('Tab'); mark('tab2');
for (;;) { const r = await room(); if (r.messages.filter((x) => x.kind === 'ai').length > before && r.busy === 0) break; await sleep(150); }
mark('sent_done'); await sleep(4500);
// 2) Jun steers the same session from his own window
const ji = jun.locator('#input'); c0 = await center(ji);
await moveTo(c0.x - 150, c0.y, 1100); await page.mouse.click(c0.x - 150, c0.y);
before = (await room()).messages.filter((x) => x.kind === 'ai').length;
mark('steer_type');
await ji.pressSequentially('Keep it to one flow: join, ask, approve. Ten minutes max.', { delay: 30 }); await sleep(300); await ji.press('Enter'); mark('steer_sent');
for (;;) { const r = await room(); if (r.messages.filter((x) => x.kind === 'ai').length > before && r.busy === 0) break; await sleep(150); }
mark('steer_done'); await sleep(4000);
// 3) Risky call: only Jun is asked
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
console.log(JSON.stringify({ marks, msgs: r.messages.slice(1).map((x) => [x.kind, x.author, x.viaClone || '', x.text]), proposals: r.proposals.map((p) => [p.title, p.status, Object.fromEntries(Object.entries(p.votes).map(([k, v]) => [k, [v.accept, v.source, v.reason]]))]), learned: r.members.map((x) => x.learned.length) }));
