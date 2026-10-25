// Test end-to-end nel browser (opzionale): richiede `npm i puppeteer-core` e Chrome.
//   python3 -m http.server 8765  &&  node tests/e2e.mjs
// La generazione da foto è simulata (?mock3d=1, usa tests/fixtures/razzo-generato.glb):
// nessuna chiamata a Hugging Face. Per una generazione reale: node tests/e2e-real.mjs
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE || 'http://localhost:8765/';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const errors = [];
const assert = (c, msg) => { if (!c) throw new Error('ASSERT: ' + msg); };
const eurNum = s => parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function open(width, height, mobile = false, query = '') {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|swiftshader|WebGL/i.test(m.text()))) errors.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => errors.push(`[requestfailed] ${r.url()}`));
  await page.goto(BASE + query, { waitUntil: 'networkidle0' });
  return page;
}
const read = p => p.evaluate(() => ({
  file: document.querySelector('#filename').textContent,
  size: document.querySelector('#s-size').textContent, vol: document.querySelector('#s-volume').textContent,
  total: document.querySelector('#q-total').textContent, weight: document.querySelector('#q-weight').textContent, time: document.querySelector('#q-time').textContent,
}));
const fileName = p => p.evaluate(() => window.__nebula.state.models[window.__nebula.state.mode]?.fileName || '');

/* ---------- 1. Modalità STL (invariata) ---------- */
const page = await open(1440, 1000);
await page.click('#sample');
await page.waitForFunction(() => window.__nebula.state.models.stl?.stats && !document.querySelector('#request').disabled);
console.log('Esempio vaso:', await read(page));
await page.click('#sample2');
await page.waitForFunction(() => window.__nebula.state.models.stl.fileName.includes('cubo'));
const cube = await read(page); console.log('Esempio cubo:', cube);
assert(cube.vol.startsWith('8,00'), 'Volume cubo errato: ' + cube.vol);
await page.click('#materials button[data-id="PETG"]');
await page.select('#layer', '0.12');
await page.click('.stepper button[data-step="1"]');
console.log('Cubo PETG 0.12 ×2:', await read(page));
const input = await page.$('#file2');
await input.uploadFile(new URL('../samples/vaso-nebula.stl', import.meta.url).pathname);
await page.waitForFunction(() => window.__nebula.state.models.stl.fileName === 'vaso-nebula.stl');
await page.click('#materials button[data-id="PLA"]'); await page.select('#layer', '0.2');
await page.evaluate(() => { const q = document.querySelector('#quantity'); q.value = 1; q.dispatchEvent(new Event('input')); });
const fdm = await read(page);
await page.click('#request');
const summary = await page.$eval('#summary', t => t.value);
assert((await page.$eval('#send-mail', a => a.href)).startsWith('mailto:'), 'mailto');
assert(summary.includes('Filamento (FDM)'), 'riepilogo FDM');
await page.keyboard.press('Escape');
await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: new URL('../screenshot.png', import.meta.url).pathname, fullPage: true });

/* ---------- 2. Resina (SLA) sullo stesso STL ---------- */
await page.click('#tech button[data-id="resin"]');
await page.waitForFunction(() => window.__nebula.state.result?.tech === 'resin');
const vis = await page.evaluate(() => ({ infill: !document.querySelector('#infill-field').hidden, resin: !document.querySelector('#resin-fields').hidden, quality: !document.querySelector('#quality-field').hidden, kpi: document.querySelector('#k-weight').textContent, mats: [...document.querySelectorAll('#materials button')].map(b => b.textContent) }));
assert(!vis.infill && vis.resin && !vis.quality && vis.kpi === 'Resina', 'campi resina: ' + JSON.stringify(vis));
assert(vis.mats.length >= 4 && vis.mats.includes('ABS-like') && vis.mats.includes('Tough'), 'materiali resina');
const solid = await read(page);
assert(solid.weight.endsWith('ml'), 'KPI in ml');
assert(solid.total !== fdm.total, 'prezzo resina diverso da FDM');
await page.click('label.toggle');
await page.waitForFunction(() => window.__nebula.state.result.hollow === true);
assert(!(await page.$eval('#wall', w => w.disabled)), 'parete abilitata con Svuotato');
const hollow = await read(page);
assert(eurNum(hollow.total) <= eurNum(solid.total), 'svuotato costa meno o uguale');
const ml = s => eurNum(s.weight);
assert(ml(hollow) <= ml(solid), 'svuotato non usa più resina'); // il vaso ha già pareti sottili
await page.select('#layer', '0.025');
const fine = await read(page);
const r1 = await page.evaluate(() => window.__nebula.state.result);
assert(r1.layers > 0 && r1.postTotal > 0, 'layer e post-produzione');
await page.click('#request');
const sumR = await page.$eval('#summary', t => t.value);
assert(sumR.includes('Resina (SLA)') && sumR.includes('svuotato'), 'riepilogo resina');
await page.keyboard.press('Escape');
console.log('Resina pieno:', solid, '\nResina svuotato:', hollow, '\nResina 0.025:', fine);
// fuori volume resina (218×123×235): vaso in cm
await page.select('#unit', 'cm');
await page.waitForFunction(() => document.querySelector('#warnings .alert.error')?.textContent.includes('resina'));
console.log('Avviso fuori volume resina:', await page.$eval('#warnings .alert.error', e => e.textContent.trim().slice(0, 90) + '…'));
await page.select('#unit', 'mm');
await page.click('#tech button[data-id="fdm"]');
await page.waitForFunction(() => window.__nebula.state.result?.tech === 'fdm');
assert((await read(page)).total === fdm.total, 'torna al prezzo FDM');

