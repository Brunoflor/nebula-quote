// Test dei calcoli:  node tests/geometry.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseSTL, computeStats, fitsBuildVolume } from '../js/geometry.js';
import { estimate } from '../js/estimate.js';
import { CONFIG } from '../js/config.js';
import { box, lathe, vaseProfile } from '../tools/generate-samples.mjs';

const flat = tris => new Float32Array(tris.flat(2));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: atteso ${b}, ottenuto ${a}`);
let n = 0; const ok = m => { n++; console.log('✓', m); };

// Cubo 20 mm = 8000 mm³ = 8 cm³, area 2400 mm²
const cube = computeStats(parseSTL(readFileSync(new URL('../samples/cubo-20mm.stl', import.meta.url))));
close(cube.volume, 8000, 1e-3, 'volume cubo'); close(cube.area, 2400, 1e-3, 'area cubo');
assert.deepEqual([cube.size.x, cube.size.y, cube.size.z], [20, 20, 20]); assert.equal(cube.triangles, 12);
ok('cubo 20 mm (ASCII): 8.000 cm³, 2400 mm², 20×20×20');

// Stesso cubo con normali invertite → volume assoluto invariato
const inv = box(20, 20, 20).map(([a, b, c]) => [a, c, b]);
close(computeStats(flat(inv)).volume, 8000, 1e-3, 'cubo invertito'); ok('normali invertite: volume invariato');

// Parallelepipedo traslato 10×30×50 lontano dall'origine
const shifted = box(10, 30, 50).map(t => t.map(([x, y, z]) => [x + 500, y - 300, z + 77]));
close(computeStats(flat(shifted)).volume, 15000, 1e-2, 'box traslato'); ok('box traslato 10×30×50 = 15 cm³ (indipendente dall\'origine)');

// Cilindro r=10 h=20 tassellato con 2000 segmenti ≈ π r² h
const cyl = computeStats(flat(lathe([[0, 0], [10, 0], [10, 20], [0, 20]], 2000)));
close(cyl.volume, Math.PI * 100 * 20, 0.5, 'cilindro'); close(cyl.area, 2 * Math.PI * 10 * 20 + 2 * Math.PI * 100, 0.5, 'area cilindro');
ok(`cilindro r10 h20: ${cyl.volume.toFixed(1)} mm³ (teorico ${(Math.PI * 2000).toFixed(1)})`);

// Vaso campione (binario): confronto con integrazione numerica del profilo (poligono a 72 lati)
const vasePos = parseSTL(readFileSync(new URL('../samples/vaso-nebula.stl', import.meta.url)));
const vase = computeStats(vasePos);
const prof = vaseProfile(), seg = 72;
// area di un poligono regolare a seg lati di raggio r = seg/2 · r² · sin(2π/seg); volume = ∮ con formula di Green sul profilo
const k = seg / 2 * Math.sin(2 * Math.PI / seg);
let ref = 0; for (let i = 0; i < prof.length - 1; i++) { const [r0, z0] = prof[i], [r1, z1] = prof[i + 1]; ref += -k * (z1 - z0) * (r0 * r0 + r0 * r1 + r1 * r1) / 3; }
ref = Math.abs(ref);
close(vase.volume, ref, ref * 1e-4, 'vaso'); ok(`vaso (binario): ${(vase.volume / 1000).toFixed(2)} cm³ = riferimento analitico ${(ref / 1000).toFixed(2)} cm³`);

// Volume di stampa
assert.equal(fitsBuildVolume({ x: 20, y: 20, z: 20 }, CONFIG.buildVolume).fits, true);
assert.equal(fitsBuildVolume({ x: 300, y: 20, z: 20 }, CONFIG.buildVolume).fits, false);
assert.equal(fitsBuildVolume({ x: 250, y: 20, z: 300 }, CONFIG.buildVolume).fits, false);
ok('controllo volume di stampa 256³');

// Stima: coerenza
const base = { material: 'PLA', infill: 20, layer: '0.2', quality: 'standard', quantity: 1 };
const e1 = estimate(cube, base, CONFIG);
const e100 = estimate(cube, { ...base, infill: 100 }, CONFIG);
close(e100.plasticVol, 8000, 1e-6, 'infill 100% = volume pieno');
assert.ok(e1.gramsPerPart < e100.gramsPerPart);
assert.ok(estimate(cube, { ...base, layer: '0.12' }, CONFIG).secPerPart > e1.secPerPart);
const e5 = estimate(cube, { ...base, quantity: 5 }, CONFIG);
close(e5.partsSubtotal, e1.unitCost * 5, 1e-9, 'quantità'); assert.equal(e5.discountRate, 0.05);
close(e1.net, Math.max(CONFIG.minimumOrder, e1.unitCost + CONFIG.setupFee), 1e-9, 'totale');
ok(`stima cubo PLA 20%: ${e1.gramsPerPart.toFixed(1)} g, ${(e1.secPerPart / 60).toFixed(0)} min, ${e1.net.toFixed(2)} € + IVA`);

console.log(`\n${n} gruppi di test superati`);
