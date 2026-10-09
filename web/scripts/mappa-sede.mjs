#!/usr/bin/env node
/**
 * Genera la mappa della sede, come immagine statica.
 *
 *   . .toolchain/activate
 *   cd web && node scripts/mappa-sede.mjs
 *
 * ## Perché non Google Maps
 *
 * Le immagini di Google Maps non si possono prendere e basta: servono una
 * chiave della Static Maps API e un contratto di fatturazione, e i termini
 * escludono lo screenshot ripubblicato. OpenStreetMap invece è dato aperto
 * (ODbL): si può usare, a patto di citare chi l'ha fatto — la citazione è
 * scritta dentro l'immagine e ripetuta accanto alla mappa nella pagina.
 *
 * ## Perché un'immagine e non una mappa interattiva
 *
 * Una mappa incorporata è una richiesta a un dominio terzo su ogni visita alla
 * pagina Contatti, e §04 del piano dice il contrario — è lo stesso motivo per
 * cui i caratteri sono serviti dal nostro dominio invece che da Google Fonts.
 * Questa immagine si genera una volta e poi è un file come gli altri: chi apre
 * la pagina non dice a nessuno che l'ha aperta. Il pulsante «Apri in Google
 * Maps» resta lì accanto per chi vuole la mappa vera e le indicazioni.
 *
 * ## Le tessere
 *
 * Si scaricano dal server pubblico di OpenStreetMap, una trentina, una volta
 * sola: la loro politica d'uso vieta lo scarico in massa e chiede un
 * `User-Agent` che dica chi sei, ed è quello che si fa qui. Il risultato è un
 * file versionato, quindi la generazione non si ripete a ogni compilazione.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const QUI = dirname(fileURLToPath(import.meta.url));
const DESTINAZIONI = [join(QUI, "..", "public", "assets")];

/** Le stesse coordinate di `GRUPPO.coordinate` in `lib/data.ts`: di esempio. */
const LAT = 41.9028;
const LON = 12.4964;

/**
 * Zoom 17: circa 0,8–0,9 metri per pixel alle latitudini italiane, cioè un chilometro
 * scarso di larghezza. Abbastanza stretto da leggere i nomi delle vie,
 * abbastanza largo da capire in che parte della città si è.
 */
const ZOOM = 17;

/** Tela di partenza: 1,5:1, generosa abbastanza da reggere il doppio della
 *  densità sul riquadro da 528 px del desktop. */
const LARGA = 1200;
const ALTA = 800;

const LATI = [1200, 800, 560];
const QUALITA = 80;
const TESSERA = 256;

/** La politica d'uso di OpenStreetMap chiede un recapito vero: mettete il vostro. */
const AGENTE =
  "SitoModello/1.0 (mappa della sede, una tantum; segreteria@example.org)";

/** Coordinate → pixel assoluti nella proiezione delle tessere (Web Mercator). */
function inPixel(lat, lon, zoom) {
  const n = TESSERA * 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const senoLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + senoLat) / (1 - senoLat)) / (4 * Math.PI)) * n;
  return { x, y };
}

async function scaricaTessera(z, x, y) {
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const r = await fetch(url, { headers: { "User-Agent": AGENTE } });
  if (!r.ok) throw new Error(`tessera ${z}/${x}/${y}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Il segnaposto: una goccia nei colori del sito, non quella di serie. */
function segnaposto(altezza = 74) {
  const l = Math.round(altezza * 0.7);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="${altezza}" viewBox="0 0 42 58">
       <path d="M21 57C21 57 40 34.5 40 21A19 19 0 1 0 2 21C2 34.5 21 57 21 57Z"
             fill="#002144" stroke="#ffffff" stroke-width="3"/>
       <circle cx="21" cy="21" r="7.5" fill="#ffcc00"/>
     </svg>`,
  );
}

/** La citazione obbligatoria, scritta dentro l'immagine. */
function citazione(larghezza) {
  const h = 26;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${larghezza}" height="${h}">
       <rect width="${larghezza}" height="${h}" fill="#ffffff" fill-opacity="0.82"/>
       <text x="${larghezza - 10}" y="18" text-anchor="end"
             font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#31414f"
             >© OpenStreetMap contributors</text>
     </svg>`,
  );
}

async function main() {
  const centro = inPixel(LAT, LON, ZOOM);
  const sinistra = centro.x - LARGA / 2;
  const alto = centro.y - ALTA / 2;

  const xDa = Math.floor(sinistra / TESSERA);
  const xA = Math.floor((sinistra + LARGA - 1) / TESSERA);
  const yDa = Math.floor(alto / TESSERA);
  const yA = Math.floor((alto + ALTA - 1) / TESSERA);
  const quante = (xA - xDa + 1) * (yA - yDa + 1);
  console.log(`  zoom ${ZOOM}, ${quante} tessere da tile.openstreetmap.org`);

  const pezzi = [];
  for (let x = xDa; x <= xA; x++) {
    for (let y = yDa; y <= yA; y++) {
      pezzi.push({
        input: await scaricaTessera(ZOOM, x, y),
        left: Math.round(x * TESSERA - sinistra),
        top: Math.round(y * TESSERA - alto),
      });
      // gentilezza verso un server pubblico e gratuito
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  const alt = 74;
  const base = await sharp({
    create: { width: LARGA, height: ALTA, channels: 3, background: "#e8e4dc" },
  })
    .composite([
      ...pezzi,
      // la punta della goccia cade sul punto, non il suo centro
      { input: segnaposto(alt), left: Math.round(LARGA / 2 - alt * 0.35), top: Math.round(ALTA / 2 - alt) },
      { input: citazione(LARGA), left: 0, top: ALTA - 26 },
    ])
    .png()
    .toBuffer();

  for (const cartella of DESTINAZIONI) await mkdir(cartella, { recursive: true });
  for (const larghezza of LATI) {
    const dati = await sharp(base)
      .resize({ width: larghezza, kernel: "lanczos3" })
      .webp({ quality: QUALITA })
      .toBuffer();
    for (const cartella of DESTINAZIONI) {
      await writeFile(join(cartella, `mappa-sede-${larghezza}.webp`), dati);
    }
    console.log(
      `  mappa-sede-${larghezza}.webp  ${larghezza}×${Math.round((larghezza * ALTA) / LARGA)}  ${(dati.length / 1024).toFixed(0)} kB`,
    );
  }
  console.log(`\nScritte in:\n  ${DESTINAZIONI.join("\n  ")}`);
}

await main();
