#!/usr/bin/env node
/**
 * Il database con cui il sito va in produzione, ricavato da quello di sviluppo.
 *
 *   SITO_PASSWORD_PROVVISORIA='…' npm run db:prepara-produzione -- --verso <cartella>
 *
 * Il sito si è riempito sul portatile: il calendario, le copertine delle unità,
 * le fotografie della Home, le persone delle unità, le cartelle dei documenti.
 * Su una macchina vuota l'installer creerebbe un database senza niente di
 * questo. Qui se ne fa una copia **di soli contenuti**, pronta da mettere in
 * `SITO_DATI_DIR` sul server:
 *
 *  1. copia coerente del database (`VACUUM INTO`) e dei file dell'archivio;
 *  2. le migrazioni, le righe di riferimento e la matrice dei permessi, come
 *     sul server (`db:applica`, `db:riferimenti`, `db:permessi`);
 *  3. via tutto ciò che non è contenuto: account di sviluppo, sessioni,
 *     registro, tentativi, inviti, coda dei lavori, messaggi, iscrizioni;
 *  4. gli account iniziali con la password provvisoria
 *     (`scripts/account-iniziali.mjs`);
 *  5. i controlli: schema atteso, integrità, chiavi esterne, nessun file
 *     mancante o di troppo.
 *
 * Il database di sviluppo si legge soltanto. Ogni tabella deve stare in uno dei
 * due elenchi qui sotto: una tabella nuova che nessuno ha classificato ferma lo
 * script, invece di finire in produzione per distrazione.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { percorsoDb } from "../lib/db/percorso.ts";

/** Contenuti e configurazione: passano come sono. */
const TENERE = new Set([
  "__drizzle_migrations",
  "anni_sociali",
  "unita",
  "unita_persone",
  "attivita",
  "album",
  "foto",
  "immagini",
  "cartelle",
  "documenti",
  "faq",
  "pagine_testi",
  "permessi",
]);

/**
 * Non sono contenuti: si svuotano. In ordine, perché le chiavi esterne sono
 * accese e `utenti` va per ultima — le righe che la puntano come autore
 * restano, con l'autore a NULL (`ON DELETE SET NULL`).
 */
const SVUOTARE = [
  "sessioni",
  "tentativi_accesso",
  "inviti",
  "limiti",
  "lavori",
  "registro",
  "messaggi",
  "richieste_gdpr",
  "album_assenze",
  "iscrizioni",
  "ragazzi",
  "proposte",
  "unita_proposte",
  "utenti",
];

const argomenti = process.argv.slice(2);
const iVerso = argomenti.indexOf("--verso");
if (iVerso < 0 || !argomenti[iVerso + 1]) {
  console.error("Uso: npm run db:prepara-produzione -- --verso <cartella vuota o nuova>");
  process.exit(1);
}
const verso = resolve(argomenti[iVerso + 1]);
if (!process.env.SITO_PASSWORD_PROVVISORIA) {
  console.error("Manca SITO_PASSWORD_PROVVISORIA: serve agli account iniziali.");
  process.exit(1);
}

const sorgente = percorsoDb();
const archivio = dirname(sorgente);
if (!existsSync(sorgente)) {
  console.error(`Il database di partenza non c'è: ${sorgente}`);
  process.exit(1);
}
if (existsSync(verso) && readdirSync(verso).length > 0) {
  console.error(`${verso} non è vuota: scegliete una cartella nuova, non si sovrascrive niente.`);
  process.exit(1);
}
mkdirSync(verso, { recursive: true });
const destinazione = join(verso, "sito.db");

console.log(`da:    ${sorgente}`);
console.log(`verso: ${destinazione}\n`);

// 1. la copia, senza scrivere sul database di partenza
const da = new Database(sorgente, { readonly: true, fileMustExist: true });
const tabelle = da
  .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
  .all()
  .map((r) => r.name);
const ignote = tabelle.filter((t) => !TENERE.has(t) && !SVUOTARE.includes(t));
if (ignote.length > 0) {
  console.error(`FERMO: tabelle che questo script non classifica: ${ignote.join(", ")}.`);
  console.error("Aggiungetele a TENERE o a SVUOTARE in scripts/prepara-produzione.mjs.");
  process.exit(1);
}
da.prepare("vacuum into ?").run(destinazione);
da.close();

const MOTORE = /^sito\.db(-wal|-shm|-journal)?$|\.nuovo$/;
let file = 0;
for (const voce of readdirSync(archivio, { withFileTypes: true })) {
  if (!voce.isFile() || MOTORE.test(voce.name)) continue;
  copyFileSync(join(archivio, voce.name), join(verso, voce.name));
  file++;
}
for (const voce of readdirSync(archivio, { withFileTypes: true })) {
  if (voce.isDirectory()) console.warn(`  ! sottocartella non copiata: ${voce.name}`);
}
console.log(`copiati il database e ${file} file dell'archivio\n`);

/** Un comando npm sul database nuovo: `SITO_DATI_DIR` punta lì, nient'altro. */
function npm(script, ...extra) {
  const ambiente = { ...process.env, SITO_DATI_DIR: verso };
  delete ambiente.SITO_DB;
  console.log(`$ npm run ${script}${extra.length ? ` -- ${extra.join(" ")}` : ""}`);
  const r = spawnSync("npm", ["run", "-s", script, ...(extra.length ? ["--", ...extra] : [])], {
    env: ambiente,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`\nFERMO: npm run ${script} è uscito con ${r.status}.`);
    process.exit(1);
  }
  console.log("");
}

// 2. lo schema e le righe che il server avrebbe
npm("db:applica");
npm("db:riferimenti");
npm("db:permessi");

// 3. via ciò che non è contenuto
const d = new Database(destinazione);
d.pragma("foreign_keys = ON");
const tolte = {};
d.transaction(() => {
  for (const t of SVUOTARE) {
    if (!tabelle.includes(t) && !esiste(d, t)) continue;
    tolte[t] = d.prepare(`delete from "${t}"`).run().changes;
  }
})();
for (const [t, n] of Object.entries(tolte)) if (n > 0) console.log(`  - ${t}: ${n} righe tolte`);
d.close();
console.log("");

// 4. gli account
npm("db:account-iniziali");

// 5. i controlli
npm("db:schema");
npm("db:orfani");
const c = new Database(destinazione);
const integrita = c.pragma("integrity_check", { simple: true });
const appese = c.pragma("foreign_key_check");
if (integrita !== "ok" || appese.length > 0) {
  console.error(`FERMO: integrity_check «${integrita}», ${appese.length} righe con chiavi appese.`);
  process.exit(1);
}
c.exec("vacuum");
// un file solo: senza `-wal` e `-shm` accanto, che copiati altrove insieme a un
// database più nuovo lo corromperebbero. L'applicazione rimette WAL da sé.
c.pragma("journal_mode = DELETE");
const conta = (t) => c.prepare(`select count(*) n from "${t}"`).get().n;
console.log("Nel database di produzione:");
for (const t of TENERE) if (t !== "__drizzle_migrations") console.log(`  ${t.padEnd(14)} ${conta(t)}`);
console.log(`  ${"utenti".padEnd(14)} ${conta("utenti")}`);
console.log(`  migrazioni     ${conta("__drizzle_migrations")}`);
c.close();

const kb = Math.round(statSync(destinazione).size / 1024);
console.log(`\nPronto: ${verso} (database ${kb} kB, ${file} file).`);

function esiste(db, t) {
  return Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(t));
}
