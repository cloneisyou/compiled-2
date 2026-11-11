import { chromium } from 'playwright';
const ts = process.argv.slice(2).map(Number);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto('http://127.0.0.1:4317/motion.html?capture=1'); await p.waitForFunction('window.READY');
for (const t of ts) { await p.evaluate((t) => window.seek(t), t); await p.waitForTimeout(60); await p.screenshot({ path: `work/still-${String(t).padStart(5, '0')}.jpg`, quality: 80, type: 'jpeg' }); }
await b.close();
