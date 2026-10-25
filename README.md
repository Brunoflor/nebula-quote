# Nebula 3D · Preventivo istantaneo per stampe 3D

Web app statica di [Nebula 3D](https://www.instagram.com/nebula3dlab/) (@nebula3dlab): carichi un file **STL** e ottieni subito, nel browser, anteprima 3D interattiva, dimensioni, volume, peso del filamento, tempo di stampa e **prezzo stimato** con il dettaglio dei costi. Nessun backend: il file non lascia mai il dispositivo dell'utente.

![Screenshot](screenshot.png)

## Funzionalità

- Trascina e rilascia (o scegli) un file STL, **binario o ASCII**; pulsante **"Prova con un esempio"** con due modelli inclusi (vaso e cubo da 20 mm).
- Anteprima 3D con rotazione, zoom e pan (three.js + OrbitControls, inclusi nel progetto: funziona offline).
- Calcolo di volume, superficie e ingombro in mm; avviso se il pezzo supera il volume di stampa (default 256 × 256 × 256 mm).
- Impostazioni: materiale (PLA, PETG, ABS, TPU), riempimento, altezza layer (0.12 / 0.20 / 0.28), qualità, quantità, unità del file (mm, cm, pollici) e colore (solo estetico).
- Preventivo con dettaglio: materiale, tempo macchina, sconto quantità, preparazione, ordine minimo, IVA.
- **"Richiedi stampa"**: apre un riepilogo pronto da copiare in un DM Instagram a @nebula3dlab o da inviare via email (link `mailto:` precompilato). Non viene inviato nulla in automatico.
- Interfaccia in italiano, tema scuro, responsive per smartphone.

## Come funziona la stima

Tutte le costanti stanno in **`js/config.js`**, commentate: prezzi al kg, densità, tariffa oraria, costo di preparazione, sconti, volume di stampa, contatti.

1. **Geometria** (`js/geometry.js`)
   - *Volume*: per ogni triangolo (a, b, c) si somma il volume con segno del tetraedro con l'origine, `a · (b × c) / 6`; il valore assoluto della somma è il volume del solido chiuso.
   - *Superficie*: somma di `|(b − a) × (c − a)| / 2`.
   - *Ingombro*: bounding box allineata agli assi.
2. **Filamento** (`js/estimate.js`)
   - Spessore guscio = numero di pareti (dipende dalla qualità) × larghezza linea (0,42 mm).
   - Volume guscio ≈ superficie × spessore guscio (al massimo il volume del pezzo).
   - Volume interno = volume − guscio; plastica = guscio + interno × riempimento %.
   - Peso = plastica (cm³) × densità del materiale, + scarto (8%).
3. **Tempo**: plastica ÷ portata volumetrica del materiale (mm³/s), corretta per altezza layer e qualità, + secondi per ogni cambio layer + minuti fissi di preparazione macchina per pezzo.
4. **Prezzo**: (costo materiale + ore × tariffa macchina) × quantità − sconto quantità + costo fisso di preparazione, con ordine minimo. IVA mostrata a parte.

È un'approssimazione: uno slicer considera supporti, sbalzi, ponti, accelerazioni e il percorso reale dell'ugello. I risultati sono indicati come **stime** nell'interfaccia.

## Avvio in locale

Serve un piccolo server web (i moduli JavaScript non si caricano da `file://`):

```bash
cd nebula-quote
python3 -m http.server 8000
# poi apri http://localhost:8000
```

In alternativa: `npx serve .`

## Pubblicazione su GitHub Pages

1. Crea un repository su GitHub (es. `nebula-quote`) e carica il contenuto di questa cartella:
   ```bash
   git remote add origin https://github.com/<tuo-utente>/nebula-quote.git
   git push -u origin main
   ```
2. Su GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, cartella `/ (root)`.
3. Dopo un minuto il sito è online su `https://<tuo-utente>.github.io/nebula-quote/`.

Il file `.nojekyll` evita che GitHub Pages elabori il sito con Jekyll. Tutti i percorsi sono relativi, quindi funziona anche in una sottocartella.

## Personalizzazione

- **Prezzi e stampante**: modifica `js/config.js` (es. `machineRatePerHour`, `setupFee`, `materials.PLA.pricePerKg`, `buildVolume`).
- **Email**: imposta `contact.email` in `js/config.js` per precompilare il destinatario del pulsante email.
- **Modelli di esempio**: `node tools/generate-samples.mjs` rigenera `samples/cubo-20mm.stl` (ASCII) e `samples/vaso-nebula.stl` (binario).

## Test

```bash
node tests/geometry.test.mjs       # volumi e aree di forme note (cubo 20 mm = 8 cm³, cilindro, vaso)
npm i puppeteer-core               # solo per il test nel browser
python3 -m http.server 8765 & node tests/e2e.mjs   # test end-to-end con Chrome headless + screenshot
```

## Struttura

```
index.html            pagina
css/style.css         stile
js/config.js          tutte le costanti di prezzo e stima
js/geometry.js        parsing STL, volume, superficie, ingombro
js/estimate.js        modello di stima peso / tempo / prezzo
js/app.js             interfaccia e anteprima 3D
vendor/three/         three.js r160 (licenza MIT)
samples/              STL di esempio
tools/                generatore degli esempi
tests/                test
```
