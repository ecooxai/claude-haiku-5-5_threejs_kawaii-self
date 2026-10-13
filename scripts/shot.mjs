// Capture the character from several views: xvfb-run -a node scripts/shot.mjs [port] [outDir]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const port = process.argv[2] || '8765';
const outDir = path.resolve(process.argv[3] || 'renders');
fs.mkdirSync(outDir, { recursive: true });
const views = (process.env.VIEWS || 'front,back,left,right').split(',');

const browser = await puppeteer.launch({
  executablePath: '/home/a/.local/archpkg/pacman/usr/bin/chromium',
  headless: false, // run under xvfb-run: headless mode has no WebGL2 here
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 720, height: 960, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/index.html?shot=1`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true || window.__error', { timeout: 120000 });
const err = await page.evaluate(() => window.__error); if (err) throw new Error(err);
for (const v of views) {
  const file = path.join(outDir, `view-${v}.png`);
  // software GL is occasionally flaky: retry when the frame comes out blank (tiny PNG)
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.evaluate((name) => window.__renderView(name), v);
    await page.screenshot({ path: file });
    if (fs.statSync(file).size > 20000) break;
    console.log('blank frame, retrying', v, attempt);
  }
  console.log('saved', file);
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
