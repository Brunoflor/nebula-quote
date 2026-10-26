// Totali di progetto (più parti):  node tests/project.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSTL, computeStats } from '../js/geometry.js';
import { estimate, estimateResin, estimateQuote, estimateProject } from '../js/estimate.js';
import { CONFIG } from '../js/config.js';
import { box } from '../tools/generate-samples.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: atteso ${b}, ottenuto ${a}`);
let n = 0;
const ok = m => { n++; console.log('✓', m); };

const cube = computeStats(new Float32Array(box(20, 20, 20).flat(2)));
const tall = computeStats(new Float32Array(box(10, 10, 80).flat(2)));
const big = computeStats(new Float32Array(box(80, 80, 40).flat(2)));
const cuboFile = computeStats(parseSTL(readFileSync(new URL('../samples/cubo-20mm.stl', import.meta.url))));
const vasoFile = computeStats(parseSTL(readFileSync(new URL('../samples/vaso-nebula.stl', import.meta.url))));
const fdm = { tech: 'fdm', material: 'PLA', infill: 20, layer: '0.2', quality: 'standard', quantity: 1 };
const resin = { tech: 'resin', material: 'standard', layer: '0.05', hollow: false, wall: 2, quantity: 1 };

assert.throws(() => estimateProject([], CONFIG), /parti/);
ok('progetto vuoto rifiutato');

// Una sola parte = il preventivo di oggi, per FDM e resina, con e senza sconto / minimo
const singles = [
  ['FDM qty 1', cube, fdm],
  ['FDM qty 5 (sconto 5%)', cube, { ...fdm, quantity: 5 }],
  ['FDM qty 10 (sconto 10%)', cube, { ...fdm, quantity: 10, material: 'PETG', infill: 40, layer: '0.12', quality: 'alta' }],
  ['FDM TPU', tall, { ...fdm, material: 'TPU', infill: 15, quantity: 2 }],
  ['resina piena', cube, resin],
  ['resina svuotata', tall, { ...resin, hollow: true, wall: 1.5, material: 'tough', quantity: 1 }],
  ['resina ×10 su un piatto', cube, { ...resin, quantity: 10 }],
  ['resina ×3 su più piatti', big, { ...resin, quantity: 3, layer: '0.025' }],
];
for (const [label, stats, opts] of singles) {
  const alone = opts.tech === 'resin' ? estimateResin(stats, opts, CONFIG) : estimate(stats, opts, CONFIG);
  const via = estimateQuote(stats, opts, CONFIG);
  const proj = estimateProject([{ stats, opts }], CONFIG);
  for (const k of ['qty', 'totalGrams', 'totalSec', 'partsSubtotal', 'discount', 'setupFee', 'minimumApplied', 'minimumTopUp', 'net', 'vat', 'gross']) {
    close(proj[k], via[k], 1e-6, `${label} ${k}`);
    close(proj[k], alone[k], 1e-6, `${label} vs modello ${k}`);
  }
  assert.equal(proj.lines[0].discountRate, via.discountRate, `${label} aliquota sconto`);
  close(proj.linesNet, via.partsSubtotal - via.discount, 1e-9, `${label} costo riga`);
  close(proj.lines[0].lineNet, proj.linesNet, 1e-9, `${label} lineNet`);
  if (opts.tech === 'resin') close(proj.totalMl, via.totalMl, 1e-6, `${label} ml`);
  else close(proj.totalMl, 0, 1e-9, `${label} niente ml`);
  assert.equal(proj.partCount, 1);
}
ok('una parte coincide con il preventivo singolo (FDM e resina, sconti, piatti, minimo, IVA)');

