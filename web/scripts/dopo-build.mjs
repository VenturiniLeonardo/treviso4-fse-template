#!/usr/bin/env node
/**
 * I controlli che si possono fare **solo sul pacchetto compilato**.
 *
 *   node scripts/dopo-build.mjs      (dopo `npm run build`)
 *
 * Le prove di `npm test` guardano il sorgente; questo guarda l'HTML che uscirà
 * davvero dal server. Sono due cose diverse: un segnaposto può entrare in
 * pagina da `lib/data.ts`, da un componente, o da un valore predefinito che
 * nessuna prova sul sorgente vede passare.
 *
 * Esce con `1` al primo problema. È pensato per la CI, ma serve soprattutto
 * prima di un rilascio a mano.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/*
 * La cartella della compilazione. `.next`, o quella che ha chiesto chi ha
 * compilato: `scripts/copia-cloudflare.py` compila in `.next-pubblico` per
 * non sostituire la build che si rilascia. Vedi `distDir` in next.config.ts.
 */
const DIST = process.env.SITO_DIST_DIR || ".next";
const APP = `${DIST}/server/app`;
let problemi = 0;
const guaio = (m) => {
  console.error(`  ✗ ${m}`);
  problemi++;
};
const ok = (m) => console.log(`  ✓ ${m}`);

if (!existsSync(APP)) {
  console.error(`Non trovo ${APP}: eseguite prima «npm run build».`);
  process.exit(1);
}

/** Tutte le pagine prerenderizzate. */
function pagine(dir = APP, raccolte = []) {
  for (const v of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, v.name);
    if (v.isDirectory()) pagine(p, raccolte);
    else if (v.name.endsWith(".html")) raccolte.push(p);
  }
  return raccolte;
}

const html = pagine();
console.log(`pagine prerenderizzate: ${html.length}\n`);

// Erano 31, e la soglia 20. Sono 19 da quando le pagine degli album sono
// dinamiche — mostrano le foto solo a chi ha la password, e lo decide il cookie
// della richiesta — quindi i dodici album del seme non si prerenderizzano più.
// La soglia resta sotto il conteggio vero con un margine: serve a vedere una
// compilazione dimezzata, non a contare le pagine una per una.
if (html.length < 15) {
  guaio(`solo ${html.length} pagine: la compilazione sembra incompleta`);
}

/*
 * I segnaposto che non devono comparire in pagina.
 *
 * `Mario Rossi` non è nell'elenco: sta in un `placeholder=` del modulo
 * contatti come esempio, ed è marcato «es.». Un esempio dentro una casella
 * vuota non è un contenuto finto — è come si scrivono i moduli.
 */
console.log("segnaposto nell'HTML servito:");
const VIETATI = [
  "Lorem ipsum",
  "lorem ipsum",
  "Nome Cognome",
  "coming soon",
  "TODO",
  "FIXME",
  "19XX",
  "esempio.invalid",
  "340 000 000",
  "00000000000",
];
for (const testo of VIETATI) {
  const dove = html.filter((f) => readFileSync(f, "utf8").includes(testo));
  if (dove.length) guaio(`«${testo}» in ${dove.length} pagine: ${dove.slice(0, 3).join(", ")}`);
}
if (problemi === 0) ok("nessuno");

/*
 * «segnaposto» è ammesso in **una** pagina: la dichiarazione di accessibilità,
 * che deve elencare i limiti noti — e le immagini segnaposto sono un limite
 * noto. Ammetterla senza contarla vorrebbe dire non accorgersi se domani ne
 * comparisse un'altra.
 */
const conSegnaposto = html.filter((f) => readFileSync(f, "utf8").includes("segnaposto"));
const ammesse = conSegnaposto.filter((f) => f.includes("accessibilita"));
if (conSegnaposto.length !== ammesse.length) {
  guaio(
    `«segnaposto» in pagine che non sono la dichiarazione di accessibilità: ` +
      conSegnaposto.filter((f) => !f.includes("accessibilita")).join(", "),
  );
} else {
  ok(`«segnaposto» solo dove è un limite dichiarato (${ammesse.length} pagina)`);
}

console.log("\nindirizzi di sviluppo:");
for (const testo of ["localhost:", "127.0.0.1"]) {
  const dove = html.filter((f) => readFileSync(f, "utf8").includes(testo));
  if (dove.length) guaio(`«${testo}» in ${dove.length} pagine: ${dove.slice(0, 3).join(", ")}`);
}
if (!html.some((f) => /localhost:|127\.0\.0\.1/.test(readFileSync(f, "utf8")))) ok("nessuno");

console.log("\nil pacchetto standalone:");
const STANDALONE = `${DIST}/standalone`;
if (!existsSync(STANDALONE)) {
  guaio(`manca ${STANDALONE}: \`postbuild\` non è passato`);
} else {
  const dentro = readdirSync(STANDALONE);
  for (const brutto of [".env", ".env.local", "utenti.json", "dati"]) {
    if (dentro.includes(brutto)) guaio(`«${brutto}» dentro il pacchetto: non deve uscire di qui`);
  }
  if (!dentro.includes("server.js")) guaio("manca server.js");
  if (!dentro.includes("public")) guaio("manca public/: `postbuild` non l'ha copiata");
  if (problemi === 0) ok("nessun file sensibile, server.js e public/ al loro posto");
}

console.log("");
if (problemi > 0) {
  console.error(`${problemi} problemi. Il pacchetto NON è pronto.`);
  process.exit(1);
}
console.log("Il pacchetto compilato è pulito.");
