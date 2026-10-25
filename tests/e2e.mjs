// Test end-to-end nel browser (opzionale): richiede `npm i puppeteer-core` e Chrome.
//   python3 -m http.server 8765  &&  node tests/e2e.mjs
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE || 'http://localhost:8765/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function open(width, height, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => errors.push(`[requestfailed] ${r.url()}`));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  return page;
}
const page = await open(1440, 1000);
// carica l'esempio con il pulsante
await page.click('#sample');
await page.waitForFunction(() => window.__nebula.state.stats && !document.querySelector('#request').disabled);
const read = () => page.evaluate(() => ({
  file: document.querySelector('#filename').textContent,
  size: document.querySelector('#s-size').textContent, vol: document.querySelector('#s-volume').textContent,
  total: document.querySelector('#q-total').textContent, weight: document.querySelector('#q-weight').textContent, time: document.querySelector('#q-time').textContent,
}));
console.log('Esempio vaso:', await read());
// cubo 20 mm
await page.click('#sample2');
await page.waitForFunction(() => window.__nebula.state.fileName.includes('cubo'));
const cube = await read(); console.log('Esempio cubo:', cube);
if (!cube.vol.startsWith('8,00')) throw new Error('Volume cubo errato: ' + cube.vol);
// cambia impostazioni
await page.click('#materials button[data-id="PETG"]');
await page.select('#layer', '0.12');
await page.click('.stepper button[data-step="1"]');
console.log('Cubo PETG 0.12 ×2:', await read());
// upload file reale tramite input
const input = await page.$('#file2');
await input.uploadFile(new URL('../samples/vaso-nebula.stl', import.meta.url).pathname);
await page.waitForFunction(() => window.__nebula.state.fileName === 'vaso-nebula.stl');
await page.click('#materials button[data-id="PLA"]'); await page.select('#layer', '0.2');
await page.evaluate(() => { const q = document.querySelector('#quantity'); q.value = 1; q.dispatchEvent(new Event('input')); });
// dialog richiesta
await page.click('#request');
const summary = await page.$eval('#summary', t => t.value);
const mail = await page.$eval('#send-mail', a => a.href);
console.log('Riepilogo:\n' + summary); console.log('mailto ok:', mail.startsWith('mailto:'));
await page.keyboard.press('Escape');
await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: new URL('../screenshot.png', import.meta.url).pathname, fullPage: true });
// pezzo troppo grande: unità in cm → vaso ×10
await page.select('#unit', 'cm');
await page.waitForFunction(() => document.querySelector('#warnings .alert.error'));
console.log('Avviso fuori volume:', await page.$eval('#warnings .alert.error', e => e.textContent.trim().slice(0, 80) + '…'));
// mobile
const m = await open(390, 844, true);
await m.click('#sample'); await m.waitForFunction(() => window.__nebula.state.stats);
await new Promise(r => setTimeout(r, 1500));
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
await m.screenshot({ path: '/tmp/nq/mobile.png', fullPage: true });
console.log('Mobile overflow orizzontale:', overflow);
await browser.close();
console.log(errors.length ? 'ERRORI:\n' + errors.join('\n') : 'Nessun errore in console ✓');
process.exit(errors.length || overflow ? 1 : 0);