/* ---------- 3. Da foto (generazione simulata) ---------- */
const ph = await open(1440, 1000, false, '?mock3d=1');
await ph.click('#mode-photo');
assert((await ph.$eval('#sample', b => b.textContent)) === 'Prova con una foto di esempio', 'pulsante foto esempio');
await ph.click('#sample');
await ph.waitForFunction(() => !document.querySelector('#gen').hidden);
const genTxt = await ph.$eval('#gen', e => e.textContent);
assert(genTxt.includes('Generazione del modello 3D in corso'), 'overlay generazione');
await ph.waitForFunction(() => /In coda|Elaborazione/.test(document.querySelector('#gen-status').textContent));
console.log('Stato generazione:', await ph.$eval('#gen-status', e => e.textContent));
await ph.waitForFunction(() => window.__nebula.state.models.photo?.stats && document.querySelector('#gen').hidden, { timeout: 20000 });
const p1 = await read(ph); console.log('Da foto (mock):', p1, await ph.$eval('#photo-meta', e => e.textContent));
assert(p1.size.includes('80,0 mm'.split(' ')[0]), 'altezza 80 mm');
assert(!(await ph.$eval('#photo-card', e => e.hidden)) && (await ph.$eval('#photo-card', e => e.textContent)).includes('IA'), 'card foto con avviso IA');
assert(!(await ph.$eval('#ai-disclaimer', e => e.hidden)), 'disclaimer IA');
// misura reale
await ph.evaluate(() => { const s = document.querySelector('#photo-size'); s.value = 120; s.dispatchEvent(new Event('input')); });
await ph.waitForFunction(() => Math.abs(window.__nebula.state.models.photo.stats.size.z - 120) < 0.01);
const p2 = await read(ph); assert(eurNum(p2.total) > eurNum(p1.total), 'più grande costa di più');
await ph.select('#photo-size-mode', 'longest');
await ph.waitForFunction(() => { const s = window.__nebula.state.models.photo.stats.size; return Math.abs(Math.max(s.x, s.y, s.z) - 120) < 0.01; });
// resina in modalità foto
await ph.click('#tech button[data-id="resin"]');
await ph.waitForFunction(() => window.__nebula.state.result?.tech === 'resin');
const p3 = await read(ph); console.log('Da foto in resina:', p3);
// Scarica STL
const cdp = await ph.target().createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/nq/dl' });
const fs = await import('node:fs'); fs.rmSync('/tmp/nq/dl', { recursive: true, force: true });
await ph.click('#download-stl');
let stl; for (let i = 0; i < 50 && !stl; i++) { await new Promise(r => setTimeout(r, 200)); stl = fs.existsSync('/tmp/nq/dl') && fs.readdirSync('/tmp/nq/dl').find(f => f.endsWith('.stl')); }
assert(stl, 'STL scaricato');
const buf = fs.readFileSync('/tmp/nq/dl/' + stl);
const tris = buf.readUInt32LE(80);
assert(buf.length === 84 + tris * 50, 'STL binario valido');
console.log('STL scaricato:', stl, tris, 'triangoli');
// riepilogo foto
await ph.click('#request');
const sumP = await ph.$eval('#summary', t => t.value);
assert(sumP.includes('generato con IA') && sumP.includes('Resina (SLA)'), 'riepilogo foto');
await ph.keyboard.press('Escape');
// ritorno a STL: modello foto conservato, STL vuoto
await ph.click('#mode-stl');
assert(!(await ph.$eval('#dropzone', e => e.hidden)), 'STL vuoto');
await ph.click('#mode-photo');
assert(await ph.$eval('#dropzone', e => e.hidden), 'modello foto conservato');

/* ---------- 4. Riserva automatica + annulla ---------- */
const fb = await open(1200, 900, false, '?mock3d=fail1&mode=photo');
await fb.click('#sample');
await fb.waitForFunction(() => document.querySelector('#gen-service').textContent.includes('riserva'), { timeout: 10000 });
await fb.waitForFunction(() => window.__nebula.state.models.photo?.stats, { timeout: 20000 });
const meta = await fb.$eval('#photo-meta', e => e.textContent);
assert(meta.includes('riserva'), 'riserva usata: ' + meta);
console.log('Riserva:', meta);
const errsBefore = errors.length;
await fb.click('#regen');
await fb.waitForFunction(() => !document.querySelector('#gen').hidden);
await fb.click('#gen-cancel');
await fb.waitForFunction(() => document.querySelector('#gen').hidden);
await new Promise(r => setTimeout(r, 1500));
assert(await fb.$eval('#dropzone', e => e.hidden), 'dopo annulla resta il modello precedente');
errors.splice(errsBefore); // il warning di annullamento è atteso
await new Promise(r => setTimeout(r, 300));

/* ---------- 5. Mobile ---------- */
let overflow = false;
for (const q of ['', '?mock3d=1&photo=1&tech=resin']) {
  const m = await open(390, 844, true, q);
  if (!q) { await m.click('#sample'); await m.waitForFunction(() => window.__nebula.state.models.stl?.stats); }
  else await m.waitForFunction(() => window.__nebula.state.models.photo?.stats, { timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500));
  const o = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  overflow ||= o;
  await m.screenshot({ path: `/tmp/nq/mobile${q ? '-foto' : ''}.png`, fullPage: true });
  console.log(`Mobile ${q || 'STL'} overflow orizzontale:`, o);
}
await browser.close();
const real = errors.filter(e => !e.includes('non riuscito') || !e.includes('[console.warning]'));
console.log(real.length ? 'ERRORI:\n' + real.join('\n') : 'Nessun errore in console ✓');
process.exit(real.length || overflow ? 1 : 0);
