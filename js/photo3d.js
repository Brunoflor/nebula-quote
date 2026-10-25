/**
 * Da foto a modello 3D (IA) – tutto nel browser, senza server e senza chiavi.
 * 1) La foto viene ridimensionata (ed eventualmente scontornata) in un <canvas>.
 * 2) Viene inviata a uno Space pubblico di Hugging Face tramite @gradio/client.
 * 3) Il GLB restituito viene letto con GLTFLoader e convertito in triangoli Z-up.
 * Se uno Space fallisce o va in timeout si prova automaticamente il successivo.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';

export class GenerationError extends Error {
  constructor(message, { kind = 'generic', retryable = true } = {}) { super(message); this.kind = kind; this.retryable = retryable; }
}

/* ---------------- Immagine ---------------- */

/** Decodifica la foto (JPG/PNG/WEBP; HEIC solo dove il browser lo supporta, es. Safari) */
export async function decodeImage(file) {
  try { return await createImageBitmap(file); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } catch {
      const heic = /hei[cf]$/i.test(file.name || '') || /hei[cf]/i.test(file.type || '');
      throw new GenerationError(heic
        ? 'Questo browser non sa leggere le foto HEIC dell\'iPhone. Converti la foto in JPG (o in Impostazioni › Fotocamera › Formati scegli "Più compatibile") e riprova.'
        : 'Impossibile leggere l\'immagine. Usa una foto JPG, PNG o WEBP.', { kind: 'image', retryable: false });
    } finally { URL.revokeObjectURL(url); }
  }
}

/**
 * Ridimensiona a maxSide e, se richiesto, rende trasparente lo sfondo quando è
 * uniforme (flood fill dai bordi con tolleranza sul colore medio del bordo).
 */
export async function prepareImage(source, { maxSide = 1024, maskBackground = false } = {}) {
  const w0 = source.width, h0 = source.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  let masked = false;
  if (maskBackground) masked = maskUniformBackground(ctx, w, h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  return { blob, width: w, height: h, masked };
}

function maskUniformBackground(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  // colore medio del bordo e quanto è uniforme
  let n = 0, r = 0, g = 0, b = 0; const border = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
  for (let x = 0; x < w; x += step) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += step) border.push(y * w, y * w + w - 1);
  for (const i of border) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
  r /= n; g /= n; b /= n;
  let dev = 0; for (const i of border) dev += Math.hypot(d[i * 4] - r, d[i * 4 + 1] - g, d[i * 4 + 2] - b); dev /= n;
  if (dev > 18) return false;                       // sfondo non uniforme: lo lascia allo Space
  const tol = 28 + dev * 1.5, seen = new Uint8Array(w * h), stack = [...border];
  let cleared = 0;
  while (stack.length) {
    const i = stack.pop(); if (seen[i]) continue; seen[i] = 1;
    const o = i * 4;
    if (Math.hypot(d[o] - r, d[o + 1] - g, d[o + 2] - b) > tol) continue;
    d[o + 3] = 0; cleared++;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
  }
  if (cleared < w * h * 0.1 || cleared > w * h * 0.97) return false;
  ctx.putImageData(img, 0, 0);
  return true;
}

/* ---------------- Mesh ---------------- */

/** GLB (ArrayBuffer) → Float32Array di triangoli non indicizzati, convertiti da Y-up a Z-up */
export async function glbToPositions(buffer) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    parts.push(g.attributes.position.array);
  });
  // Le mesh generate contengono molti triangoli degeneri (area nulla): li scartiamo
  let total = 0; for (const a of parts) total += a.length;
  const out = new Float32Array(total); let off = 0;
  for (const a of parts) {
    for (let i = 0; i < a.length; i += 9) {
      const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2];
      const vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz <= 1e-24) continue;
      for (let j = 0; j < 9; j += 3) { out[off + j] = a[i + j]; out[off + j + 1] = -a[i + j + 2]; out[off + j + 2] = a[i + j + 1]; } // (x, y, z) → (x, −z, y)
      off += 9;
    }
  }
  if (off < 9) throw new GenerationError('Il modello generato è vuoto. Prova con un\'altra foto.', { kind: 'empty' });
  return out.slice(0, off);
}

