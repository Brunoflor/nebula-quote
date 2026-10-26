import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { CONFIG } from './config.js';
import { parseSTL, computeStats, fitsBuildVolume } from './geometry.js';
import { estimateQuote, estimateProject, formatDuration } from './estimate.js';
import { toBinarySTL } from './stl-export.js';

const $ = s => document.querySelector(s);
const nf = (d = 1) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: CONFIG.currency });
const SAMPLES = [
  { file: 'samples/vaso-nebula.stl', name: 'vaso-nebula.stl' },
  { file: 'samples/cubo-20mm.stl', name: 'cubo-20mm.stl' },
];
const SAMPLE_PHOTO = { file: 'samples/foto-razzo.jpg', name: 'foto-razzo.jpg' };
const UNIT_SCALE = { mm: 1, cm: 10, in: 25.4 };
const P3D = CONFIG.photoTo3D;
const qs = new URLSearchParams(location.search);

const state = {
  mode: 'stl',                         // 'stl' | 'photo'
  tech: CONFIG.defaultTechnology,      // 'fdm' | 'resin'
  settings: {
    fdm: { material: CONFIG.defaults.material, infill: CONFIG.defaults.infill, layer: CONFIG.defaults.layer, quality: CONFIG.defaults.quality, color: CONFIG.defaults.color },
    resin: { ...CONFIG.resin.defaults },
  },
  quantity: CONFIG.defaults.quantity, unit: CONFIG.defaults.unit,
  // un modello per modalità, così passando da STL a foto non si perde nulla
  models: { stl: null, photo: null },  // { pos (mm), stats, fileName, ... }
  sampleIdx: -1, result: null, projectResult: null, generating: null,
  parts: [],           // progetto: ogni parte ha modello, tecnologia e impostazioni propri
  activeId: null,
  pendingNew: false,   // in attesa del file della prossima parte
  seq: 0,
};
const cur = () => state.settings[state.tech];
const model = () => state.models[state.mode];
const techCfg = () => state.tech === 'resin'
  ? { materials: CONFIG.resin.materials, layerHeights: CONFIG.resin.layerHeights, colors: CONFIG.resin.colors, buildVolume: CONFIG.resin.buildVolume }
  : { materials: CONFIG.materials, layerHeights: CONFIG.layerHeights, colors: CONFIG.colors, buildVolume: CONFIG.buildVolume };

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

let plate = null, volBox = null;
function buildPlate() {
  if (plate) { scene.remove(plate); plate.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
  const bv = techCfg().buildVolume;
  plate = new THREE.Group(); scene.add(plate);
  const step = state.tech === 'resin' ? 10 : 16;
  const grid = new THREE.GridHelper(Math.max(bv.x, bv.y), Math.round(Math.max(bv.x, bv.y) / step), 0x6d5bd0, 0x2a2550);
  grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.55; plate.add(grid);
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(bv.x, bv.y), new THREE.MeshBasicMaterial({ color: state.tech === 'resin' ? 0x1d2430 : 0x1a1630, transparent: true, opacity: 0.6 }));
  plateMesh.position.z = -0.05; plate.add(plateMesh);
  volBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bv.x, bv.y, bv.z)), new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.25 }));
  volBox.position.z = bv.z / 2; plate.add(volBox);
}
buildPlate();

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

function updateFitBox() {
  const m = model(); if (!m || !volBox) return;
  const fit = fitsBuildVolume(m.stats.size, techCfg().buildVolume);
  volBox.material.color.set(fit.fits ? 0x8b5cf6 : 0xf87171); volBox.material.opacity = fit.fits ? 0.25 : 0.8;
}

function showModel(pos, stats, { keepView = false } = {}) {
  clearMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.translate(-(stats.min.x + stats.max.x) / 2, -(stats.min.y + stats.max.y) / 2, -stats.min.z); // centrato sul piatto
  g.computeVertexNormals();
  mesh = new THREE.Mesh(g, material);
  scene.add(mesh);
  updateFitBox();
  if (!keepView) { controls.autoRotate = true; setView(stats.size.x, stats.size.y, stats.size.z); }
}
function clearMesh() { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh = null; } }

/* ---------------- UI controls ---------------- */
function buildTech() {
  const el = $('#tech');
  for (const [id, t] of Object.entries(CONFIG.technologies)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t.label; b.dataset.id = id; b.setAttribute('role', 'radio');
    b.onclick = () => setTech(id);
    el.append(b);
  }
}

function buildTechControls() {
  const tc = techCfg();
  const mats = $('#materials'); mats.innerHTML = '';
  mats.classList.toggle('seg-resin', state.tech === 'resin');
  for (const [id, m] of Object.entries(tc.materials)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = m.label; b.dataset.id = id; b.setAttribute('role', 'radio');
    b.onclick = () => { cur().material = id; syncControls(); update(); };
    mats.append(b);
  }
  const layer = $('#layer'); layer.innerHTML = '';
  for (const [id, l] of Object.entries(tc.layerHeights)) layer.add(new Option(l.label, id));
  const sw = $('#colors'); sw.innerHTML = '';
  for (const c of tc.colors) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', c.name); b.setAttribute('role', 'radio'); b.dataset.name = c.name;
    b.onclick = () => { cur().color = c.name; syncControls(); update(); };
    sw.append(b);
  }
  document.querySelectorAll('[data-tech]').forEach(el => { el.hidden = el.dataset.tech !== state.tech; });
}

function buildControls() {
  buildTech();
  const quality = $('#quality');
  for (const [id, q] of Object.entries(CONFIG.qualities)) quality.add(new Option(`${q.label} · ${q.walls} pareti`, id));
  $('#infill').oninput = e => { state.settings.fdm.infill = +e.target.value; syncControls(); update(); };
  $('#layer').onchange = e => { cur().layer = e.target.value; update(); };
  quality.onchange = e => { state.settings.fdm.quality = e.target.value; update(); };
  $('#hollow').onchange = e => { state.settings.resin.hollow = e.target.checked; syncControls(); update(); };
  const wall = $('#wall');
  wall.min = CONFIG.resin.minWallMm; wall.max = CONFIG.resin.maxWallMm;
  wall.oninput = () => { const v = parseFloat(String(wall.value).replace(',', '.')); if (v > 0) { state.settings.resin.wall = Math.min(CONFIG.resin.maxWallMm, Math.max(CONFIG.resin.minWallMm, v)); update(); } };
  wall.onblur = () => { wall.value = state.settings.resin.wall; };
  $('#unit').onchange = e => {
    state.unit = e.target.value;
    if (state.pendingNew) return;
    const part = activePart();
    if (part?.source === 'stl' && state.models.stl && part.model === state.models.stl) analyseStl();
  };
  const qty = $('#quantity');
  qty.oninput = () => { state.quantity = clampQty(qty.value); update(); };
  qty.onblur = () => { qty.value = state.quantity; };
  document.querySelectorAll('.stepper button').forEach(b => b.onclick = () => {
    state.quantity = clampQty(state.quantity + +b.dataset.step); qty.value = state.quantity; update();
  });
  buildTechControls();
  syncControls();
}
const clampQty = v => Math.min(999, Math.max(1, Math.floor(+v || 1)));

