import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { CONFIG } from './config.js';
import { parseSTL, computeStats, fitsBuildVolume } from './geometry.js';
import { estimate, formatDuration } from './estimate.js';

const $ = s => document.querySelector(s);
const nf = (d = 1) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: CONFIG.currency });
const SAMPLES = [
  { file: 'samples/vaso-nebula.stl', name: 'vaso-nebula.stl' },
  { file: 'samples/cubo-20mm.stl', name: 'cubo-20mm.stl' },
];
const UNIT_SCALE = { mm: 1, cm: 10, in: 25.4 };

const state = { ...CONFIG.defaults, raw: null, stats: null, fileName: '', sampleIdx: -1, result: null };

/* ---------------- 3D viewer ---------------- */
const viewerEl = $('#viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewerEl.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
camera.up.set(0, 0, 1); // gli STL sono Z-up
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;
controls.addEventListener('start', () => { controls.autoRotate = false; });

scene.add(new THREE.HemisphereLight(0xc4b5fd, 0x0b0a14, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, -1.2, 2); scene.add(key);
const rim = new THREE.DirectionalLight(0x22d3ee, 1.4); rim.position.set(-1.5, 1.5, 0.6); scene.add(rim);

const bv = CONFIG.buildVolume;
const plate = new THREE.Group(); scene.add(plate);
const grid = new THREE.GridHelper(Math.max(bv.x, bv.y), Math.round(Math.max(bv.x, bv.y) / 16), 0x6d5bd0, 0x2a2550);
grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.55; plate.add(grid);
const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(bv.x, bv.y), new THREE.MeshBasicMaterial({ color: 0x1a1630, transparent: true, opacity: 0.6 }));
plateMesh.position.z = -0.05; plate.add(plateMesh);
const volBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bv.x, bv.y, bv.z)), new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.25 }));
volBox.position.z = bv.z / 2; plate.add(volBox);

const material = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.45, metalness: 0.08 });
let mesh = null;

function resize() {
  const w = viewerEl.clientWidth, h = viewerEl.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewerEl);
resize();
setView(60, 60, 60);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

function setView(sx, sy, sz) {
  const r = Math.max(Math.hypot(sx, sy, sz) / 2, 10);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  const target = new THREE.Vector3(0, 0, sz / 2);
  const dir = new THREE.Vector3(0.9, -1.25, 0.8).normalize();
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
  controls.target.copy(target); controls.update();
}

function showModel(pos, stats) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.translate(-(stats.min.x + stats.max.x) / 2, -(stats.min.y + stats.max.y) / 2, -stats.min.z); // centrato sul piatto
  g.computeVertexNormals();
  mesh = new THREE.Mesh(g, material);
  scene.add(mesh);
  const fit = fitsBuildVolume(stats.size, bv);
  volBox.material.color.set(fit.fits ? 0x8b5cf6 : 0xf87171); volBox.material.opacity = fit.fits ? 0.25 : 0.8;
  controls.autoRotate = true;
  setView(stats.size.x, stats.size.y, stats.size.z);
}

/* ---------------- UI controls ---------------- */
function buildControls() {
  const mats = $('#materials');
  for (const [id, m] of Object.entries(CONFIG.materials)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = m.label; b.dataset.id = id; b.setAttribute('role', 'radio');
    b.onclick = () => { state.material = id; syncControls(); update(); };
    mats.append(b);
  }
  const layer = $('#layer');
  for (const [id, l] of Object.entries(CONFIG.layerHeights)) layer.add(new Option(l.label, id));
  const quality = $('#quality');
  for (const [id, q] of Object.entries(CONFIG.qualities)) quality.add(new Option(`${q.label} · ${q.walls} pareti`, id));
  const sw = $('#colors');
  for (const c of CONFIG.colors) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', c.name); b.setAttribute('role', 'radio'); b.dataset.name = c.name;
    b.onclick = () => { state.color = c.name; syncControls(); update(); };
    sw.append(b);
  }
  $('#infill').oninput = e => { state.infill = +e.target.value; syncControls(); update(); };
  layer.onchange = e => { state.layer = e.target.value; update(); };
  quality.onchange = e => { state.quality = e.target.value; update(); };
  $('#unit').onchange = e => { state.unit = e.target.value; if (state.raw) analyse(); };
  const qty = $('#quantity');
  qty.oninput = () => { state.quantity = clampQty(qty.value); update(); };
  qty.onblur = () => { qty.value = state.quantity; };
  document.querySelectorAll('.stepper button').forEach(b => b.onclick = () => {
    state.quantity = clampQty(state.quantity + +b.dataset.step); qty.value = state.quantity; update();
  });
  syncControls();
}
const clampQty = v => Math.min(999, Math.max(1, Math.floor(+v || 1)));