/** Scala i triangoli perché l'altezza (Z) o il lato più lungo valga sizeMm; appoggia sul piatto (z = 0) */
export function scaleToSize(pos, sizeMm, mode = 'height') {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const ref = mode === 'longest' ? Math.max(...size) : size[2];
  const s = ref > 0 ? sizeMm / ref : 1;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { out[i] = (pos[i] - cx) * s; out[i + 1] = (pos[i + 1] - cy) * s; out[i + 2] = (pos[i + 2] - min[2]) * s; }
  return out;
}

/* ---------------- Generazione remota ---------------- */

let gradio = null;
const loadGradio = () => (gradio ??= import('../vendor/gradio/client.js'));

function friendlyError(msg = '') {
  const m = String(msg);
  const q = m.match(/ZeroGPU quota.*?Try again in ([\d:]+)/i);
  if (q || /quota/i.test(m)) {
    let when = '';
    if (q) { const [hh, mm] = q[1].split(':').map(Number); when = hh ? ` Riprova tra circa ${hh} h ${mm} min.` : ` Riprova tra circa ${mm || 1} min.`; }
    return new GenerationError(`Quota gratuita di GPU di Hugging Face esaurita per la tua connessione.${when}`, { kind: 'quota' });
  }
  if (/timeout|timed out/i.test(m)) return new GenerationError('Il servizio di generazione non ha risposto in tempo.', { kind: 'timeout' });
  if (/sleep|paused|building|not running|space metadata|could not resolve|connection/i.test(m)) return new GenerationError('Il servizio di generazione al momento non è disponibile.', { kind: 'down' });
  return new GenerationError(`Il servizio di generazione ha restituito un errore${m ? ` (${m.slice(0, 120)})` : ''}.`, { kind: 'remote' });
}

function withTimeout(promise, ms, onTimeout) {
  let t; return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => { onTimeout?.(); rej(new GenerationError('timeout', { kind: 'timeout' })); }, ms); })]).finally(() => clearTimeout(t));
}

function fileUrlFrom(data, root) {
  const first = Array.isArray(data) ? data[0] : data;
  const v = first?.value ?? first;
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : `${root}/file=${v}`;
  if (v.url) return v.url;
  if (v.path) return `${root}/file=${v.path}`;
  return null;
}

/** Una generazione su un singolo Space. onStatus({stage, position, eta, elapsed}) */
async function runSpace(space, imageBlob, cfg, onStatus, signal) {
  const { Client, handle_file } = await loadGradio();
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  onStatus({ stage: 'connecting', space, elapsed: 0 });
  let client;
  try { client = await withTimeout(Client.connect(space.id, { events: ['data', 'status'] }), cfg.connectTimeoutSec * 1000); }
  catch (e) { throw e instanceof GenerationError && e.kind === 'timeout' ? new GenerationError('Il servizio di generazione non risponde.', { kind: 'down' }) : friendlyError(e?.message); }
  if (signal?.aborted) throw new GenerationError('Generazione annullata.', { kind: 'abort', retryable: false });

  const job = client.submit(space.endpoint, { ...space.params, image: handle_file(imageBlob) });
  const abort = () => { try { job.cancel?.(); } catch {} };
  signal?.addEventListener('abort', abort, { once: true });
  const consume = (async () => {
    for await (const m of job) {
      if (signal?.aborted) throw new GenerationError('Generazione annullata.', { kind: 'abort', retryable: false });
      if (m.type === 'status') {
        if (m.stage === 'error') throw friendlyError(m.message);
        const position = typeof m.position === 'number' ? m.position : null;
        const eta = typeof m.eta === 'number' ? m.eta : null;
        onStatus({ stage: position > 0 ? 'queue' : 'processing', space, position, eta, elapsed: elapsed() });
      } else if (m.type === 'data') return m.data;
    }
    throw new GenerationError('Il servizio ha chiuso la connessione senza restituire un modello.', { kind: 'remote' });
  })();
  let data;
  try { data = await withTimeout(consume, cfg.timeoutSec * 1000, abort); }
  catch (e) { throw e instanceof GenerationError ? e : friendlyError(e?.message); }
  finally { signal?.removeEventListener('abort', abort); }

  const url = fileUrlFrom(data, client.config?.root || `https://${space.id.replace('/', '-').replace(/\./g, '-').toLowerCase()}.hf.space`);
  if (!url) throw new GenerationError('Il servizio non ha restituito un file 3D.', { kind: 'remote' });
  onStatus({ stage: 'download', space, elapsed: elapsed() });
  const res = await fetch(url, { signal });
  if (!res.ok) throw new GenerationError(`Download del modello non riuscito (HTTP ${res.status}).`, { kind: 'remote' });
  const buffer = await res.arrayBuffer();
  onStatus({ stage: 'parsing', space, elapsed: elapsed() });
  return { buffer, url, seconds: elapsed() };
}