function setTech(id) {
  if (id === state.tech || !CONFIG.technologies[id]) return;
  state.tech = id;
  buildTechControls(); buildPlate(); updateFitBox(); syncControls(); update();
}

function syncControls() {
  const s = cur(), tc = techCfg();
  document.querySelectorAll('#tech button').forEach(b => b.setAttribute('aria-checked', b.dataset.id === state.tech));
  document.querySelectorAll('#materials button').forEach(b => b.setAttribute('aria-checked', b.dataset.id === s.material));
  document.querySelectorAll('#colors button').forEach(b => b.setAttribute('aria-checked', b.dataset.name === s.color));
  const m = tc.materials[s.material];
  $('#material-note').textContent = `${m.note} · ${nf(2).format(m.density)} g/cm³ · ${eur.format(m.pricePerKg)}/kg`;
  $('#layer').value = s.layer;
  if (state.tech === 'fdm') {
    $('#infill').value = s.infill; $('#infill-out').textContent = `${s.infill}%`; $('#quality').value = s.quality;
  } else {
    $('#hollow').checked = !!s.hollow; $('#wall').value = s.wall; $('#wall').disabled = !s.hollow;
  }
  $('#unit').value = state.unit;
  $('#quantity').value = state.quantity;
  $('#color-out').textContent = s.color;
  $('#k-weight').textContent = state.tech === 'resin' ? 'Resina' : 'Filamento';
  material.color.set(tc.colors.find(c => c.name === s.color)?.hex || '#8b5cf6');
}

