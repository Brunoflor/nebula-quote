// Genera gli STL di esempio in /samples:  node tools/generate-samples.mjs
import { writeFileSync } from 'node:fs';

function writeBinarySTL(path, tris, name) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write(name.padEnd(80, ' ').slice(0, 80), 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [a, b, c] of tris) {
    const n = normal(a, b, c);
    for (const v of [n, a, b, c]) for (const k of v) { buf.writeFloatLE(k, o); o += 4; }
    o += 2;
  }
  writeFileSync(path, buf);
}
function writeAsciiSTL(path, tris, name) {
  const f = x => x.toExponential(6);
  let s = `solid ${name}\n`;
  for (const [a, b, c] of tris) {
    const n = normal(a, b, c);
    s += `  facet normal ${n.map(f).join(' ')}\n    outer loop\n`;
    for (const v of [a, b, c]) s += `      vertex ${v.map(f).join(' ')}\n`;
    s += `    endloop\n  endfacet\n`;
  }
  writeFileSync(path, s + `endsolid ${name}\n`);
}
function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; return n.map(x => x / l);
}

// Box assiale con normali verso l'esterno
export function box(sx, sy, sz) {
  const p = (x, y, z) => [x * sx, y * sy, z * sz];
  const q = (a, b, c, d) => [[a, b, c], [a, c, d]];
  return [
    ...q(p(0,0,0), p(0,1,0), p(1,1,0), p(1,0,0)), // sotto (-z)
    ...q(p(0,0,1), p(1,0,1), p(1,1,1), p(0,1,1)), // sopra (+z)
    ...q(p(0,0,0), p(1,0,0), p(1,0,1), p(0,0,1)), // -y
    ...q(p(0,1,0), p(0,1,1), p(1,1,1), p(1,1,0)), // +y
    ...q(p(0,0,0), p(0,0,1), p(0,1,1), p(0,1,0)), // -x
    ...q(p(1,0,0), p(1,1,0), p(1,1,1), p(1,0,1)), // +x
  ];
}

// Solido di rotazione: profilo [r, z] che parte e finisce sull'asse (r = 0), percorso in senso antiorario nel piano (r,z)
export function lathe(profile, segments) {
  const tris = [];
  const pt = (r, z, i) => { const t = (i % segments) / segments * Math.PI * 2; return [r * Math.cos(t), r * Math.sin(t), z]; };
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, z0] = profile[k], [r1, z1] = profile[k + 1];
    for (let i = 0; i < segments; i++) {
      const a = pt(r0, z0, i), b = pt(r0, z0, i + 1), c = pt(r1, z1, i + 1), d = pt(r1, z1, i);
      if (r0 > 0) tris.push([a, b, c]);
      if (r1 > 0) tris.push([a, c, d]);
    }
  }
  return tris;
}

// Profilo vaso Nebula: fondo pieno 2 mm, parete 1.6 mm, pancia + collo svasato, h 90 mm
export function vaseProfile() {
  const H = 90, wall = 1.6, base = 2, N = 48;
  const R = z => { const t = z / H; return 22 + 12 * Math.sin(Math.PI * t * 1.15) - 6 * t + 4 * Math.pow(t, 6); };
  const outer = [], inner = [];
  for (let i = 0; i <= N; i++) { const z = H * i / N; outer.push([R(z), z]); }
  for (let i = N; i >= 0; i--) { const z = base + (H - base) * i / N; inner.push([R(z) - wall, z]); }
  return [[0, 0], ...outer, ...inner, [0, base]];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeAsciiSTL(new URL('../samples/cubo-20mm.stl', import.meta.url), box(20, 20, 20), 'Nebula3D_cubo_20mm');   // ASCII
  writeBinarySTL(new URL('../samples/vaso-nebula.stl', import.meta.url), lathe(vaseProfile(), 72), 'Nebula3D vaso'); // binario
  console.log('Campioni generati in samples/');
}
