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
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
for (const v of views) {
  await page.evaluate((name) => window.__renderView(name), v);
  const file = path.join(outDir, `view-${v}.png`);
  await page.screenshot({ path: file });
  console.log('saved', file);
}
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