/* ---------------- Modalità: STL / foto ---------------- */
const MODE_UI = {
  stl: { title: 'Trascina qui il tuo file STL', pick: 'Scegli file', sample: 'Prova con un esempio', hint: 'STL binario o ASCII · elaborato in locale', accept: '.stl,model/stl,application/sla', change: 'Cambia file' },
  photo: { title: 'Trascina qui la foto di un oggetto', pick: 'Scegli foto', sample: 'Prova con una foto di esempio', hint: 'JPG, PNG o WEBP · un solo oggetto, intero, su sfondo semplice · il modello 3D viene generato con l\'IA', accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif', change: 'Cambia foto' },
};

function applyModeChrome(mode) {
  const ui = MODE_UI[mode];
  $('#mode-stl').setAttribute('aria-selected', mode === 'stl');
  $('#mode-photo').setAttribute('aria-selected', mode === 'photo');
  $('#dz-title').textContent = state.pendingNew
    ? (mode === 'stl' ? 'Trascina il file STL della nuova parte' : 'Trascina la foto della nuova parte')
    : ui.title;
  $('#dz-pick').textContent = ui.pick;
  $('#sample').textContent = ui.sample;
  $('#dz-hint').textContent = ui.hint;
  $('#file').accept = ui.accept;
  $('#file2').accept = ui.accept;
  $('#change-label').textContent = ui.change;
  $('#sample2').textContent = mode === 'stl' ? 'Altro esempio' : 'Foto di esempio';
  $('#unit-field').hidden = mode === 'photo';
  const anyPhoto = mode === 'photo' || state.parts.some(p => p.source === 'photo');
  $('#ai-disclaimer').hidden = !anyPhoto;
}

function setMode(mode) {
  if (state.generating) cancelGeneration();
  state.mode = mode;
  applyModeChrome(mode);
  if (state.pendingNew) {
    clearMesh();
    $('#dropzone').hidden = false;
    $('#viewer-toolbar').hidden = true;
    $('#photo-card').hidden = true;
    $('#add-banner').hidden = false;
    update();
    return;
  }
  const m = model();
  const linked = m && state.parts.find(p => p.model === m);
  if (linked) { selectPart(linked.id); return; }
  if (m?.stats) {
    adoptModel(m, { fresh: false });
    showModel(m.pos, m.stats);
    showLoaded(m.fileName);
    $('#photo-card').hidden = mode !== 'photo';
    update();
    return;
  }
  clearMesh();
  $('#dropzone').hidden = false;
  $('#viewer-toolbar').hidden = true;
  $('#photo-card').hidden = true;
  if (!state.parts.length) resetQuote();
  else update();
}

function showLoaded(name) {
  $('#dropzone').hidden = true; $('#viewer-toolbar').hidden = false;
  $('#filename').textContent = name; $('#filename').title = name;
}

function resetQuote() {
  state.result = null;
  state.projectResult = null;
  for (const id of ['#s-size', '#s-volume', '#s-area', '#s-tris', '#q-weight', '#q-time', '#q-unit']) $(id).textContent = '—';
  $('#q-total').textContent = '— €';
  $('#q-vat').textContent = state.mode === 'photo' ? 'Carica la foto di un oggetto per iniziare' : 'Carica un modello per iniziare';
  $('#q-breakdown tbody').innerHTML = '<tr><td colspan="2" class="muted">Nessun modello caricato</td></tr>';
  $('#warnings').innerHTML = '';
  $('#request').disabled = true;
  const unitLabel = $('#k-unit'); if (unitLabel) unitLabel.textContent = 'Per pezzo';
  const quoteTitle = $('#quote-title'); if (quoteTitle) quoteTitle.textContent = 'Preventivo';
  renderPartList(null);
}

/* ---------------- Caricamento STL ---------------- */
async function loadBuffer(buffer, name) {
  $('#loading').hidden = false;
  await new Promise(r => setTimeout(r, 20)); // lascia disegnare lo spinner
  try {
    const raw = parseSTL(buffer);
    if (raw.length < 9) throw new Error('Il file non contiene triangoli');
    state.models.stl = { raw, fileName: name };
    analyseStl({ fresh: true });
    showLoaded(name);
  } catch (err) {
    console.warn(err);
    toast(`Impossibile leggere il file: ${err.message}`);
  } finally { $('#loading').hidden = true; }
}

function analyseStl({ fresh = false } = {}) {
  const m = state.models.stl;
  if (!m) return;
  const s = UNIT_SCALE[state.unit] || 1;
  m.pos = s === 1 ? m.raw : m.raw.map(v => v * s);
  m.stats = computeStats(m.pos);
  adoptModel(m, { fresh });
  if (state.mode === 'stl') {
    showModel(m.pos, m.stats);
    showLoaded(m.fileName);
    $('#photo-card').hidden = true;
  }
  update();
}

async function loadFiles(files) {
  const list = [...files].filter(Boolean);
  if (!list.length) return;
  if (list.length === 1) return loadFile(list[0]);
  const stls = list.filter(f => /\.stl$/i.test(f.name));
  if (stls.length < 2) {
    await loadFile(list[0]);
    toast('Le foto si aggiungono una alla volta: usa «Aggiungi parte» per le altre');
    return;
  }
  if (state.mode !== 'stl') { state.mode = 'stl'; applyModeChrome('stl'); }
  const addingOntoExisting = state.parts.length > 0;
  for (let i = 0; i < stls.length; i++) {
    if (i > 0 || addingOntoExisting || state.pendingNew) {
      state.pendingNew = true;
      state.quantity = 1;
      if (state.parts.some(p => p.settings === state.settings)) state.settings = cloneSettings(state.settings);
    }
    await loadBuffer(await stls[i].arrayBuffer(), stls[i].name);
  }
  if (list.length !== stls.length) toast('Aggiunti i file STL. Le foto si caricano una alla volta');
  else toast(`${stls.length} parti aggiunte al progetto`);
}

const IMAGE_RE = /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp)$/i;
async function loadFile(file) {
  if (!file) return;
  const isImage = file.type?.startsWith('image/') || IMAGE_RE.test(file.name);
  const isStl = /\.stl$/i.test(file.name);
  if (state.mode === 'stl' && isImage) { setMode('photo'); }
  else if (state.mode === 'photo' && isStl) { setMode('stl'); }
  if (state.mode === 'stl') {
    if (!isStl) { toast('Carica un file con estensione .stl (oppure passa a "Da foto")'); return; }
    if (file.size > 200 * 1024 * 1024) { toast('File troppo grande (max 200 MB)'); return; }
    loadBuffer(await file.arrayBuffer(), file.name);
  } else {
    if (!isImage) { toast('Carica una foto JPG, PNG o WEBP'); return; }
    if (file.size > 25 * 1024 * 1024) { toast('Foto troppo grande (max 25 MB)'); return; }
    generate(file, file.name);
  }
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

async function loadSamplePhoto() {
  try {
    const res = await fetch(SAMPLE_PHOTO.file);
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    generate(new File([blob], SAMPLE_PHOTO.name, { type: blob.type || 'image/jpeg' }), `Esempio · ${SAMPLE_PHOTO.name}`);
  } catch { toast('Impossibile caricare la foto di esempio: avvia il sito da un server web (vedi README)'); }
}

/* ---------------- Da foto → 3D (IA) ---------------- */
let photo3d = null;
const loadPhoto3d = () => (photo3d ??= import('./photo3d.js'));

function fmtSec(s) { s = Math.max(1, Math.round(s)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; }

function renderGenStatus(st, gen) {
  const label = st.space?.label || '';
  const service = `Servizio: ${label} su Hugging Face${st.fallback || gen.fallback ? ' (riserva)' : ''} · modello generato con IA`;
  $('#gen-service').textContent = service;
  const elapsed = (performance.now() - gen.t0) / 1000;
  let msg = '', pct = null;
  switch (st.stage) {
    case 'connecting': msg = `Collegamento a ${label}…`; pct = 3; break;
    case 'queue':
      msg = `In coda: posizione ${st.position}${st.eta ? ` · attesa stimata ~${fmtSec(st.eta)}` : ''}`;
      gen.expected = Math.max(gen.expected, elapsed + (st.eta || 0) + (st.space?.typicalSeconds || 20)); break;
    case 'processing':
      gen.expected = Math.max(gen.expected, elapsed + Math.max(st.eta || 0, (st.space?.typicalSeconds || 20) * 0.8));
      msg = `Elaborazione sulla GPU… tempo stimato ~${fmtSec(Math.max(3, gen.expected - elapsed))}`; break;
    case 'download': msg = 'Download del modello 3D…'; pct = 92; break;
    case 'parsing': msg = 'Preparazione della mesh stampabile…'; pct = 97; break;
    case 'fallback': gen.fallback = true; gen.expected = elapsed + (st.space?.typicalSeconds || 30) + 5; msg = `${st.reason} Provo con il servizio di riserva (${label})…`; pct = 5; break;
  }
  if (pct == null) pct = Math.min(90, 5 + 85 * elapsed / Math.max(gen.expected, 1));
  gen.pct = Math.max(gen.pct || 0, pct);
  $('#gen-status').textContent = msg;
  $('#gen-bar').style.width = `${gen.pct}%`;
}

async function generate(file, name) {
  if (state.generating) cancelGeneration();
  const ctrl = new AbortController();
  const gen = { ctrl, t0: performance.now(), expected: P3D.spaces[0].typicalSeconds + 5, pct: 0, fallback: false, file, name };
  state.generating = gen;
  const thumbUrl = URL.createObjectURL(file);
  $('#gen-thumb').src = thumbUrl;
  $('#gen').hidden = false; $('#dropzone').hidden = true;
  $('#gen-status').textContent = 'Preparazione della foto…'; $('#gen-bar').style.width = '2%'; $('#gen-service').textContent = '';
  const tick = setInterval(() => { if (gen.last) renderGenStatus(gen.last, gen); }, 1000);
  try {
    const { generateFromPhoto } = await loadPhoto3d();
    const mock = qs.has('mock3d') || window.__nebulaMock3D ? { glbUrl: 'tests/fixtures/razzo-generato.glb', delayMs: 300, failFirst: qs.get('mock3d') === 'fail1', cfgSpaces: P3D.spaces } : null;
    const out = await generateFromPhoto(file, { cfg: P3D, signal: ctrl.signal, mock, onStatus: st => { gen.last = st; renderGenStatus(st, gen); } });
    if (state.generating !== gen) return;
    const old = state.models.photo;
    if (old?.thumbUrl && !state.parts.some(p => p.model && p.model !== old && p.model.thumbUrl === old.thumbUrl)) URL.revokeObjectURL(old.thumbUrl);
    state.models.photo = {
      unitPos: out.positions, fileName: `${name.replace(/\.[^.]+$/, '')} · 3D da foto (IA)`, photoName: name.replace(/^Esempio · /, ''),
      file, thumbUrl, space: out.space, seconds: out.seconds, attempts: out.attempts,
      sizeMm: +$('#photo-size').value || P3D.defaultSizeMm, sizeMode: $('#photo-size-mode').value || P3D.defaultSizeMode,
    };
    $('#photo-thumb').src = thumbUrl;
    await analysePhoto({ fresh: true });
    if (state.mode === 'photo') { showLoaded(state.models.photo.fileName); $('#photo-card').hidden = false; }
    $('#photo-meta').textContent = `Generato con ${out.space.label}${out.attempts.length > 1 ? ' (servizio di riserva)' : ''} in ${fmtSec(out.seconds)} · ${nf(0).format(state.models.photo.stats.triangles)} triangoli`;
    console.info(`[foto→3D] ok con ${out.space.id} in ${out.seconds.toFixed(1)} s`, out.attempts);
    window.__nebulaLastGeneration = { space: out.space.id, seconds: out.seconds, attempts: out.attempts, triangles: state.models.photo.stats.triangles };
  } catch (e) {
    if (state.generating !== gen) return;
    URL.revokeObjectURL(thumbUrl);
    if (e.kind !== 'abort') {
      console.warn('[foto→3D] fallito', e, e.attempts);
      window.__nebulaLastGeneration = { error: e.message, attempts: e.attempts };
      showError(e);
    }
    if (!state.models.photo) $('#dropzone').hidden = false;
  } finally {
    clearInterval(tick);
    if (state.generating === gen) { state.generating = null; $('#gen').hidden = true; }
  }
}

function cancelGeneration() {
  const g = state.generating; if (!g) return;
  state.generating = null; g.ctrl.abort(); $('#gen').hidden = true;
  if (!model()) $('#dropzone').hidden = false;
}

function showError(e) {
  const tried = (e.attempts || []).map(a => `${a.space}: ${a.error}`).join(' · ');
  const tips = e.kind === 'quota' ? '' : ' Riprova tra qualche minuto, usa un\'altra foto (oggetto intero, sfondo semplice) oppure carica direttamente un file STL.';
  $('#warnings').innerHTML = `<div class="alert error" role="alert">⚠️ <span><strong>Non è stato possibile generare il modello 3D.</strong> ${e.message}${tips}${tried && (e.attempts?.length > 1) ? `<br><small>Tentativi: ${tried}</small>` : ''}</span></div>`;
  toast('Generazione del modello 3D non riuscita');
}

async function analysePhoto({ fresh = false, keepView = false } = {}) {
  const m = state.models.photo; if (!m) return;
  const { scaleToSize } = await loadPhoto3d();
  m.pos = scaleToSize(m.unitPos, m.sizeMm, m.sizeMode);
  m.stats = computeStats(m.pos);
  adoptModel(m, { fresh });
  if (state.mode === 'photo' && !state.pendingNew) {
    showModel(m.pos, m.stats, { keepView });
    showLoaded(m.fileName);
    syncPhotoCard(activePart());
  }
  update();
}

$('#photo-size').oninput = () => {
  if (state.pendingNew) return;
  const v = parseFloat(String($('#photo-size').value).replace(',', '.'));
  const m = state.models.photo; if (!m || !(v >= 1 && v <= 2000)) return;
  m.sizeMm = v; analysePhoto({ keepView: true });
};
$('#photo-size').onblur = () => { const m = state.models.photo; if (m) $('#photo-size').value = m.sizeMm; };
$('#photo-size-mode').onchange = e => {
  if (state.pendingNew) return;
  const m = state.models.photo; if (!m) return;
  m.sizeMode = e.target.value; analysePhoto({ keepView: true });
};
$('#download-stl').onclick = () => {
  const m = state.models.photo; if (!m) return;
  const st = m.stats, pos = new Float32Array(m.pos.length);
  const cx = (st.min.x + st.max.x) / 2, cy = (st.min.y + st.max.y) / 2;
  for (let i = 0; i < pos.length; i += 3) { pos[i] = m.pos[i] - cx; pos[i + 1] = m.pos[i + 1] - cy; pos[i + 2] = m.pos[i + 2] - st.min.z; }
  const blob = new Blob([toBinarySTL(pos, `Nebula 3D - generato con IA da foto - ${m.photoName}`)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${m.photoName.replace(/\.[^.]+$/, '')}-nebula3d-${Math.round(m.sizeMm)}mm.stl`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('#regen').onclick = () => { const m = state.models.photo; if (m) generate(m.file, m.photoName); };
$('#gen-cancel').onclick = cancelGeneration;

/* ---------------- Eventi ---------------- */
$('#file').onchange = e => { loadFiles(e.target.files); e.target.value = ''; };
$('#file2').onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadFile(f); };
$('#sample').onclick = () => state.mode === 'stl' ? loadSample(0) : loadSamplePhoto();
$('#sample2').onclick = () => state.mode === 'stl' ? loadSample(state.sampleIdx + 1) : loadSamplePhoto();
$('#reset-view').onclick = () => { const m = model(); if (m) setView(m.stats.size.x, m.stats.size.y, m.stats.size.z); };
$('#dropzone').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } };
$('#mode-stl').onclick = () => state.mode !== 'stl' && setMode('stl');
$('#mode-photo').onclick = () => state.mode !== 'photo' && setMode('photo');

let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('#drag-overlay').hidden = false; $('#dropzone').classList.add('hover'); });
window.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drag-overlay').hidden = true; $('#dropzone').classList.remove('hover'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#drag-overlay').hidden = true; $('#dropzone').classList.remove('hover');
  loadFiles(e.dataTransfer?.files || []);
});

/* ---------------- Progetto: più parti ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rowHtml = (label, sub, val, cls = '') => `<tr class="${cls}"><td>${label}${sub ? `<small>${sub}</small>` : ''}</td><td>${val}</td></tr>`;
function activePart() { return state.parts.find(p => p.id === state.activeId) || null; }
function cloneSettings(s) { return { fdm: { ...s.fdm }, resin: { ...s.resin } }; }
function cloneModel(m) {
  const copy = { ...m };
  if (m.pos) copy.pos = new Float32Array(m.pos);
  return copy;
}
function partName(part) { return (part.model?.fileName || 'Parte').replace(/^Esempio · /, ''); }
function optsOf(part) { return { tech: part.tech, quantity: part.quantity, ...part.settings[part.tech] }; }
function matsOf(tech) { return tech === 'resin' ? CONFIG.resin.materials : CONFIG.materials; }
function formatGrams(g) { return g >= 1000 ? `${nf(2).format(g / 1000)} kg` : `${nf(0).format(g)} g`; }

function createPart(m) {
  let settings = state.settings;
  if (state.parts.some(p => p.settings === settings)) settings = cloneSettings(settings);
  const part = {
    id: ++state.seq,
    source: state.mode,
    model: m,
    tech: state.tech,
    quantity: state.quantity,
    unit: state.unit,
    settings,
  };
  state.settings = settings;
  return part;
}

function adoptModel(m, { fresh = false } = {}) {
  const active = activePart();
  if (fresh && state.pendingNew) {
    const part = createPart(m);
    state.parts.push(part);
    state.activeId = part.id;
    state.pendingNew = false;
    $('#add-banner').hidden = true;
    return part;
  }
  if (fresh && active && active.source === state.mode) {
    active.model = m;
    return active;
  }
  if (active && active.model === m) return active;
  const found = state.parts.find(p => p.model === m);
  if (found) { state.activeId = found.id; return found; }
  const part = createPart(m);
  state.parts.push(part);
  state.activeId = part.id;
  return part;
}

function syncActiveFromForm() {
  if (state.pendingNew) return;
  const part = activePart();
  const m = model();
  if (!part || !m?.stats || part.model !== m) return;
  part.tech = state.tech;
  part.quantity = state.quantity;
  part.unit = state.unit;
}

function selectPart(id, { scroll = false } = {}) {
  const part = state.parts.find(p => p.id === id);
  if (!part) return;
  state.pendingNew = false;
  $('#add-banner').hidden = true;
  state.activeId = part.id;
  state.settings = part.settings;
  state.tech = part.tech;
  state.quantity = part.quantity;
  state.unit = part.unit || 'mm';
  state.mode = part.source;
  state.models[part.source] = part.model;
  applyModeChrome(part.source);
  buildTechControls();
  buildPlate();
  syncControls();
  showModel(part.model.pos, part.model.stats);
  showLoaded(partName(part));
  syncPhotoCard(part);
  update();
  if (scroll) document.querySelector('.settings')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function syncPhotoCard(part) {
  const show = !!(part && part.source === 'photo' && part.model && state.mode === 'photo' && !state.pendingNew);
  $('#photo-card').hidden = !show;
  if (!show) return;
  const m = part.model;
  if (m.thumbUrl) $('#photo-thumb').src = m.thumbUrl;
  $('#photo-size').value = m.sizeMm;
  $('#photo-size-mode').value = m.sizeMode;
  if (m.space) {
    $('#photo-meta').textContent = `Generato con ${m.space.label}${m.attempts?.length > 1 ? ' (servizio di riserva)' : ''}${m.seconds ? ` in ${fmtSec(m.seconds)}` : ''} · ${nf(0).format(m.stats.triangles)} triangoli`;
  }
}

function beginAddPart() {
  if (!state.parts.length || state.pendingNew) {
    if (state.pendingNew) toast('Carica il file della nuova parte, oppure annulla');
    return;
  }
  const base = activePart() || state.parts[state.parts.length - 1];
  state.pendingNew = true;
  state.settings = cloneSettings(base.settings);
  state.tech = base.tech;
  state.quantity = 1;
  state.unit = base.unit || state.unit;
  buildTechControls();
  buildPlate();
  syncControls();
  clearMesh();
  $('#viewer-toolbar').hidden = true;
  $('#photo-card').hidden = true;
  $('#dropzone').hidden = false;
  $('#add-banner').hidden = false;
  applyModeChrome(state.mode);
  update();
  $('#dropzone').focus();
}

function cancelAdd() {
  if (!state.pendingNew) return;
  const part = activePart() || state.parts[0];
  if (part) selectPart(part.id);
  else { state.pendingNew = false; $('#add-banner').hidden = true; }
}

function duplicatePart(id) {
  const src = state.parts.find(p => p.id === id);
  if (!src) return;
  const model = cloneModel(src.model);
  model.fileName = `${src.model.fileName} (copia)`;
  const savedMode = state.mode;
  state.mode = src.source;
  state.tech = src.tech;
  state.quantity = src.quantity;
  state.unit = src.unit;
  state.settings = cloneSettings(src.settings);
  const part = createPart(model);
  state.mode = savedMode;
  state.parts.splice(state.parts.indexOf(src) + 1, 0, part);
  selectPart(part.id);
  toast('Parte duplicata');
}

function removePart(id) {
  const idx = state.parts.findIndex(p => p.id === id);
  if (idx < 0) return;
  const removed = state.parts[idx];
  state.parts.splice(idx, 1);
  if (removed.model?.thumbUrl && !state.parts.some(p => p.model?.thumbUrl === removed.model.thumbUrl)) {
    URL.revokeObjectURL(removed.model.thumbUrl);
  }
  if (state.models[removed.source] === removed.model) {
    const other = [...state.parts].reverse().find(p => p.source === removed.source);
    state.models[removed.source] = other?.model || null;
  }
  if (!state.parts.length) {
    state.activeId = null;
    state.pendingNew = false;
    state.models.stl = null;
    state.models.photo = null;
    state.settings = cloneSettings(removed.settings);
    state.tech = removed.tech;
    state.quantity = removed.quantity;
    state.unit = removed.unit || 'mm';
    $('#add-banner').hidden = true;
    clearMesh();
    $('#dropzone').hidden = false;
    $('#viewer-toolbar').hidden = true;
    $('#photo-card').hidden = true;
    applyModeChrome(state.mode);
    buildTechControls();
    syncControls();
    resetQuote();
    toast('Parte rimossa');
    return;
  }
  selectPart(state.parts[Math.min(idx, state.parts.length - 1)].id);
  toast('Parte rimossa');
}

function partMeta(part, line) {
  const s = part.settings[part.tech];
  const mat = matsOf(part.tech)[s.material];
  const weight = part.tech === 'resin' ? `${nf(0).format(line.totalMl)} ml` : formatGrams(line.totalGrams);
  const detail = part.tech === 'resin'
    ? (s.hollow ? `svuotato ${nf(1).format(line.wall)} mm` : 'pieno')
    : `${s.infill}% · ${CONFIG.qualities[s.quality].label}`;
  const disc = line.discount > 0 ? ` · sconto ${Math.round(line.discountRate * 100)}%` : '';
  return `${CONFIG.technologies[part.tech].label} · ${mat?.label || ''} · ${detail} · ×${line.qty} · ${weight} · ${formatDuration(line.totalSec)}${disc}`;
}

function renderPartList(project) {
  const ol = $('#project-list');
  if (!ol) return;
  ol.replaceChildren();
  const n = state.parts.length;
  const empty = $('#project-empty');
  const rules = $('#project-rules');
  const add = $('#add-part');
  if (empty) empty.hidden = n > 0;
  if (rules) rules.hidden = n === 0;
  if (add) add.disabled = n === 0 || state.pendingNew;
  const title = $('#settings-title');
  const active = activePart();
  if (title) {
    if (state.pendingNew) title.textContent = 'Impostazioni · nuova parte';
    else if (n > 1 && active) title.textContent = `Impostazioni · parte ${state.parts.indexOf(active) + 1} di ${n}`;
    else title.textContent = 'Impostazioni';
  }
  const count = $('#project-count');
  if (count) count.textContent = n === 0 ? 'Nessuna parte' : n === 1 ? '1 parte' : `${n} parti`;
  if (!project) return;
  state.parts.forEach((part, i) => {
    const line = project.lines[i];
    const li = document.createElement('li');
    const on = part.id === state.activeId && !state.pendingNew;
    li.className = 'part' + (on ? ' active' : '');
    li.dataset.id = String(part.id);
    li.tabIndex = 0;
    li.setAttribute('aria-current', on ? 'true' : 'false');
    const top = document.createElement('div');
    top.className = 'part-top';
    const name = document.createElement('span');
    name.className = 'part-name';
    name.textContent = `${i + 1}. ${partName(part)}`;
    const costWrap = document.createElement('span');
    costWrap.className = 'part-cost';
    costWrap.textContent = eur.format(line.lineNet);
    costWrap.title = 'Costo della parte, IVA esclusa, senza preparazione né ordine minimo';
    top.append(name, costWrap);
    const meta = document.createElement('p');
    meta.className = 'part-meta';
    meta.textContent = partMeta(part, line);
    const actions = document.createElement('div');
    actions.className = 'part-actions';
    for (const [label, act] of [['Modifica', 'edit'], ['Duplica', 'dup'], ['Rimuovi', 'del']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.act = act; b.textContent = label;
      actions.append(b);
    }
    li.append(top, meta, actions);
    ol.append(li);
  });
}

function onPartListClick(e) {
  const li = e.target.closest('.part');
  if (!li) return;
  const id = +li.dataset.id;
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'dup') { duplicatePart(id); return; }
  if (act === 'del') { removePart(id); return; }
  selectPart(id, { scroll: act === 'edit' });
}
/* ---------------- Preventivo ---------------- */
function renderModelStats(m) {
  const st = m.stats;
  $('#s-size').textContent = `${nf(1).format(st.size.x)} × ${nf(1).format(st.size.y)} × ${nf(1).format(st.size.z)} mm`;
  $('#s-volume').textContent = `${nf(2).format(st.volume / 1000)} cm³`;
  $('#s-area').textContent = `${nf(1).format(st.area / 100)} cm²`;
  $('#s-tris').textContent = nf(0).format(st.triangles);
  const warn = [];
  const techName = state.tech === 'resin' ? 'della stampante a resina' : 'di stampa';
  const bv = techCfg().buildVolume;
  const fit = fitsBuildVolume(st.size, bv);
  if (!fit.fits) warn.push(['error', `Il modello (${nf(0).format(st.size.x)} × ${nf(0).format(st.size.y)} × ${nf(0).format(st.size.z)} mm) supera il volume ${techName} di ${bv.x} × ${bv.y} × ${bv.z} mm. ${state.mode === 'photo' ? 'Riduci la misura reale qui sotto' : 'Andrà diviso in parti o scalato'}: il prezzo è solo indicativo.`]);
  else if (fit.rotatedOnly) warn.push(['info', 'Il modello entra nel piatto solo ruotato di 90°: nessun problema, lo orientiamo noi.']);
  const maxDim = Math.max(st.size.x, st.size.y, st.size.z);
  if (state.mode === 'stl' && maxDim < 3) warn.push(['warn', 'Il modello è minuscolo: forse il file è in centimetri, metri o pollici? Cambia "Unità del file".']);
  if (Math.abs(st.signedVolume) < 1e-6 || st.volume > st.size.x * st.size.y * st.size.z * 1.001) warn.push(['warn', 'La mesh sembra aperta o non manifold: il volume potrebbe non essere affidabile.']);
  if (state.mode === 'photo') warn.push(['info', 'Modello generato con IA dalla foto: forma e volume sono approssimativi. Controllalo nell\'anteprima prima di ordinare.']);
  $('#warnings').innerHTML = warn.map(([t, msg]) => `<div class="alert ${t}" role="alert">${t === 'info' ? 'ℹ️' : '⚠️'} <span>${msg}</span></div>`).join('');
}
function clearModelStats() {
  for (const id of ['#s-size', '#s-volume', '#s-area', '#s-tris']) $(id).textContent = '—';
  $('#warnings').innerHTML = '';
}

function projectWeight(project) {
  const resinLines = project.lines.filter(l => l.tech === 'resin');
  const fdmLines = project.lines.filter(l => l.tech !== 'resin');
  if (resinLines.length && !fdmLines.length) {
    return { label: 'Resina', value: `${nf(0).format(project.totalMl)} ml`, title: `${formatGrams(project.totalGrams)} di resina` };
  }
  if (!resinLines.length) return { label: 'Filamento', value: formatGrams(project.totalGrams), title: '' };
  const fdmG = fdmLines.reduce((s, l) => s + l.totalGrams, 0);
  return { label: 'Materiale', value: `${formatGrams(fdmG)} + ${nf(0).format(project.totalMl)} ml`, title: `${formatGrams(project.totalGrams)} complessivi, filamento più resina` };
}

function renderSingleBreakdown(r, part) {
  const s = part.settings[part.tech];
  const mat = matsOf(part.tech)[s.material];
  let rows;
  if (r.tech === 'resin') {
    const R = CONFIG.resin, lh = R.layerHeights[s.layer];
    rows = [
      rowHtml('Resina', `${mat.label} · ${s.hollow ? `svuotato, parete ${nf(1).format(r.wall)} mm` : 'pieno'} · ${nf(1).format(r.mlPerPartWithWaste)} ml/pezzo (incl. ${Math.round(R.supportWaste * 100)}% supporti) × ${r.qty}`, eur.format(r.materialTotal)),
      rowHtml('Tempo macchina', `${nf(0).format(r.layers)} layer × ${nf(1).format(lh.secondsPerLayer)} s + preparazione = ${formatDuration(r.plateSec)}${r.plates > 1 ? ` × ${r.plates} stampe` : r.qty > 1 ? ` · ${r.qty} pezzi insieme sul piatto` : ''} · ${eur.format(R.machineRatePerHour)}/h`, eur.format(r.machineTotal)),
      rowHtml('Post-produzione', `lavaggio e polimerizzazione UV · ${eur.format(R.postProcessPerPart)} × ${r.qty}`, eur.format(r.postTotal)),
    ];
  } else {
    rows = [
      rowHtml('Materiale', `${mat.label} · ${nf(1).format(r.gramsPerPartWithWaste)} g/pezzo (incl. ${Math.round(CONFIG.materialWaste * 100)}% scarto) × ${r.qty}`, eur.format(r.materialTotal)),
      rowHtml('Tempo macchina', `${formatDuration(r.secPerPart)}/pezzo × ${r.qty} · ${eur.format(CONFIG.machineRatePerHour * mat.machineRateMult)}/h`, eur.format(r.machineTotal)),
    ];
  }
  if (r.discount > 0) rows.push(rowHtml(`Sconto quantità −${Math.round(r.discountRate * 100)}%`, `da ${r.qty} pezzi`, `−${eur.format(r.discount)}`, 'neg'));
  rows.push(rowHtml('Preparazione', 'slicing, controllo, finitura base', eur.format(r.setupFee)));
  if (r.minimumApplied) rows.push(rowHtml('Adeguamento ordine minimo', `minimo ${eur.format(CONFIG.minimumOrder)}`, eur.format(r.minimumTopUp)));
  rows.push(rowHtml('Totale stimato', 'IVA esclusa', eur.format(r.net), 'sum'));
  $('#q-breakdown tbody').innerHTML = rows.join('');
}

function renderMultiBreakdown(project) {
  const rows = project.lines.map((line, i) => {
    const part = state.parts[i];
    return rowHtml(esc(partName(part)), esc(partMeta(part, line)), eur.format(line.lineNet));
  });
  rows.push(rowHtml('Subtotale parti', 'dopo lo sconto quantità di ogni parte', eur.format(project.linesNet)));
  rows.push(rowHtml('Preparazione', 'una volta per l\'ordine: slicing, controllo, imballo', eur.format(project.setupFee)));
  if (project.minimumApplied) rows.push(rowHtml('Adeguamento ordine minimo', `minimo ${eur.format(CONFIG.minimumOrder)}`, eur.format(project.minimumTopUp)));
  rows.push(rowHtml('Totale stimato', `${project.partCount} parti · IVA esclusa`, eur.format(project.net), 'sum'));
  $('#q-breakdown tbody').innerHTML = rows.join('');
}

function update() {
  syncActiveFromForm();
  const viewing = state.pendingNew ? null : model();
  if (viewing?.stats) renderModelStats(viewing);
  else clearModelStats();

  if (!state.parts.length) { resetQuote(); return; }
  const project = estimateProject(state.parts.map(p => ({ stats: p.model.stats, opts: optsOf(p) })), CONFIG);
  state.projectResult = project;
  const active = activePart();
  const idx = active ? state.parts.indexOf(active) : 0;
  state.result = project.lines[idx] || project.lines[0];

  $('#q-total').textContent = eur.format(project.net);
  $('#q-vat').textContent = CONFIG.showVat ? `IVA esclusa · ${eur.format(project.gross)} con IVA ${Math.round(CONFIG.vatRate * 100)}%` : 'Totale stimato';
  const w = projectWeight(project);
  $('#k-weight').textContent = w.label;
  $('#q-weight').textContent = w.value;
  $('#q-weight').title = w.title || '';
  $('#q-time').textContent = formatDuration(project.totalSec);
  $('#q-time').title = project.partCount > 1 ? 'Somma dei tempi di ogni parte. In resina le parti diverse non condividono il piatto.' : '';
  if (project.partCount === 1) {
    $('#k-unit').textContent = 'Per pezzo';
    $('#q-unit').textContent = eur.format(project.net / project.qty);
    renderSingleBreakdown(project.lines[0], state.parts[0]);
  } else {
    $('#k-unit').textContent = 'Parti';
    $('#q-unit').textContent = `${project.partCount} parti`;
    renderMultiBreakdown(project);
  }
  const quoteTitle = $('#quote-title');
  if (quoteTitle) quoteTitle.textContent = project.partCount > 1 ? 'Totale progetto' : 'Preventivo';
  renderPartList(project);
  $('#request').disabled = false;
  const anyPhoto = state.mode === 'photo' || state.parts.some(p => p.source === 'photo');
  $('#ai-disclaimer').hidden = !anyPhoto;
}

/* ---------------- Richiedi stampa ---------------- */
function partSummaryLines(part, line) {
  const m = part.model, st = m.stats, isPhoto = part.source === 'photo';
  const s = part.settings[part.tech];
  const mat = matsOf(part.tech)[s.material];
  return [
    isPhoto ? `• Modello: generato con IA dalla foto "${m.photoName}" (${m.space?.label || 'IA'}) – forma approssimativa` : `• File: ${partName(part)}`,
    `• Dimensioni: ${nf(1).format(st.size.x)} × ${nf(1).format(st.size.y)} × ${nf(1).format(st.size.z)} mm${isPhoto ? ` (${m.sizeMode === 'height' ? 'altezza' : 'lato più lungo'} impostata a ${nf(0).format(m.sizeMm)} mm)` : ''}`,
    `• Volume: ${nf(2).format(st.volume / 1000)} cm³`,
    `• Tecnologia: ${CONFIG.technologies[part.tech].label}`,
    `• Materiale: ${mat.label} · Colore: ${s.color}`,
    part.tech === 'resin'
      ? `• Interno: ${s.hollow ? `svuotato, parete ${nf(1).format(line.wall)} mm` : 'pieno'} · Layer: ${s.layer} mm`
      : `• Riempimento: ${s.infill}% · Layer: ${s.layer} mm · Qualità: ${CONFIG.qualities[s.quality].label}`,
    `• Quantità: ${line.qty}`,
  ];
}

function summaryText() {
  if (!state.parts.length) return '';
  const project = estimateProject(state.parts.map(p => ({ stats: p.model.stats, opts: optsOf(p) })), CONFIG);
  if (state.parts.length === 1) {
    const part = state.parts[0], line = project.lines[0];
    const isPhoto = part.source === 'photo';
    return [
      'Ciao Nebula 3D! Vorrei un preventivo per questa stampa:',
      '',
      ...partSummaryLines(part, line),
      '',
      `Stima online: ${eur.format(project.net)} + IVA (${eur.format(project.gross)} IVA incl.)`,
      part.tech === 'resin'
        ? `Resina ~${nf(0).format(line.totalMl)} ml · Tempo ~${formatDuration(line.totalSec)}`
        : `Filamento ~${nf(0).format(line.totalGrams)} g · Tempo ~${formatDuration(line.totalSec)}`,
      '',
      isPhoto ? 'Vi invio in allegato la foto e il file STL generato. Grazie!' : 'Vi invio il file STL in allegato. Grazie!',
    ].join('\n');
  }
  const blocks = state.parts.map((part, i) => {
    const line = project.lines[i];
    const weight = part.tech === 'resin'
      ? `Resina ~${nf(0).format(line.totalMl)} ml`
      : `Filamento ~${nf(0).format(line.totalGrams)} g`;
    return [
      `${i + 1}) ${partName(part)}`,
      ...partSummaryLines(part, line),
      `• Costo parte: ${eur.format(line.lineNet)} (IVA esclusa, senza preparazione)`,
      `• ${weight} · Tempo ~${formatDuration(line.totalSec)}`,
    ].join('\n');
  });
  const resinMl = project.totalMl;
  const fdmG = project.lines.filter(l => l.tech !== 'resin').reduce((s, l) => s + l.totalGrams, 0);
  const weightBits = [];
  if (fdmG > 0) weightBits.push(`filamento ~${nf(0).format(fdmG)} g`);
  if (resinMl > 0) weightBits.push(`resina ~${nf(0).format(resinMl)} ml`);
  const tail = [
    `Totale progetto: ${eur.format(project.net)} + IVA (${eur.format(project.gross)} IVA incl.)`,
    `Preparazione ordine: ${eur.format(project.setupFee)} (una volta)${project.minimumApplied ? ` · applicato ordine minimo ${eur.format(CONFIG.minimumOrder)}` : ''}`,
  ];
  if (project.discount > 0) tail.push(`Sconti quantità (per parte, non sulla somma delle quantità): −${eur.format(project.discount)}`);
  tail.push(
    `Materiale: ${weightBits.join(' · ')}`,
    `Tempo di stampa complessivo: ~${formatDuration(project.totalSec)} (le parti in resina diverse non condividono il piatto)`,
    '',
    'Vi invio in allegato i file STL di tutte le parti. Grazie!',
  );
  return [
    `Ciao Nebula 3D! Vorrei un preventivo per questo progetto di ${project.partCount} parti:`,
    '',
    blocks.join('\n\n'),
    '',
    ...tail,
  ].join('\n');
}

$('#request').onclick = () => {
  if (!state.parts.length) return;
  const text = summaryText();
  const part = state.parts.length === 1 ? state.parts[0] : null;
  $('#summary').value = text;
  const to = CONFIG.contact.email || '';
  const subj = state.parts.length > 1
    ? `Richiesta stampa 3D – progetto ${state.parts.length} parti`
    : part.source === 'photo'
      ? `Richiesta stampa 3D – da foto ${part.model.photoName}`
      : `Richiesta stampa 3D – ${partName(part)}`;
  $('#dialog-hint').textContent = state.parts.length > 1
    ? 'Ecco il riepilogo dell\'intero progetto. Invialo a Nebula 3D via Instagram o email e allega i file STL di tutte le parti.'
    : part.source === 'photo'
      ? 'Ecco il riepilogo del preventivo. Invialo a Nebula 3D via Instagram o email e allega la foto e il file STL scaricato.'
      : 'Ecco il riepilogo del preventivo. Invialo a Nebula 3D via Instagram o email e allega il file STL.';
  $('#send-mail').href = `mailto:${to}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`;
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

$('#project-list').addEventListener('click', onPartListClick);
$('#project-list').addEventListener('keydown', e => {
  const li = e.target.closest?.('.part');
  if (!li || e.target.closest('button') || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  selectPart(+li.dataset.id, { scroll: true });
});
$('#add-part').onclick = beginAddPart;
$('#cancel-add').onclick = cancelAdd;

$('#year').textContent = new Date().getFullYear();
$('#photo-size').value = P3D.defaultSizeMm; $('#photo-size-mode').value = P3D.defaultSizeMode;
buildControls();

// Hook per demo/test: ?tech=resin, ?mode=photo, ?sample=1, ?photo=1 (genera dalla foto di esempio), ?mock3d=1
if (qs.get('tech') === 'resin') setTech('resin');
if (qs.get('mode') === 'photo' || qs.has('photo')) setMode('photo');
if (qs.has('sample')) loadSample(+qs.get('sample') || 0);
if (qs.has('photo')) loadSamplePhoto();
window.__nebula = { state, CONFIG, setTech, setMode, estimateProject };