function syncControls() {
  document.querySelectorAll('#materials button').forEach(b => b.setAttribute('aria-checked', b.dataset.id === state.material));
  document.querySelectorAll('#colors button').forEach(b => b.setAttribute('aria-checked', b.dataset.name === state.color));
  const m = CONFIG.materials[state.material];
  $('#material-note').textContent = `${m.note} · ${nf(2).format(m.density)} g/cm³ · ${eur.format(m.pricePerKg)}/kg`;
  $('#infill').value = state.infill; $('#infill-out').textContent = `${state.infill}%`;
  $('#layer').value = state.layer; $('#quality').value = state.quality; $('#unit').value = state.unit;
  $('#quantity').value = state.quantity;
  $('#color-out').textContent = state.color;
  material.color.set(CONFIG.colors.find(c => c.name === state.color)?.hex || '#8b5cf6');
}

/* ---------------- Loading files ---------------- */
async function loadBuffer(buffer, name) {
  $('#loading').hidden = false;
  await new Promise(r => setTimeout(r, 20)); // lascia disegnare lo spinner
  try {
    state.raw = parseSTL(buffer);
    if (state.raw.length < 9) throw new Error('Il file non contiene triangoli');
    state.fileName = name;
    analyse();
    $('#dropzone').hidden = true; $('#viewer-toolbar').hidden = false;
    $('#filename').textContent = name; $('#filename').title = name;
  } catch (err) {
    console.warn(err);
    toast(`Impossibile leggere il file: ${err.message}`);
  } finally { $('#loading').hidden = true; }
}

function analyse() {
  const s = UNIT_SCALE[state.unit];
  const pos = s === 1 ? state.raw : state.raw.map(v => v * s);
  state.stats = computeStats(pos);
  showModel(pos, state.stats);
  update();
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.stl$/i.test(file.name)) { toast('Carica un file con estensione .stl'); return; }
  if (file.size > 200 * 1024 * 1024) { toast('File troppo grande (max 200 MB)'); return; }
  loadBuffer(await file.arrayBuffer(), file.name);
}

async function loadSample(idx) {
  state.sampleIdx = idx % SAMPLES.length;
  const s = SAMPLES[state.sampleIdx];
  try {
    const res = await fetch(s.file);
    if (!res.ok) throw new Error(res.status);
    if (state.unit !== 'mm') state.unit = 'mm', syncControls();
    await loadBuffer(await res.arrayBuffer(), `Esempio · ${s.name}`);
  } catch (e) { toast('Impossibile caricare l\'esempio: avvia il sito da un server web (vedi README)'); }
}

$('#file').onchange = e => { loadFile(e.target.files[0]); e.target.value = ''; };
$('#file2').onchange = e => { loadFile(e.target.files[0]); e.target.value = ''; };
$('#sample').onclick = () => loadSample(0);
$('#sample2').onclick = () => loadSample(state.sampleIdx + 1);
$('#reset-view').onclick = () => state.stats && setView(state.stats.size.x, state.stats.size.y, state.stats.size.z);
$('#dropzone').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } };

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drag-overlay').hidden = false; $('#dropzone').classList.add('hover'); });
window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drag-overlay').hidden = true; $('#dropzone').classList.remove('hover'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#drag-overlay').hidden = true; $('#dropzone').classList.remove('hover');
  loadFile(e.dataTransfer?.files?.[0]);
});

