#!/usr/bin/env node
/**
 * I file in archivio che nessuno indicizza, e le righe senza file.
 *
 *   npm run db:orfani                 guarda e riferisce, non tocca niente
 *   npm run db:orfani -- --sposta     mette gli orfani in quarantena
 *   npm run db:orfani -- --grazia 30  ignora quelli scritti negli ultimi 30 giorni
 *
 * ## Non cancella. Mai.
 *
 * `--sposta` **sposta** in `dati/orfani-<data>/`. Cancellare è un comando che
 * date voi, quando avete guardato quella cartella e siete convinti:
 *
 *     rm -rf dati/orfani-2026-08-31
 *
 * Non è prudenza per abitudine. Cancellare file guardando il database vuol dire
 * fidarsi che il database sia quello giusto, completo e leggibile; se una sola
 * delle tre cose non è vera, «gli orfani» sono tutte le fotografie del gruppo.
 * Uno spostamento sbagliato si annulla con un `mv`. Una cancellazione sbagliata
 * si annulla con un ripristino — che è la cosa che questo progetto ancora non
 * ha (vedi docs/implementation/audit-finale.md §7).
 *
 * ## E le righe senza file
 *
 * Le riferisce e basta. Una fotografia la cui riga c'è ma il file no è un
 * riquadro rotto nella pagina: si sistema ricaricando il file, non cancellando
 * la riga — e infatti qui non c'è nessuna opzione per cancellarla.
 */
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { confronta } from "@/lib/archivio-orfani";
import { CARTELLA_DATI } from "@/lib/db/percorso";
import { percorsoDb } from "@/lib/db/percorso";

const argomenti = process.argv.slice(2);
const sposta = argomenti.includes("--sposta");
const iGrazia = argomenti.indexOf("--grazia");
const grazia = iGrazia >= 0 ? Number(argomenti[iGrazia + 1]) : 7;

if (!Number.isFinite(grazia) || grazia < 0) {
  console.error("--grazia vuole un numero di giorni.");
  process.exit(1);
}

const bytes = (n) =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1)} MB`;

console.log(`database: ${percorsoDb()}`);
console.log(`archivio: ${CARTELLA_DATI}`);
console.log(`grazia:   ${grazia} giorni\n`);

const esito = confronta(grazia);

console.log(`file dell'applicazione in archivio: ${esito.esaminati}`);
console.log(`nomi che il database si aspetta:    ${esito.attesi}\n`);

/*
 * Il sospetto ferma tutto, e non è un avviso da leggere di sfuggita.
 *
 * È il caso in cui l'elenco degli orfani è tecnicamente corretto e
 * praticamente falso: il confronto è stato fatto con il database sbagliato.
 * Proseguire spostando i file sarebbe l'unica azione irreparabile che questo
 * script può compiere, quindi non la compie.
 */
if (esito.sospetto) {
  console.error(`FERMO: ${esito.sospetto}\n`);
  process.exit(1);
}

if (esito.righeSenzaFile.length > 0) {
  console.log(`RIGHE SENZA FILE — ${esito.righeSenzaFile.length}`);
  console.log("  Nella pagina si vedono come riquadri rotti o scaricamenti falliti.");
  console.log("  Si sistemano ricaricando il file, non cancellando la riga.\n");
  for (const r of esito.righeSenzaFile) {
    console.log(`  ${r.genere.padEnd(10)} ${r.dove}`);
  }
  console.log("");
}

if (esito.orfani.length === 0) {
  console.log("Nessun file orfano.");
  process.exit(esito.righeSenzaFile.length > 0 ? 2 : 0);
}

const totale = esito.orfani.reduce((n, o) => n + o.byte, 0);
console.log(`FILE ORFANI — ${esito.orfani.length}, ${bytes(totale)} in tutto`);
for (const o of esito.orfani) {
  console.log(`  ${bytes(o.byte).padStart(9)}  ${String(o.giorni).padStart(4)}g  ${o.nome}`);
}
console.log("");

if (!sposta) {
  console.log("Non ho toccato niente. Per metterli in quarantena:");
  console.log("  npm run db:orfani -- --sposta");
  process.exit(esito.righeSenzaFile.length > 0 ? 2 : 0);
}

const cartella = join(CARTELLA_DATI, `orfani-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(cartella, { recursive: true });

let spostati = 0;
for (const o of esito.orfani) {
  try {
    renameSync(join(CARTELLA_DATI, o.nome), join(cartella, o.nome));
    spostati++;
  } catch (errore) {
    console.error(`  non sono riuscito a spostare ${o.nome}: ${errore.message}`);
  }
}

console.log(`Spostati ${spostati} file in ${cartella}`);
console.log("Guardateli, e quando siete convinti:");
console.log(`  rm -rf ${cartella}`);
process.exit(esito.righeSenzaFile.length > 0 ? 2 : 0);