// Preparazione una volta sola: due parti grandi non toccano il minimo
const optsA = { ...fdm, material: 'ABS', infill: 30, quantity: 2 };
const optsB = { ...fdm, material: 'PLA', infill: 80, quality: 'bozza', layer: '0.28', quantity: 1 };
const a = estimateQuote(big, optsA, CONFIG);
const b = estimateQuote(tall, optsB, CONFIG);
const two = estimateProject([{ stats: big, opts: optsA }, { stats: tall, opts: optsB }], CONFIG);
assert.equal(a.minimumApplied, false);
assert.equal(b.minimumApplied, false);
assert.equal(two.minimumApplied, false);
close(two.linesNet, (a.partsSubtotal - a.discount) + (b.partsSubtotal - b.discount), 1e-6, 'somma righe');
close(two.net, two.linesNet + CONFIG.setupFee, 1e-6, 'preparazione una volta');
close(two.vat, two.net * CONFIG.vatRate, 1e-9, 'IVA sul totale di progetto');
close(two.gross, two.net + two.vat, 1e-9, 'lordo');
close((a.net + b.net) - two.net, CONFIG.setupFee, 1e-6, 'i due ordini separati pagano una preparazione in più');
close(two.totalGrams, a.totalGrams + b.totalGrams, 1e-6, 'peso somma');
close(two.totalSec, a.totalSec + b.totalSec, 1e-6, 'tempo FDM somma (stampe in sequenza)');
close(two.discount, a.discount + b.discount, 1e-9, 'sconti sommati, non ricalcolati');
assert.equal(two.setupFee, CONFIG.setupFee);
ok(`due parti FDM: netto ${two.net.toFixed(2)} € = righe + preparazione ${CONFIG.setupFee} € una volta (non ${ (a.net + b.net).toFixed(2) } €)`);

// Sconto quantità per parte, non sulla somma delle quantità
const five = { ...fdm, quantity: 5 };
const ten = { ...fdm, quantity: 10 };
const q5 = estimateQuote(cube, five, CONFIG);
const q10 = estimateQuote(cube, ten, CONFIG);
assert.equal(q5.discountRate, 0.05);
assert.equal(q10.discountRate, 0.10);
const split = estimateProject([{ stats: cube, opts: five }, { stats: cube, opts: five }], CONFIG);
assert.equal(split.lines[0].discountRate, 0.05);
assert.equal(split.lines[1].discountRate, 0.05);
close(split.discount, q10.discount / 2, 1e-6, '5+5 resta il 5%, non il 10% di una riga da 10');
const six = estimateProject(Array.from({ length: 6 }, () => ({ stats: cube, opts: fdm })), CONFIG);
assert.ok(six.lines.every(l => l.discountRate === 0), '6 parti da 1 pezzo: nessuno sconto');
assert.equal(six.qty, 6);
const pooled = estimateQuote(cube, { ...fdm, quantity: 6 }, CONFIG);
assert.equal(pooled.discountRate, 0.05);
assert.ok(six.discount < pooled.discount || six.discount === 0);
ok('sconto quantità: 5+5 = 5% per parte; 6 parti singole non raggiungono la soglia');

// Resina: copie della stessa parte condividono il piatto; parti diverse no
const r1 = estimateResin(cube, resin, CONFIG);
const r2 = estimateResin(cube, { ...resin, quantity: 2 }, CONFIG);
assert.ok(r1.partsPerPlate >= 2, 'due cubi da 20 mm starebbero su un piatto');
assert.equal(r2.plates, 1, 'qty 2 della stessa parte = 1 piatto');
const separatePlates = estimateProject([
  { stats: cube, opts: resin },
  { stats: cube, opts: { ...resin, material: 'abslike' } },
], CONFIG);
close(separatePlates.totalSec, r1.totalSec * 2, 1e-6, 'due parti resina = due piatti');
assert.ok(separatePlates.totalSec > r2.totalSec, 'non si risparmia l\'overhead unendo parti diverse');
assert.equal(separatePlates.lines[0].plates, 1);
assert.equal(separatePlates.lines[1].plates, 1);
// anche stesso materiale e stesso colore: il piatto non si condivide fra righe
const sameResin = estimateProject([{ stats: cube, opts: resin }, { stats: cube, opts: { ...resin } }], CONFIG);
close(sameResin.totalSec, r1.plateSec + r1.plateSec, 1e-6, 'overhead piatto per ogni parte');
close(sameResin.lines[0].machineTotal + sameResin.lines[1].machineTotal, r1.machineTotal * 2, 1e-6, 'macchina resina non condivisa');
ok(`resina: due parti piccole ${ (separatePlates.totalSec / 60).toFixed(0) } min (due piatti), la stessa parte ×2 resta ${ (r2.totalSec / 60).toFixed(0) } min`);