/* ---------------- Quote ---------------- */
function update() {
  if (!state.stats) return;
  const st = state.stats;
  $('#s-size').textContent = `${nf(1).format(st.size.x)} × ${nf(1).format(st.size.y)} × ${nf(1).format(st.size.z)} mm`;
  $('#s-volume').textContent = `${nf(2).format(st.volume / 1000)} cm³`;
  $('#s-area').textContent = `${nf(1).format(st.area / 100)} cm²`;
  $('#s-tris').textContent = nf(0).format(st.triangles);

  const warn = [];
  const fit = fitsBuildVolume(st.size, bv);
  if (!fit.fits) warn.push(['error', `Il modello (${nf(0).format(st.size.x)} × ${nf(0).format(st.size.y)} × ${nf(0).format(st.size.z)} mm) supera il volume di stampa di ${bv.x} × ${bv.y} × ${bv.z} mm. Andrà diviso in parti o scalato: il prezzo è solo indicativo.`]);
  else if (fit.rotatedOnly) warn.push(['info', 'Il modello entra nel piatto solo ruotato di 90°: nessun problema, lo orientiamo noi.']);
  const maxDim = Math.max(st.size.x, st.size.y, st.size.z);
  if (maxDim < 3) warn.push(['warn', 'Il modello è minuscolo: forse il file è in centimetri, metri o pollici? Cambia "Unità del file".']);
  if (Math.abs(st.signedVolume) < 1e-6 || st.volume > st.size.x * st.size.y * st.size.z * 1.001) warn.push(['warn', 'La mesh sembra aperta o non manifold: il volume potrebbe non essere affidabile.']);
  $('#warnings').innerHTML = warn.map(([t, m]) => `<div class="alert ${t}" role="alert">${t === 'info' ? 'ℹ️' : '⚠️'} <span>${m}</span></div>`).join('');

  const r = estimate(st, state, CONFIG);
  state.result = r;
  const mat = CONFIG.materials[state.material];
  $('#q-total').textContent = eur.format(r.net);
  $('#q-vat').textContent = CONFIG.showVat ? `IVA esclusa · ${eur.format(r.gross)} con IVA ${Math.round(CONFIG.vatRate * 100)}%` : 'Totale stimato';
  $('#q-weight').textContent = r.totalGrams >= 1000 ? `${nf(2).format(r.totalGrams / 1000)} kg` : `${nf(0).format(r.totalGrams)} g`;
  $('#q-time').textContent = formatDuration(r.totalSec);
  $('#q-unit').textContent = eur.format((r.net) / r.qty);

  const row = (label, sub, val, cls = '') => `<tr class="${cls}"><td>${label}${sub ? `<small>${sub}</small>` : ''}</td><td>${val}</td></tr>`;
  const rows = [
    row('Materiale', `${mat.label} · ${nf(1).format(r.gramsPerPartWithWaste)} g/pezzo (incl. ${Math.round(CONFIG.materialWaste * 100)}% scarto) × ${r.qty}`, eur.format(r.materialTotal)),
    row('Tempo macchina', `${formatDuration(r.secPerPart)}/pezzo × ${r.qty} · ${eur.format(CONFIG.machineRatePerHour * mat.machineRateMult)}/h`, eur.format(r.machineTotal)),
  ];
  if (r.discount > 0) rows.push(row(`Sconto quantità −${Math.round(r.discountRate * 100)}%`, `da ${r.qty} pezzi`, `−${eur.format(r.discount)}`, 'neg'));
  rows.push(row('Preparazione', 'slicing, controllo, finitura base', eur.format(r.setupFee)));
  if (r.minimumApplied) rows.push(row('Adeguamento ordine minimo', `minimo ${eur.format(CONFIG.minimumOrder)}`, eur.format(r.minimumTopUp)));
  rows.push(row('Totale stimato', 'IVA esclusa', eur.format(r.net), 'sum'));
  $('#q-breakdown tbody').innerHTML = rows.join('');
  $('#request').disabled = false;
}

/* ---------------- Richiedi stampa ---------------- */
function summaryText() {
  const st = state.stats, r = state.result, m = CONFIG.materials[state.material];
  return [
    'Ciao Nebula 3D! Vorrei un preventivo per questa stampa:',
    '',
    `• File: ${state.fileName.replace(/^Esempio · /, '')}`,
    `• Dimensioni: ${nf(1).format(st.size.x)} × ${nf(1).format(st.size.y)} × ${nf(1).format(st.size.z)} mm`,
    `• Volume: ${nf(2).format(st.volume / 1000)} cm³`,
    `• Materiale: ${m.label} · Colore: ${state.color}`,
    `• Riempimento: ${state.infill}% · Layer: ${state.layer} mm · Qualità: ${CONFIG.qualities[state.quality].label}`,
    `• Quantità: ${r.qty}`,
    '',
    `Stima online: ${eur.format(r.net)} + IVA (${eur.format(r.gross)} IVA incl.)`,
    `Filamento ~${nf(0).format(r.totalGrams)} g · Tempo ~${formatDuration(r.totalSec)}`,
    '',
    'Vi invio il file STL in allegato. Grazie!',
  ].join('\n');
}

$('#request').onclick = () => {
  const text = summaryText();
  $('#summary').value = text;
  const to = CONFIG.contact.email || '';
  $('#send-mail').href = `mailto:${to}?subject=${encodeURIComponent('Richiesta stampa 3D – ' + state.fileName.replace(/^Esempio · /, ''))}&body=${encodeURIComponent(text)}`;
  $('#copy-status').textContent = '';
  $('#request-dialog').showModal();
};
$('#send-ig').onclick = async () => {
  const text = $('#summary').value;
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { $('#summary').select(); copied = document.execCommand?.('copy'); }
  $('#copy-status').textContent = copied ? 'Riepilogo copiato: incollalo nella chat Instagram.' : 'Copia il testo qui sopra e incollalo nella chat Instagram.';
  window.open(`https://ig.me/m/${CONFIG.contact.instagram}`, '_blank', 'noopener');
};

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

$('#year').textContent = new Date().getFullYear();
buildControls();

// Debug/test hook: ?sample=1 carica subito l'esempio
const qs = new URLSearchParams(location.search);
if (qs.has('sample')) loadSample(+qs.get('sample') || 0);
window.__nebula = { state, CONFIG };
