// Records the 90-second demo against a live server (real model calls).
// Usage: node video/record.mjs [baseUrl]  -> video/work/raw.webm + markers.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4317';
const WORK = path.join(path.dirname(new URL(import.meta.url).pathname), 'work');
fs.mkdirSync(WORK, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fetch(`${BASE}/api/reset`, { method: 'POST' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: WORK, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
const t0 = Date.now();
const markers = [];
const mark = (type, extra = {}) => markers.push({ type, t: (Date.now() - t0) / 1000, ...extra });

await page.goto(`${BASE}/stage.html`);
await page.evaluate(() => window.card('<div><div class="logo">C</div><h1>AI is single-player.</h1><p>Your team isn’t.</p></div>'));
mark('start');
await page.waitForTimeout(1500);
const min = page.frameLocator('#min');
const jun = page.frameLocator('#jun');
await min.locator('.member').first().waitFor();
await jun.locator('.msg').first().waitFor();

async function pointAt(locator) {
  const b = await locator.boundingBox();
  await page.evaluate(([x, y]) => window.pointTo(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(1000);
}
async function aiCount() {
  const r = await (await fetch(`${BASE}/api/room`)).json();
  return { ai: r.messages.filter((m) => m.kind === 'ai').length, busy: r.busy };
}
async function say(text) {
  const input = min.locator('#input');
  await pointAt(input);
  await input.click();
  const before = (await aiCount()).ai;
  await input.pressSequentially(text, { delay: 28 });
  await sleep(350);
  await input.press('Enter');
  await sleep(1800);
  mark('wait_start');
  for (;;) {
    const c = await aiCount();
    if (c.ai > before && c.busy === 0) break;
    await sleep(250);
  }
  await sleep(500);
  mark('wait_end');
}
const caption = (html) => page.evaluate((h) => window.caption(h), html);

await sleep(1800);
await page.evaluate(() => window.card('<div><div class="logo">C</div><h1>Clone Team Rooms</h1><p>Multiplayer AI for teams — every teammate is always in the room.</p></div>'));
await sleep(3800);
await page.evaluate(() => window.card(''));
await caption('Min and Jun are online. Sara is away, so <em>Clone Sara</em> stands in for her.');
await sleep(5500);

await caption('Ask a teammate who’s away. <em>Their Clone</em> answers in their voice.');
await say('@Sara should tonight’s demo open with a purple gradient hero?');
await sleep(7000);

await caption('Propose anything. Every Clone predicts how <em>its human</em> would vote.');
await say("Let's freeze scope now and spend the last hour on the end-to-end test and a 30-second onboarding.");
await caption('All Clones say yes → <em>Team Clone Mode</em> ships it into the team plan. No meeting.');
await sleep(8500);

await caption('Risky call? Only the person who would disagree gets pinged.');
await say('We’re out of time — let’s ship the demo build tonight without the end-to-end test.');
await sleep(6500);

await caption('Jun makes an exception for a hackathon demo. <em>Clone Jun learns it</em> for next time.');
const approve = jun.locator('.proposal.waiting button[data-vote="1"]').last();
await approve.scrollIntoViewIfNeeded();
await pointAt(approve);
await approve.click();
mark('jun_click');
await sleep(7500);

await caption('');
await page.evaluate(() =>
  window.card(
    '<div><div class="logo">C</div><h1>Clone Team Rooms</h1><p>Humans and their Clones, deciding together in realtime.</p><small>Built tonight at c0mpiled Taipei on Clone’s Team workspace · github.com/cloneisyou/compiled-2</small></div>',
  ),
);
await sleep(5000);
mark('end');

const video = page.video();
await context.close();
await browser.close();
fs.renameSync(await video.path(), path.join(WORK, 'raw.webm'));
fs.writeFileSync(path.join(WORK, 'markers.json'), JSON.stringify(markers, null, 2));
console.log(JSON.stringify(markers));