/**
 * Prova gli Space in ordine (primario + riserva). Restituisce
 * { positions, space, seconds, attempts: [{space, ok, error, seconds}] }
 * Con mock = { glbUrl, delayMs } non chiama la rete (usato dai test).
 */
export async function generateFromPhoto(file, { cfg, onStatus = () => {}, signal, mock = null } = {}) {
  const source = await decodeImage(file);
  const attempts = [];
  const spaces = cfg.spaces;
  for (let i = 0; i < spaces.length; i++) {
    const space = spaces[i];
    if (signal?.aborted) throw new GenerationError('Generazione annullata.', { kind: 'abort', retryable: false });
    const t0 = performance.now();
    try {
      const img = await prepareImage(source, { maxSide: cfg.maxImageSide, maskBackground: space.maskBackground });
      let out;
      if (mock) out = await mockRun(space, mock, onStatus, signal);
      else out = await runSpace(space, img.blob, cfg, s => onStatus({ ...s, attempt: i, fallback: i > 0 }), signal);
      const positions = await glbToPositions(out.buffer);
      attempts.push({ space: space.label, ok: true, seconds: (performance.now() - t0) / 1000 });
      return { positions, space, seconds: (performance.now() - t0) / 1000, attempts };
    } catch (e) {
      const err = e instanceof GenerationError ? e : friendlyError(e?.message);
      attempts.push({ space: space.label, ok: false, error: err.message, kind: err.kind, seconds: (performance.now() - t0) / 1000 });
      console.warn(`[foto→3D] ${space.id} non riuscito:`, err.message);
      if (err.kind === 'abort' || err.kind === 'image' || i === spaces.length - 1) { err.attempts = attempts; throw err; }
      onStatus({ stage: 'fallback', space: spaces[i + 1], from: space, reason: err.message });
    }
  }
}

async function mockRun(space, mock, onStatus, signal) {
  if (mock.failFirst && space === mock.cfgSpaces?.[0]) { await new Promise(r => setTimeout(r, 200)); throw new GenerationError('Il servizio di generazione al momento non è disponibile.', { kind: 'down' }); }
  const steps = [{ stage: 'connecting' }, { stage: 'queue', position: 2, eta: 6 }, { stage: 'queue', position: 1, eta: 4 }, { stage: 'processing', position: 0, eta: 3 }];
  for (const s of steps) { if (signal?.aborted) throw new GenerationError('Generazione annullata.', { kind: 'abort', retryable: false }); onStatus({ ...s, space, elapsed: 0 }); await new Promise(r => setTimeout(r, mock.delayMs ?? 250)); }
  const res = await fetch(mock.glbUrl);
  return { buffer: await res.arrayBuffer(), url: mock.glbUrl };
}
