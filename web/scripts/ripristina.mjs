#!/usr/bin/env node
/**
 * Il ripristino da una copia. È l'altra metà di `npm run db:copia`.
 *
 *   npm run db:ripristina                       elenca le copie e non fa niente
 *   npm run db:ripristina -- --da copia-…       dice che cosa farebbe
 *   npm run db:ripristina -- --da copia-… --conferma    lo fa
 *
 * ## Perché serve, e perché ha tre passi invece di uno
 *
 * «Un backup non provato non è un backup» (§07). Un backup che nessuno sa
 * rimettere è la stessa cosa: la procedura di ripristino va scritta prima di
 * averne bisogno, perché il giorno che serve nessuno ha voglia di inventarla.
 *
 * I tre passi non sono prudenza decorativa:
 *
 *  1. **si verifica la copia prima di toccare l'originale.** Ripristinare un
 *     backup rotto sopra un database funzionante trasforma un guasto in una
 *     perdita. Se `integrity_check` non dice «ok», qui ci si ferma.
 *  2. **si mette da parte lo stato attuale.** Anche quando si ripristina di
 *     proposito, lo stato di adesso può contenere le uniche righe scritte da
 *     ieri. Diventa una copia come le altre, con il suo manifesto.
 *  3. **si scrive, e si toglie il WAL.** Un `-wal` rimasto accanto a un `.db`
 *     sostituito è la parte peggiore: SQLite lo riapplica sopra il file
 *     appena ripristinato, e il risultato non è né il vecchio né il nuovo.
 *
 * ## Prima di eseguirlo: fermate il servizio
 *
 * `systemctl stop sito`. Lo script non può accorgersi da solo che il sito
 * sta girando — vede un file, non un processo — e sostituire il database sotto
 * un'applicazione che lo tiene aperto dà un risultato che dipende dai tempi.
 * Per questo il passo che scrive vuole `--conferma` scritto a mano.
 *
 * ## Che cosa NON ripristina
 *
 * I file dell'archivio vengono **aggiunti**, non sincronizzati: un file che c'è
 * adesso e che nella copia non c'era resta dov'è. È voluto. Il caso normale è
 * «ho perso delle righe», non «voglio tornare indietro anche nelle fotografie»,
 * e cancellare fotografie di ragazzi per allinearsi a una copia di ieri è un
 * danno peggiore di quello che si stava riparando. Chi vuole l'allineamento
 * esatto svuota la cartella a mano, sapendo quello che fa.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { cartellaCopie, copia, elencoCopie, leggiManifesto } from "@/lib/db/copia";
import { CARTELLA_DATI, percorsoDb } from "@/lib/db/percorso";

const argomenti = process.argv.slice(2);
const opzione = (nome) => {
  const i = argomenti.indexOf(nome);
  return i >= 0 ? argomenti[i + 1] : undefined;
};
const kB = (b) => `${(b / 1000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} kB`;

const quale = opzione("--da");
const conferma = argomenti.includes("--conferma");

// ---------------------------------------------------------------- l'elenco
if (!quale) {
  const copie = elencoCopie();
  console.log(`copie in ${cartellaCopie()}\n`);
  if (copie.length === 0) {
    console.log("Nessuna copia da cui ripristinare. Fatene una con «npm run db:copia».");
    process.exit(1);
  }
  for (const c of copie) {
    const m = c.manifesto;
    console.log(
      `  ${c.nome}  ` +
        (m
          ? `${m.quando} · ${kB(m.byteDb)} · ${m.file} file · integrità: ${m.integrita}`
          : "manifesto illeggibile — NON usarla"),
    );
  }
  console.log("\nPer ripristinarne una:");
  console.log(`  systemctl stop sito`);
  console.log(`  npm run db:ripristina -- --da ${copie[0].nome} --conferma`);
  console.log(`  npm run db:applica          # le migrazioni, se la copia è più vecchia del codice`);
  console.log(`  systemctl start sito`);
  process.exit(0);
}

// ------------------------------------------------------- la copia scelta
const cartella = quale.includes("/") ? quale : join(cartellaCopie(), quale);
if (!existsSync(cartella)) {
  console.error(`Non trovo la copia: ${cartella}`);
  process.exit(1);
}

const manifesto = leggiManifesto(cartella);
if (!manifesto) {
  console.error(
    `La copia in ${cartella} non ha un manifesto leggibile.\n` +
      "Può essere una copia interrotta a metà: non si ripristina.",
  );
  process.exit(1);
}

const dbCopia = join(cartella, manifesto.database);
if (!existsSync(dbCopia)) {
  console.error(`Il manifesto nomina «${manifesto.database}», ma il file non c'è.`);
  process.exit(1);
}

// ---- passo 1: la copia si verifica PRIMA di toccare qualunque cosa
const controllo = new Database(dbCopia, { readonly: true });
let integrita;
try {
  integrita = String(controllo.pragma("integrity_check", { simple: true }) ?? "sconosciuto");
} finally {
  controllo.close();
}

console.log(`copia:     ${cartella}`);
console.log(`fatta il:  ${manifesto.quando}`);
console.log(`database:  ${kB(statSync(dbCopia).size)} · integrità adesso: ${integrita}`);
console.log(`archivio:  ${manifesto.file} file`);

if (integrita !== "ok") {
  console.error(
    `\n<3>Questa copia NON è integra («${integrita}»). Non la ripristino: ` +
      "rimetterla sopra un database funzionante trasformerebbe un guasto in una perdita.",
  );
  process.exit(1);
}

const archivioCopia = join(cartella, "archivio");
const daAggiungere = existsSync(archivioCopia)
  ? readdirSync(archivioCopia, { withFileTypes: true })
      .filter((v) => v.isFile() && !existsSync(join(CARTELLA_DATI, v.name)))
      .map((v) => v.name)
  : [];

console.log(`\nDestinazione:`);
console.log(`  database  ${percorsoDb()}`);
console.log(`  archivio  ${CARTELLA_DATI}  (${daAggiungere.length} file da rimettere)`);

if (!conferma) {
  console.log(
    "\nProva a vuoto: non ho toccato niente.\n" +
      "Per farlo davvero, fermate prima il servizio e aggiungete --conferma:\n\n" +
      `  systemctl stop sito\n  npm run db:ripristina -- --da ${basename(cartella)} --conferma\n`,
  );
  process.exit(0);
}

// ---- passo 2: lo stato di adesso diventa una copia come le altre
console.log("\nMetto da parte lo stato attuale…");
try {
  const salvata = copia(0);
  console.log(`  fatto: ${salvata.cartella}  (integrità: ${salvata.integrita})`);
} catch (e) {
  console.error(
    `<3>Non sono riuscito a mettere da parte lo stato attuale: ${e.message}\n` +
      "Mi fermo: ripristinare senza una via di ritorno non è un ripristino, è una scommessa.",
  );
  process.exit(1);
}

// ---- passo 3: si scrive, e si toglie il WAL
console.log("Ripristino il database…");
for (const coda of ["-wal", "-shm"]) {
  // PRIMA del file: un WAL rimasto verrebbe riapplicato sopra ciò che scriviamo
  rmSync(percorsoDb() + coda, { force: true });
}
copyFileSync(dbCopia, percorsoDb());

console.log("Rimetto i file che mancavano…");
mkdirSync(CARTELLA_DATI, { recursive: true });
let rimessi = 0;
for (const nome of daAggiungere) {
  copyFileSync(join(archivioCopia, nome), join(CARTELLA_DATI, nome));
  rimessi++;
}

// ---- la prova finale: il database ripristinato si apre e ha le righe attese
const dopo = new Database(percorsoDb(), { readonly: true });
let integritaDopo;
const righe = {};
try {
  integritaDopo = String(dopo.pragma("integrity_check", { simple: true }) ?? "sconosciuto");
  for (const t of Object.keys(manifesto.righe ?? {})) {
    try {
      righe[t] = dopo.prepare(`select count(*) n from ${t}`).get().n;
    } catch {
      righe[t] = null;
    }
  }
} finally {
  dopo.close();
}

console.log(`\nRipristinati: database + ${rimessi} file.`);
console.log(`integrità dopo il ripristino: ${integritaDopo}`);

const diverse = Object.entries(righe).filter(([t, n]) => n !== manifesto.righe[t]);
if (diverse.length) {
  console.error(
    `<3>Le righe non corrispondono al manifesto: ` +
      diverse.map(([t, n]) => `${t} ${n} invece di ${manifesto.righe[t]}`).join(", "),
  );
  process.exit(1);
}
console.log("righe: corrispondono al manifesto.");

console.log(
  "\nOra:\n" +
    "  npm run db:applica     # se la copia è più vecchia del codice in linea\n" +
    "  systemctl start sito\n" +
    "  curl -fsS https://<dominio>/api/health\n",
);
