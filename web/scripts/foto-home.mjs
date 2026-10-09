#!/usr/bin/env node
/**
 * Prepara la fotografia dell'hero della home a partire dall'originale.
 *
 *   cd web && node scripts/foto-home.mjs
 *
 * L'originale sta in `web/foto-originali/sito/home.jpg` e **non** viene
 * pubblicato: quello che finisce in rete sono le tre derivate WebP scritte qui
 * sotto, in `web/public/assets/`. Se si cambia il taglio, si modifica `FUOCO` e
 * si rilancia — non si ritocca a mano un file dentro `assets/`, che è generato.
 *
 * In questo repository l'originale non c'è, e in `assets/` ci sono dei
 * segnaposto con le stesse misure.
 *
 * ## Il taglio
 *
 * Si pubblica un 16:9 a tutta larghezza dell'originale; `FUOCO` dice dove sta
 * la fascia, in frazione dell'altezza. Il titolo della home sta in basso a
 * sinistra, sopra una velatura scura: è meglio che lì non ci sia niente che
 * conti — e, per una fotografia di gruppo, che nessuno sia rivolto
 * all'obiettivo.
 *
 * ## I metadati
 *
 * `sharp` non li copia se non glielo si chiede, e qui non glielo si chiede: le
 * derivate escono senza EXIF. Una fotografia di gruppo scattata col telefono
 * porta con sé le coordinate del posto e la data, e dentro ci sono dei minori.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const QUI = dirname(fileURLToPath(import.meta.url));
const WEB = join(QUI, "..");

const ORIGINALE = join(WEB, "foto-originali", "sito", "home.jpg");
const DESTINAZIONI = [
  join(WEB, "public", "assets"),
];

/** Dove sta la fascia 16:9, in frazione dell'altezza. Vedi il commento in cima. */
const FUOCO = 0.55;

/** La fascia 16:9 a tutta larghezza, centrata su `FUOCO` e tenuta dentro i bordi. */
function taglio(larghezza, altezza) {
  const h = Math.min(altezza, Math.round((larghezza * 9) / 16));
  const top = Math.min(Math.max(Math.round(altezza * FUOCO - h / 2), 0), altezza - h);
  return { left: 0, top, width: larghezza, height: h };
}

/**
 * Le larghezze pubblicate, dalla più grande.
 *
 * Si ferma a 1280 anche con un originale più largo: l'erba e le foglie sono
 * dettaglio fine e il WebP lo paga caro. Siccome `sizes="100vw"` fa scegliere la misura più grande
 * anche ai telefoni con schermo dense, la larghezza massima è di fatto quello
 * che pagano loro — e questa è una fotografia dietro una velatura scura, non
 * una da guardare a pieno schermo. 1280 è il punto in cui su un portatile non
 * si vede che è ingrandita e un telefono non scarica un quarto di megabyte.
 */
const MISURE = [1280, 960, 640];

/**
 * Qualità del WebP.
 *
 * Più bassa dell'82 usato per le derivate degli album, e per un motivo: lì la
 * fotografia si guarda, qui ci sta sopra una velatura fra il 28 e l'80 per
 * cento di verde scuro, e la differenza non si vede: tanto vale stare dalla
 * parte del peso.
 */
const QUALITA = 68;

const NOME = (larghezza) => `home-colonna-${larghezza}.webp`;

async function main() {
  const meta = await sharp(ORIGINALE).rotate().metadata();
  const TAGLIO = taglio(meta.autoOrient?.width ?? meta.width, meta.autoOrient?.height ?? meta.height);
  const base = sharp(ORIGINALE).rotate().extract(TAGLIO);

  for (const cartella of DESTINAZIONI) await mkdir(cartella, { recursive: true });

  for (const larghezza of MISURE) {
    const dati = await base
      .clone()
      .resize({ width: larghezza, kernel: "lanczos3" })
      .webp({ quality: QUALITA })
      .toBuffer();
    for (const cartella of DESTINAZIONI) {
      await writeFile(join(cartella, NOME(larghezza)), dati);
    }
    const kb = (dati.length / 1024).toFixed(0);
    console.log(`  ${NOME(larghezza)}  ${larghezza}×${Math.round((larghezza * TAGLIO.height) / TAGLIO.width)}  ${kb} kB`);
  }

  console.log(`\nScritte in:\n  ${DESTINAZIONI.join("\n  ")}`);
}

await main();
