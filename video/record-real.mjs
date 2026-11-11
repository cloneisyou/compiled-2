// Records the real app with two teammates side by side (Min left, Jun right), live model calls.
// Flow: Min picks Clone Jun to write the next prompt -> Tab, Tab -> Jun steers -> Jun takes over.
// Output: video/work/real.webm + real-markers.json + real-take.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const BASE = process.argv[2] || 'http://127.0.0.1:4317';
const WORK = path.join(path.dirname(new URL(import.meta.url).pathname), 'work');
fs.mkdirSync(WORK, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await fetch(`${BASE}/api/reset`, { method: 'POST' });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, recordVideo: { dir: WORK, size: { width: 2560, height: 1440 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (k) => (marks[k] = +((Date.now() - t0) / 1000).toFixed(3));
const room = async () => (await fetch(`${BASE}/api/room`)).json();
const aiCount = async () => (await room()).messages.filter((x) => x.kind === 'ai').length;
async function waitAi(before) {
  for (;;) {
    const r = await room();
    if (r.messages.filter((x) => x.kind === 'ai').length > before && r.busy === 0) break;
    await sleep(150);
  }
}
await page.goto(`${BASE}/stage.html`);
const min = page.frameLocator('#min'), jun = page.frameLocator('#jun');
await min.locator('.doc h2').waitFor();
await jun.locator('#input').waitFor();
for (const f of page.frames()) if (f !== page.mainFrame()) await f.addStyleTag({ content: '.rcursor:not(#cur-self){display:none}' });
let m = { x: 900, y: 500 };
async function moveTo(x, y, ms = 900) {
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await page.mouse.move(m.x + (x - m.x) * e, m.y + (y - m.y) * e);
    await sleep(16);
  }
  m = { x, y };
}
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

await sleep(1200);
// 1) Min picks whose Clone writes the next prompt: Clone Jun. Tab accepts, Tab sends.
let c = await center(min.locator('#author'));
await moveTo(c.x, c.y, 900); await page.mouse.click(c.x, c.y); await sleep(700);
c = await center(min.locator('#cloneMenu button[data-clone="jun"]'));
await moveTo(c.x - 30, c.y, 600); await sleep(300); await page.mouse.click(c.x - 30, c.y); mark('pick');
for (;;) { const r = await room(); if (r.suggestions?.jun && !r.predicting) break; await sleep(150); }
await min.locator('#ghost .tabhint').waitFor(); mark('ghost');
await min.locator('#input').focus();
await sleep(1500);
let before = await aiCount();
await min.locator('#input').press('Tab'); mark('tab1'); await sleep(700);
await min.locator('#input').press('Tab'); mark('tab2');
await waitAi(before); mark('sent_done');
await sleep(4500);
// 2) Jun steers the same session from his own window.
const ji = jun.locator('#input'); c = await center(ji);
await moveTo(c.x - 150, c.y, 1100); await page.mouse.click(c.x - 150, c.y);
before = await aiCount(); mark('steer_type');
await ji.pressSequentially('Keep it to one flow: join, ask, approve. Ten minutes max.', { delay: 30 });
await sleep(300); await ji.press('Enter'); mark('steer_sent');
await waitAi(before); mark('steer_done');
await sleep(4000);
// 3) Jun takes the session over; the Team AI briefs him.
const to = jun.locator('#takeover'); c = await center(to);
await moveTo(c.x, c.y, 1300); await sleep(500);
before = await aiCount();
await page.mouse.click(c.x, c.y); mark('takeover');
await waitAi(before); mark('handoff_done');
await sleep(4500);

const r = await room();
const video = page.video();
await ctx.close(); await browser.close();
fs.renameSync(await video.path(), path.join(WORK, 'real.webm'));
fs.writeFileSync(path.join(WORK, 'real-markers.json'), JSON.stringify(marks));
const take = { marks, driver: r.driver, msgs: r.messages.slice(1).map((x) => ({ kind: x.kind, author: x.author, via: x.viaClone || null, handoff: x.handoff || null, text: x.text })), plan: r.plan.map((p) => ({ text: p.text, by: p.by || null, via: p.via || null })) };
fs.writeFileSync(path.join(WORK, 'real-take.json'), JSON.stringify(take, null, 2));
console.log(JSON.stringify(take));
