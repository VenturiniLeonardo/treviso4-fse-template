#!/usr/bin/env node
/**
 * Porta le pagine rigenerate fuori dal pacchetto, nella cartella dei dati.
 *
 *   t4 npm run cache-pagine      (sul server, dopo `npm run build`)
 *
 * Quando un salvataggio nell'area riservata rigenera una pagina pubblica, Next
 * la scrive in `server/route-cache`, **dentro** il pacchetto compilato. In
 * produzione il pacchetto è di sola lettura (`ProtectSystem=strict`, e il
 * rilascio di root): la scrittura fallisce con EACCES, la pagina nuova resta
 * solo in memoria e al primo riavvio il sito torna a quella della compilazione
 * (QA BUG-013). Il codice resta di sola lettura; questa cartella sola diventa un
 * collegamento a `$SITO_DATI_DIR/cache-pagine/<BUILD_ID>`, che il servizio
 * può scrivere.
 *
 * Una cartella per compilazione: una pagina rigenerata nomina i file
 * JavaScript della build che l'ha prodotta, e un rilascio nuovo non deve
 * servire quelle del precedente. La cartella la crea anche il server
 * all'avvio (`instrumentation.ts`), che toglie quelle delle altre build: così
 * un ritorno al rilascio precedente non trova un collegamento rotto.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const DIST = process.env.SITO_DIST_DIR || ".next";
const DATI = process.env.SITO_DATI_DIR;

if (!DATI || !isAbsolute(DATI)) {
  console.error("SITO_DATI_DIR deve essere un percorso assoluto: eseguite con «t4 npm run cache-pagine».");
  process.exit(1);
}
const fileBuild = join(DIST, "BUILD_ID");
if (!existsSync(fileBuild)) {
  console.error(`Non trovo ${fileBuild}: eseguite prima «npm run build».`);
  process.exit(1);
}
const buildId = readFileSync(fileBuild, "utf8").trim();
if (!/^[A-Za-z0-9_-]+$/.test(buildId)) {
  console.error(`BUILD_ID inatteso: «${buildId}».`);
  process.exit(1);
}
const server = join(DIST, "standalone", DIST, "server");
if (!existsSync(server)) {
  console.error(`Non trovo ${server}: manca il pacchetto standalone.`);
  process.exit(1);
}

const destinazione = join(DATI, "cache-pagine", buildId);
mkdirSync(destinazione, { recursive: true, mode: 0o700 });
const collegamento = join(server, "route-cache");
rmSync(collegamento, { recursive: true, force: true });
symlinkSync(destinazione, collegamento);
console.log(`${collegamento} → ${destinazione}`);
