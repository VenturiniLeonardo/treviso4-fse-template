#!/usr/bin/env node
/**
 * Bonifica i metadati degli originali già in archivio.
 *
 *   npm run db:metadati                 esamina e dice cosa farebbe (predefinito)
 *   npm run db:metadati -- --pulisci    ripulisce davvero
 *
 * Serve una volta sola, su un archivio popolato prima che il caricamento
 * ripulisse gli originali. Rieseguirlo non fa danni: i file già puliti li salta.
 *
 * ## Perché l'esame è il comportamento predefinito
 *
 * Perché riscrive fotografie di ragazzi, e la modalità che si ottiene battendo
 * il comando senza leggere la documentazione deve essere quella che non tocca
 * niente. `--pulisci` va scritto a mano.
 *
 * ## Prima di eseguirlo con --pulisci
 *
 *   npm run db:copia
 *
 * Non perché sia rischioso — la sostituzione è atomica e verificata prima e
 * dopo — ma perché è l'unica operazione che riscrive in blocco dei file che non
 * si possono rifare, e una copia costa dieci secondi.
 *
 * Il codice d'uscita è `1` se qualche file ha dato errore: quelli restano come
 * erano, e vanno guardati uno per uno.
 */
import { bonifica } from "@/lib/foto/bonifica";
import { CARTELLA_DATI, percorsoDb } from "@/lib/db/percorso";

const pulisci = process.argv.includes("--pulisci");
const kB = (b) => `${(b / 1000).toFixed(0)} kB`;

console.log(`database: ${percorsoDb()}`);
console.log(`archivio: ${CARTELLA_DATI}`);
console.log(pulisci ? "modo:     PULISCO\n" : "modo:     solo esame (niente viene scritto)\n");

const e = await bonifica(pulisci);

if (e.esaminati === 0) {
  console.log("Nessun originale indicizzato dal database: niente da esaminare.");
  process.exit(0);
}

const perStato = {};
for (const f of e.file) perStato[f.stato] = (perStato[f.stato] ?? 0) + 1;

for (const f of e.file) {
  if (f.stato === "pulito") continue; // il caso normale: non si stampa
  const segno =
    f.stato === "riscritto" ? "✓" : f.stato === "da-pulire" ? "·" : f.stato === "saltato" ? "-" : "!";
  console.log(
    `  ${segno} ${f.file}  [${f.genere}]  ${kB(f.byte)}` +
      (f.byteDopo !== undefined ? ` → ${kB(f.byteDopo)}` : "") +
      (f.motivo ? `  — ${f.motivo}` : ""),
  );
}

console.log("");
console.log(`esaminati:      ${e.esaminati}`);
console.log(`già puliti:     ${perStato.pulito ?? 0}`);
console.log(`con metadati:   ${e.conMetadati}`);
if (pulisci) console.log(`riscritti:      ${e.riscritti}`);
if (perStato.saltato) console.log(`saltati:        ${perStato.saltato}`);
if (e.errori) console.log(`ERRORI:         ${e.errori}`);

if (!pulisci && e.conMetadati > 0) {
  console.log("");
  console.log(`${e.conMetadati} file portano ancora metadati (modello dell'apparecchio,`);
  console.log("e in certi casi le coordinate GPS del posto dove è stata scattata).");
  console.log("Per toglierli:");
  console.log("");
  console.log("  npm run db:copia                    # prima una copia");
  console.log("  npm run db:metadati -- --pulisci");
  process.exit(0);
}

if (e.errori > 0) {
  console.error(
    `<3>\n${e.errori} file non sono stati riscritti e sono rimasti come erano.\n` +
      "Guardate i motivi qui sopra: un file illeggibile è un caso da «db:orfani»,\n" +
      "un file che non è un'immagine non va toccato da questo comando.",
  );
  process.exit(1);
}

if (pulisci) {
  console.log("");
  console.log(
    e.riscritti > 0
      ? "Fatto. I nomi dei file non sono cambiati, quindi nessun riferimento si è rotto."
      : "Niente da fare: erano già tutti puliti.",
  );
}
