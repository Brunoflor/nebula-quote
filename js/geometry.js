/**
 * Parsing STL e calcoli geometrici, senza dipendenze (funziona anche in Node per i test).
 * Tutte le misure sono nell'unità del file (si assume mm).
 */

/** Restituisce un Float32Array di vertici (9 numeri per triangolo). Supporta STL binario e ASCII. */
export function parseSTL(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.byteLength >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return parseBinary(dv, n);
  }
  const text = new TextDecoder().decode(bytes);
  if (/^\s*solid/i.test(text) && /facet/i.test(text)) return parseASCII(text);
  if (bytes.byteLength >= 84) {
    // binario con header/lunghezza non standard: proviamo comunque
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = Math.min(dv.getUint32(80, true), Math.floor((bytes.byteLength - 84) / 50));
    if (n > 0) return parseBinary(dv, n);
  }
  throw new Error('File STL non valido o vuoto');
}

function parseBinary(dv, n) {
  const out = new Float32Array(n * 9);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50 + 12; // salta la normale
    for (let j = 0; j < 9; j++) out[o++] = dv.getFloat32(base + j * 4, true);
  }
  return out;
}

function parseASCII(text) {
  const re = /vertex\s+([-+]?[\d.]+(?:e[-+]?\d+)?)\s+([-+]?[\d.]+(?:e[-+]?\d+)?)\s+([-+]?[\d.]+(?:e[-+]?\d+)?)/gi;
  const vals = [];
  let m;
  while ((m = re.exec(text)) !== null) vals.push(+m[1], +m[2], +m[3]);
  if (vals.length < 9) throw new Error('Nessun triangolo trovato nel file STL');
  const usable = vals.length - (vals.length % 9);
  return new Float32Array(vals.slice(0, usable));
}

/**
 * Volume (metodo dei tetraedri con segno), area superficiale e bounding box.
 * Il volume è in valore assoluto: funziona con normali tutte verso l'esterno o tutte verso l'interno.
 */
export function computeStats(pos) {
  let vol = 0, area = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    // volume con segno del tetraedro (origine, a, b, c) = a · (b × c) / 6
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    // area = |(b-a) × (c-a)| / 2
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    for (let k = 0; k < 9; k += 3) {
      const x = pos[i + k], y = pos[i + k + 1], z = pos[i + k + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return {
    triangles: pos.length / 9,
    volume: Math.abs(vol),           // mm³
    signedVolume: vol,
    area,                            // mm²
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}

/** Controlla se il pezzo entra nel volume di stampa (anche ruotandolo sul piano XY). */
export function fitsBuildVolume(size, bv) {
  const direct = size.x <= bv.x && size.y <= bv.y && size.z <= bv.z;
  const rotated = size.y <= bv.x && size.x <= bv.y && size.z <= bv.z;
  return { fits: direct || rotated, rotatedOnly: !direct && rotated };
}
