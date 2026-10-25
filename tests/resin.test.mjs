// Test dei calcoli per la resina:  node tests/resin.test.mjs
import assert from 'node:assert/strict';
import { computeStats, fitsBuildVolume } from '../js/geometry.js';
import { estimateResin, estimateQuote } from '../js/estimate.js';
import { CONFIG } from '../js/config.js';
import { box } from '../tools/generate-samples.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: atteso ${b}, ottenuto ${a}`);
let n = 0; const ok = m => { n++; console.log('✓', m); };
const R = CONFIG.resin;
const cube = computeStats(new Float32Array(box(20, 20, 20).flat(2)));   // 8000 mm³, 2400 mm², h 20
const base = { tech: 'resin', material: 'standard', layer: '0.05', hollow: false, wall: 2, quantity: 1 };

// Config: almeno le 4 resine richieste, densità 1.1–1.2 g/cm³, scarto 10–15%, volume 218×123×235
for (const k of ['standard', 'abslike', 'tough', 'waterwash']) {
  const m = R.materials[k]; assert.ok(m, k); assert.ok(m.density >= 1.1 && m.density <= 1.2, `${k} densità`); assert.ok(m.pricePerKg > 0);
}
assert.ok(R.supportWaste >= 0.10 && R.supportWaste <= 0.15);
assert.deepEqual(R.buildVolume, { x: 218, y: 123, z: 235 });
for (const l of Object.values(R.layerHeights)) assert.ok(l.secondsPerLayer >= 2.5 && l.secondsPerLayer <= 3);
assert.deepEqual(Object.keys(R.layerHeights), ['0.025', '0.05', '0.1']);
ok('config resina: Standard, ABS-like, Tough, Lavabile in acqua · densità 1.1–1.2 · scarto 12% · 218×123×235 mm');

// Pieno: resina = volume × (1 + scarto)
let r = estimateResin(cube, base, CONFIG);
close(r.mlPerPart, 8, 1e-9, 'ml pieno'); close(r.mlPerPartWithWaste, 8 * (1 + R.supportWaste), 1e-9, 'ml con scarto');
close(r.gramsPerPartWithWaste, 8 * (1 + R.supportWaste) * R.materials.standard.density, 1e-9, 'grammi');
close(r.materialCost, r.gramsPerPartWithWaste / 1000 * R.materials.standard.pricePerKg, 1e-9, 'costo resina');
ok(`cubo 20 mm pieno: ${r.mlPerPartWithWaste.toFixed(2)} ml (8 ml + ${R.supportWaste * 100}% supporti) · ${r.gramsPerPartWithWaste.toFixed(2)} g`);

// Svuotato: guscio = superficie × parete (2400 × 2 = 4800 mm³), mai più del volume pieno
r = estimateResin(cube, { ...base, hollow: true, wall: 2 }, CONFIG);
close(r.resinVol, 4800, 1e-9, 'guscio 2 mm');
r = estimateResin(cube, { ...base, hollow: true, wall: 5 }, CONFIG);
close(r.resinVol, 8000, 1e-9, 'guscio limitato al volume');
ok('svuotato: guscio 2 mm = 4,8 ml; con parete 5 mm il guscio non supera il volume pieno (8 ml)');

// Tempo: dipende dall'altezza, non dal volume
r = estimateResin(cube, base, CONFIG);
assert.equal(r.layers, 400);                                            // 20 / 0.05
close(r.plateSec, 400 * R.layerHeights['0.05'].secondsPerLayer + R.overheadMinutesPerPlate * 60, 1e-9, 'tempo piatto');
const fat = computeStats(new Float32Array(box(60, 60, 20).flat(2)));    // 9× il volume, stessa altezza
assert.equal(estimateResin(fat, base, CONFIG).plateSec, r.plateSec);
const tall = computeStats(new Float32Array(box(10, 10, 80).flat(2)));   // volume minore, 4× più alto
assert.ok(estimateResin(tall, base, CONFIG).plateSec > r.plateSec);
assert.equal(estimateResin(tall, base, CONFIG).layers, 1600);
assert.equal(estimateResin(cube, { ...base, layer: '0.025' }, CONFIG).layers, 800);
assert.equal(estimateResin(cube, { ...base, layer: '0.1' }, CONFIG).layers, 200);
ok(`tempo resina: 400 layer × ${R.layerHeights['0.05'].secondsPerLayer} s + ${R.overheadMinutesPerPlate} min; 60×60×20 (9× volume) = stesso tempo; 10×10×80 più lento`);