// Misto FDM + resina
const mix = estimateProject([{ stats: vasoFile, opts: fdm }, { stats: cube, opts: { ...resin, hollow: true, quantity: 4 } }], CONFIG);
const fdmVase = estimateQuote(vasoFile, fdm, CONFIG);
const resinCubes = estimateQuote(cube, { ...resin, hollow: true, quantity: 4 }, CONFIG);
close(mix.totalGrams, fdmVase.totalGrams + resinCubes.totalGrams, 1e-6, 'grammi misti');
close(mix.totalMl, resinCubes.totalMl, 1e-6, 'ml solo resina');
close(mix.totalSec, fdmVase.totalSec + resinCubes.totalSec, 1e-6, 'tempi misti');
close(mix.linesNet, (fdmVase.partsSubtotal - fdmVase.discount) + (resinCubes.partsSubtotal - resinCubes.discount), 1e-6, 'righe miste');
close(mix.net, Math.max(CONFIG.minimumOrder, mix.linesNet + CONFIG.setupFee), 1e-6, 'netto misto');
assert.equal(mix.lines[0].tech, 'fdm');
assert.equal(mix.lines[1].tech, 'resin');
assert.equal(mix.lines[1].hollow, true);
ok(`misto vaso FDM + 4 cubi resina svuotati: ${mix.net.toFixed(2)} €, ${mix.totalMl.toFixed(0)} ml, ${mix.totalGrams.toFixed(0)} g`);

// Ordine minimo sul progetto, non per parte
const tiny = computeStats(new Float32Array(box(5, 5, 5).flat(2)));
const tinyOpts = { ...fdm, infill: 0, quantity: 1 };
const oneTiny = estimateProject([{ stats: tiny, opts: tinyOpts }], CONFIG);
const twoTiny = estimateProject([{ stats: tiny, opts: tinyOpts }, { stats: tiny, opts: tinyOpts }], CONFIG);
assert.equal(oneTiny.minimumApplied, true, 'un cubetto da solo è sotto il minimo');
assert.equal(oneTiny.net, CONFIG.minimumOrder);
close(twoTiny.net, Math.max(CONFIG.minimumOrder, twoTiny.linesNet + CONFIG.setupFee), 1e-9, 'minimo sul totale');
assert.ok(twoTiny.minimumTopUp < oneTiny.minimumTopUp, 'il secondo pezzo riduce l\'adeguamento, non aggiunge un altro minimo');
// unire non costa mai più che ordinare le parti separate (ognuna col suo setup e minimo)
const separateSum = twoTiny.lines.reduce((s, l) => s + l.net, 0);
assert.ok(twoTiny.net <= separateSum + 1e-6, `progetto ${twoTiny.net} > separati ${separateSum}`);
ok(`ordine minimo di progetto: 1 cubetto ${oneTiny.net.toFixed(2)} €, 2 cubetti ${twoTiny.net.toFixed(2)} € (separati sarebbero ${separateSum.toFixed(2)} €)`);

// I file di esempio reali: una parte = oggi; insieme, una sola preparazione
const cuboQuote = estimateQuote(cuboFile, fdm, CONFIG);
const vasoQuote = estimateQuote(vasoFile, { ...resin, quantity: 2 }, CONFIG);
const sampleProj = estimateProject([
  { stats: cuboFile, opts: fdm },
  { stats: vasoFile, opts: { ...resin, quantity: 2 } },
], CONFIG);
close(estimateProject([{ stats: cuboFile, opts: fdm }], CONFIG).net, cuboQuote.net, 1e-9, 'cubo esempio');
close(estimateProject([{ stats: vasoFile, opts: { ...resin, quantity: 2 } }], CONFIG).net, vasoQuote.net, 1e-9, 'vaso esempio');
close(sampleProj.linesNet, (cuboQuote.partsSubtotal - cuboQuote.discount) + (vasoQuote.partsSubtotal - vasoQuote.discount), 1e-6, 'righe esempi');
close(sampleProj.net, Math.max(CONFIG.minimumOrder, sampleProj.linesNet + CONFIG.setupFee), 1e-6, 'totale esempi');
assert.equal(sampleProj.partCount, 2);
assert.equal(sampleProj.qty, 3);
ok(`esempi STL: cubo PLA ${cuboQuote.net.toFixed(2)} € + vaso resina ×2, progetto ${sampleProj.net.toFixed(2)} € (prep. una volta)`);

// L'ordine delle parti non cambia il totale
const flipped = estimateProject([
  { stats: vasoFile, opts: { ...resin, quantity: 2 } },
  { stats: cuboFile, opts: fdm },
], CONFIG);
close(flipped.net, sampleProj.net, 1e-9, 'commutativo');
close(flipped.totalSec, sampleProj.totalSec, 1e-9, 'tempo commutativo');
close(flipped.gross, sampleProj.gross, 1e-9, 'lordo commutativo');
ok('il totale non dipende dall\'ordine delle parti');

console.log(`\n${n} gruppi di test progetto superati`);
