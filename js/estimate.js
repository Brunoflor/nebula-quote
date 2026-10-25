/**
 * Modello di stima (filamento, tempo, prezzo). Funzione pura: nessun accesso al DOM.
 * Tutte le costanti arrivano da CONFIG (js/config.js).
 */
export function estimate(stats, opts, CONFIG) {
  const mat = CONFIG.materials[opts.material];
  const layer = CONFIG.layerHeights[opts.layer];
  const q = CONFIG.qualities[opts.quality];
  const qty = Math.max(1, Math.floor(opts.quantity || 1));
  const infill = Math.min(100, Math.max(0, opts.infill)) / 100;
  const layerH = parseFloat(opts.layer);

  // 1) Filamento: guscio ≈ area × spessore pareti, interno ≈ (volume − guscio) × infill
  const wallThickness = q.walls * CONFIG.lineWidth;                 // mm
  const shellVol = Math.min(stats.volume, stats.area * wallThickness); // mm³ (non può superare il volume del pezzo)
  const interiorVol = Math.max(0, stats.volume - shellVol);
  const infillVol = interiorVol * infill;
  const plasticVol = shellVol + infillVol;                         // mm³ per pezzo
  const plasticCm3 = plasticVol / 1000;
  const grams = plasticCm3 * mat.density;                          // g per pezzo
  const gramsWithWaste = grams * (1 + CONFIG.materialWaste);

  // 2) Tempo: portata volumetrica corretta per layer e qualità + tempi fissi
  const flow = mat.flowRate * layer.flowFactor * q.speedFactor;    // mm³/s
  const layers = Math.ceil(stats.size.z / layerH);
  const extrudeSec = plasticVol / flow;
  const layerSec = layers * CONFIG.secondsPerLayerChange;
  const overheadSec = CONFIG.overheadMinutesPerPart * 60;
  const secPerPart = extrudeSec + layerSec + overheadSec;
  const hoursPerPart = secPerPart / 3600;

  // 3) Prezzo
  const materialCost = gramsWithWaste / 1000 * mat.pricePerKg;     // € per pezzo
  const machineCost = hoursPerPart * CONFIG.machineRatePerHour * mat.machineRateMult; // € per pezzo
  const unitCost = materialCost + machineCost;
  const partsSubtotal = unitCost * qty;
  const disc = [...CONFIG.quantityDiscounts].sort((a, b) => b.minQty - a.minQty).find(d => qty >= d.minQty);
  const discountRate = disc ? disc.discount : 0;
  const discount = partsSubtotal * discountRate;
  let net = partsSubtotal - discount + CONFIG.setupFee;
  const minimumApplied = net < CONFIG.minimumOrder;
  const minimumTopUp = minimumApplied ? CONFIG.minimumOrder - net : 0;
  net = Math.max(net, CONFIG.minimumOrder);
  const vat = CONFIG.showVat ? net * CONFIG.vatRate : 0;

  return {
    qty, wallThickness, shellVol, infillVol, plasticVol, layers,
    gramsPerPart: grams, gramsPerPartWithWaste: gramsWithWaste, totalGrams: gramsWithWaste * qty,
    flow, secPerPart, totalSec: secPerPart * qty,
    materialCost, machineCost, unitCost,
    materialTotal: materialCost * qty, machineTotal: machineCost * qty,
    partsSubtotal, discountRate, discount, setupFee: CONFIG.setupFee,
    minimumApplied, minimumTopUp, net, vat, gross: net + vat,
  };
}

export function formatDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return `${h} h ${String(r).padStart(2, '0')} min`;
  const d = Math.floor(h / 24);
  return `${d} g ${h % 24} h`;
}