// Più pezzi sullo stesso piatto: il tempo non si moltiplica
const r10 = estimateResin(cube, { ...base, quantity: 10 }, CONFIG);
assert.equal(r10.plates, 1); assert.equal(r10.totalSec, r.plateSec);
const big = computeStats(new Float32Array(box(150, 100, 30).flat(2)));
const rb = estimateResin(big, { ...base, quantity: 3 }, CONFIG);
assert.equal(rb.partsPerPlate, 1); assert.equal(rb.plates, 3); close(rb.totalSec, 3 * rb.plateSec, 1e-9, '3 piatti');
ok(`10 cubi su un solo piatto (${r10.partsPerPlate} pezzi/piatto) → stesso tempo; 3 pezzi da 150×100 → 3 stampe`);

// Prezzo: materiale + macchina resina + post-produzione, poi sconto/minimo/IVA come per il filamento
r = estimateResin(cube, base, CONFIG);
close(r.machineTotal, r.totalSec / 3600 * R.machineRatePerHour, 1e-9, 'macchina');
close(r.postTotal, R.postProcessPerPart, 1e-9, 'post-produzione');
close(r.partsSubtotal, r.materialTotal + r.machineTotal + r.postTotal, 1e-9, 'subtotale');
close(r.net, Math.max(CONFIG.minimumOrder, r.partsSubtotal + CONFIG.setupFee), 1e-9, 'netto');
close(r.gross, r.net * (1 + CONFIG.vatRate), 1e-9, 'IVA');
assert.ok(r10.discountRate === 0.10 && r10.discount > 0);
ok(`prezzo cubo resina standard: ${r.net.toFixed(2)} € + IVA (macchina ${R.machineRatePerHour} €/h, post-produzione ${R.postProcessPerPart} €/pezzo)`);

// Resine più care costano di più; svuotato costa meno del pieno su un pezzo grande
const vase = computeStats(new Float32Array(box(50, 50, 80).flat(2)));
const pStd = estimateResin(vase, base, CONFIG).net, pTough = estimateResin(vase, { ...base, material: 'tough' }, CONFIG).net;
const pHollow = estimateResin(vase, { ...base, hollow: true }, CONFIG).net;
assert.ok(pTough > pStd && pHollow < pStd);
ok(`50×50×80: standard ${pStd.toFixed(2)} € · tough ${pTough.toFixed(2)} € · svuotato ${pHollow.toFixed(2)} €`);

// Dispatcher e volume di stampa resina
assert.equal(estimateQuote(cube, base, CONFIG).tech, 'resin');
assert.equal(estimateQuote(cube, { tech: 'fdm', ...CONFIG.defaults }, CONFIG).tech, 'fdm');
assert.equal(fitsBuildVolume({ x: 200, y: 100, z: 200 }, R.buildVolume).fits, true);
assert.equal(fitsBuildVolume({ x: 120, y: 200, z: 100 }, R.buildVolume).rotatedOnly, true);
assert.equal(fitsBuildVolume({ x: 230, y: 100, z: 100 }, R.buildVolume).fits, false);
assert.equal(fitsBuildVolume({ x: 100, y: 100, z: 240 }, R.buildVolume).fits, false);
ok('volume di stampa resina 218×123×235: entra / entra ruotato / troppo largo / troppo alto');

console.log(`\n${n} test resina superati`);
