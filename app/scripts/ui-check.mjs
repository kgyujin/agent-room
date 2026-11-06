// Screen check without a Mac: builds nothing, serves dist/ with `vite preview`, opens the browser
// preview (demo data) and fails when a view breaks: a page error, a dashboard that needs a page
// scroll at a laptop size, or a room without name tags. Run `npm run build` first.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const url = `http://localhost:${PORT}/?hour=13`;
const fails = [];

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const cases = [
  { view: 'off', w: 1280, h: 800 },
  { view: 'split', w: 1440, h: 900 },
  { view: 'full', w: 1280, h: 800 },
  { view: 'full', w: 1100, h: 720 },
];

try {
  await waitForServer();
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((v) => { try { localStorage.setItem('dashView', v); } catch { /* none */ } }, c.view);
    await page.goto(url);
    await page.waitForTimeout(4000);
    const tag = `${c.view} ${c.w}x${c.h}`;
    if (errors.length) fails.push(`${tag}: page error ${errors[0]}`);
    const r = await page.evaluate(() => {
      const one = document.querySelector('.dp-one');
      return { dash: !!one, scroll: one ? one.scrollHeight - one.clientHeight : 0, tags: document.querySelectorAll('.nametag').length };
    });
    if (c.view !== 'off' && !r.dash) fails.push(`${tag}: dashboard missing`);
    if (c.view !== 'off' && r.scroll > 1) fails.push(`${tag}: dashboard scrolls by ${r.scroll}px`);
    if (c.view !== 'full' && r.tags === 0) fails.push(`${tag}: no name tags in the room`);
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}

if (fails.length) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log(`ui-check: ${cases.length} views ok`);
