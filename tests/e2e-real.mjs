// Generazione REALE da foto (usa la quota GPU gratuita di Hugging Face del tuo IP!).
//   python3 -m http.server 8765  &&  node tests/e2e-real.mjs
//   BASE=https://brunoflor.github.io/nebula-quote/ SHOT=screenshot-foto.png node tests/e2e-real.mjs
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE || 'http://localhost:8765/';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (/foto→3D|error/i.test(m.text()) || m.type() === 'error') console.log(`  [${m.type()}] ${m.text()}`); });
await page.goto(BASE + '?mode=photo' + (process.env.TECH ? '&tech=' + process.env.TECH : ''), { waitUntil: 'networkidle0' });
const t0 = Date.now();
await page.click('#sample');
let last = '';
const iv = setInterval(async () => { try { const s = await page.$eval('#gen-status', e => e.textContent); if (s !== last) { last = s; console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s · ${s}`); } } catch {} }, 1000);
await page.waitForFunction(() => window.__nebulaLastGeneration, { timeout: 330000, polling: 500 });
clearInterval(iv);
const g = await page.evaluate(() => window.__nebulaLastGeneration);
const secs = (Date.now() - t0) / 1000;
console.log('Risultato:', JSON.stringify(g), `· totale ${secs.toFixed(1)} s`);
if (g.error) { await browser.close(); process.exit(2); }
const q = await page.evaluate(() => ({ size: document.querySelector('#s-size').textContent, vol: document.querySelector('#s-volume').textContent, total: document.querySelector('#q-total').textContent, meta: document.querySelector('#photo-meta').textContent }));
console.log('Preventivo:', q);
if (process.env.SHOT) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
  console.log('Screenshot:', process.env.SHOT);
}
await browser.close();
process.exit(errors.length ? 1 : 0);
