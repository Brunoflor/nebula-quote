/**
 * Nebula 3D – Preventivatore istantaneo
 * =====================================
 * TUTTE le costanti di prezzo e di stima stanno qui.
 * Modifica questi valori per adattare i preventivi alla tua stampante e ai tuoi costi.
 * Le stime sono indicative: non sostituiscono lo slicer.
 */
export const CONFIG = {
  /** Contatti usati dal pulsante "Richiedi stampa" */
  contact: {
    instagram: 'nebula3dlab',        // handle Instagram senza @
    email: '',                       // es. 'ordini@nebula3d.it' – se vuoto l'email parte senza destinatario
  },

  /** Tecnologie disponibili: 'fdm' (filamento) e 'resin' (resina SLA/MSLA) */
  technologies: {
    fdm:   { label: 'Filamento (FDM)' },
    resin: { label: 'Resina (SLA)' },
  },
  defaultTechnology: 'fdm',

  /** Volume di stampa della stampante a FILAMENTO in mm (X, Y, Z). Default: 256 x 256 x 256 */
  buildVolume: { x: 256, y: 256, z: 256 },

  /** Valuta e IVA */
  currency: 'EUR',
  vatRate: 0.22,                     // 22% IVA – mostrata a parte, i prezzi sono IVA esclusa
  showVat: true,

  /**
   * Materiali.
   *  density      g/cm³
   *  pricePerKg   € al kg di filamento (costo che vuoi addebitare)
   *  flowRate     portata volumetrica media in mm³/s con layer 0.20 mm (include rallentamenti su perimetri)
   *  machineRateMult  moltiplicatore della tariffa oraria macchina (es. ABS richiede piatto/camera più calda)
   */
  materials: {
    PLA:  { label: 'PLA',  density: 1.24, pricePerKg: 22, flowRate: 9.0, machineRateMult: 1.00, note: 'Rigido, facile, ottimo per estetica' },
    PETG: { label: 'PETG', density: 1.27, pricePerKg: 25, flowRate: 7.5, machineRateMult: 1.05, note: 'Resistente e un po\' flessibile' },
    ABS:  { label: 'ABS',  density: 1.04, pricePerKg: 24, flowRate: 7.5, machineRateMult: 1.15, note: 'Resiste al calore, per parti tecniche' },
    TPU:  { label: 'TPU',  density: 1.21, pricePerKg: 35, flowRate: 3.0, machineRateMult: 1.10, note: 'Gommoso e flessibile, stampa lenta' },
  },

  /**
   * Altezze layer disponibili (mm) e fattore sulla portata rispetto a 0.20 mm.
   * Layer più bassi = più strati = stampa più lenta.
   */
  layerHeights: {
    '0.12': { label: '0.12 mm – fine',     flowFactor: 0.60 },
    '0.2':  { label: '0.20 mm – standard', flowFactor: 1.00 },
    '0.28': { label: '0.28 mm – veloce',   flowFactor: 1.30 },
  },

  /**
   * Profili di qualità.
   *  walls       numero di perimetri (spessore guscio = walls × lineWidth)
   *  speedFactor moltiplicatore sulla velocità (più basso = più lento e curato)
   */
  qualities: {
    bozza:    { label: 'Bozza',    walls: 2, speedFactor: 1.15 },
    standard: { label: 'Standard', walls: 3, speedFactor: 1.00 },
    alta:     { label: 'Alta',     walls: 4, speedFactor: 0.80 },
  },

  /** Larghezza della linea di estrusione in mm (ugello 0.4 → ~0.42) */
  lineWidth: 0.42,

  /** Spreco di materiale (spurgo, skirt, supporti leggeri, prove) come frazione: 0.08 = +8% */
  materialWaste: 0.08,

  /** Tempo fisso per ogni pezzo: riscaldamento, livellamento, primo layer (minuti) */
  overheadMinutesPerPart: 6,

  /** Tempo per ogni cambio layer (secondi): spostamenti, retrazioni, raffreddamento */
  secondsPerLayerChange: 1.5,

  /** Tariffa oraria macchina in €/h (energia, usura, ammortamento) */
  machineRatePerHour: 3.0,

  /** Costo fisso di preparazione per ordine in € (slicing, controllo, rimozione, imballo) */
  setupFee: 4,

  /** Prezzo minimo per ordine (IVA esclusa) */
  minimumOrder: 5,

  /** Sconto quantità: dalla quantità indicata si applica lo sconto sul costo dei pezzi */
  quantityDiscounts: [
    { minQty: 10, discount: 0.10 },
    { minQty: 5,  discount: 0.05 },
  ],

  /** Colori disponibili (solo estetici, per l'anteprima e il riepilogo) */
  colors: [
    { name: 'Viola Nebula', hex: '#8b5cf6' },
    { name: 'Nero',         hex: '#1f1f24' },
    { name: 'Bianco',       hex: '#f2f2f2' },
    { name: 'Grigio',       hex: '#8a8f98' },
    { name: 'Rosso',        hex: '#e5484d' },
    { name: 'Arancio',      hex: '#f76b15' },
    { name: 'Giallo',       hex: '#ffd60a' },
    { name: 'Verde',        hex: '#30a46c' },
    { name: 'Azzurro',      hex: '#0ea5e9' },
    { name: 'Blu',          hex: '#3e63dd' },
  ],

  /* ======================================================================
   * RESINA (SLA / MSLA) – parametri separati dal filamento.
   * Nella resina non esiste il riempimento: il pezzo è pieno oppure svuotato
   * (guscio ≈ superficie × spessore parete). Il tempo dipende dall'ALTEZZA del
   * pezzo (numero di layer), non dal volume: tutti i pezzi sul piatto
   * vengono esposti insieme.
   * ====================================================================== */
  resin: {
    /** Volume di stampa della stampante a resina in mm (X, Y, Z) */
    buildVolume: { x: 218, y: 123, z: 235 },

    /**
     * Resine.
     *  density     g/cm³
     *  pricePerKg  € al kg di resina (≈ € al litro × densità)
     */
    materials: {
      standard:  { label: 'Standard',          density: 1.12, pricePerKg: 38, note: 'Dettagli finissimi, ideale per miniature e figure' },
      abslike:   { label: 'ABS-like',          density: 1.15, pricePerKg: 45, note: 'Meno fragile della standard, buona per parti funzionali' },
      tough:     { label: 'Tough',             density: 1.18, pricePerKg: 65, note: 'Alta resistenza a urti e flessione' },
      waterwash: { label: 'Lavabile in acqua', density: 1.10, pricePerKg: 42, note: 'Si lava con acqua invece che alcol isopropilico' },
    },

    /** Altezze layer (mm) con il tempo per layer di una mono LCD (esposizione + sollevamento) */
    layerHeights: {
      '0.025': { label: '0.025 mm – ultra fine', secondsPerLayer: 2.5 },
      '0.05':  { label: '0.05 mm – standard',    secondsPerLayer: 2.8 },
      '0.1':   { label: '0.10 mm – veloce',      secondsPerLayer: 3.0 },
    },

    /** Resina extra per supporti, base e scarto (0.12 = +12%) */
    supportWaste: 0.12,

    /** Spessore parete di default quando il pezzo è svuotato (mm) e limiti */
    defaultWallMm: 2,
    minWallMm: 0.8,
    maxWallMm: 6,

    /** Tempo fisso per ogni stampa (piatto): livellamento vasca, primi layer di base (minuti) */
    overheadMinutesPerPlate: 10,

    /** Frazione del piatto utilizzabile per disporre più pezzi (supporti, distanze) */
    plateUsage: 0.6,

    /** Tariffa oraria della stampante a resina in €/h (schermo LCD, FEP, energia) */
    machineRatePerHour: 2.5,

    /** Post-produzione per pezzo in €: lavaggio, polimerizzazione UV, rimozione supporti */
    postProcessPerPart: 2.5,

    /** Colori resina disponibili */
    colors: [
      { name: 'Grigio',      hex: '#9aa0a8' },
      { name: 'Nero',        hex: '#1f1f24' },
      { name: 'Bianco',      hex: '#f2f2f2' },
      { name: 'Beige pelle', hex: '#e8c39e' },
      { name: 'Trasparente', hex: '#b9e6f5' },
      { name: 'Viola Nebula', hex: '#8b5cf6' },
    ],

    /** Valori iniziali quando si passa alla resina */
    defaults: { material: 'standard', layer: '0.05', hollow: false, wall: 2, color: 'Grigio' },
  },

  /* ======================================================================
   * DA FOTO → MODELLO 3D (IA)
   * Usa Space pubblici di Hugging Face, gratuiti e senza chiave, chiamati
   * direttamente dal browser con @gradio/client. Se il primo fallisce o va in
   * timeout si passa automaticamente al successivo.
   * Nota: gli Space ZeroGPU hanno una quota gratuita giornaliera per IP.
   * ====================================================================== */
  photoTo3D: {
    spaces: [
      {
        id: 'tencent/Hunyuan3D-2', label: 'Hunyuan3D-2', endpoint: '/shape_generation',
        params: { caption: '', steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: true },
        typicalSeconds: 15, maskBackground: false,
      },
      {
        id: 'tencent/Hunyuan3D-2.1', label: 'Hunyuan3D-2.1', endpoint: '/shape_generation',
        params: { steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: true },
        typicalSeconds: 30, maskBackground: true, // questo Space tiene lo sfondo come una lastra: lo togliamo noi prima
      },
    ],
    connectTimeoutSec: 30,      // tempo massimo per collegarsi a uno Space
    timeoutSec: 240,            // tempo massimo per una generazione (coda inclusa) prima di passare al successivo
    maxImageSide: 1024,         // la foto viene ridimensionata a questo lato massimo prima dell'invio
    defaultSizeMm: 80,          // dimensione reale proposta per il modello generato
    defaultSizeMode: 'height',  // 'height' = altezza, 'longest' = lato più lungo
  },

  /** Valori iniziali del form */
  defaults: { material: 'PLA', infill: 20, layer: '0.2', quality: 'standard', quantity: 1, color: 'Viola Nebula', unit: 'mm' },
};
