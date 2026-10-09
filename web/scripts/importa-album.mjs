#!/usr/bin/env node
/**
 * Crea un album da una cartella di fotografie, con la sua password.
 *
 *   npm run db:importa-album -- --cartella <dir> --titolo "<titolo>" \
 *     --data "Settembre 2026" [--anno "2026 – 2027"] [--unita gruppo] \
 *     [--sottotitolo "<riga>"] [--password <password>] [--in-revisione]
 *
 * È la strada per un album grande, quando caricarlo dal browser vorrebbe dire
 * quattro invii da quaranta fotografie. Fa **le stesse cose** dell'area
 * riservata, con le stesse funzioni: `creaAlbum`, `impostaPasswordAlbum`,
 * `aggiungiFoto` — quindi stessi controlli su formato e misure, stesso
 * originale ripulito dei metadati, stesse derivate. Alla fine aspetta che la
 * coda le abbia generate tutte, come `db:derivate`.
 *
 * ## Che cosa non fa: pubblicare
 *
 * L'album resta in bozza, o in revisione con `--in-revisione`. La pubblicazione
 * è dei gestori, dall'area riservata, perché è il momento in cui si
 * controllano i consensi: sono fotografie di minori, e uno script non sa chi
 * compare in quali scatti. Pubblicare da qui salterebbe proprio quel controllo.
 *
 * ## La password
 *
 * Se non si passa `--password`, ne propone una con le stesse regole del modulo
 * dell'area (`lib/album-password.ts`) e la stampa una volta. Si rilegge poi
 * nella scheda dell'album.
 *
 * Le fotografie si caricano in ordine di nome: chi prepara la cartella le
 * numera nell'ordine in cui devono comparire. JPEG e PNG, come dal browser; un
 * HEIC va convertito prima.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { creaAlbum, indirizzoLibero, aggiungiFoto, cambiaStatoAlbum } from "@/lib/album";
import { impostaPasswordAlbum } from "@/lib/album-accesso";
import { errorePasswordAlbum, proponiPasswordAlbum } from "@/lib/album-password";
import { TUTTE_LE_UNITA } from "@/lib/data";
import { percorsoDb } from "@/lib/db/percorso";
import { accodaMancanti, attendiCoda, avvia, statoCoda } from "@/lib/foto/coda";

function argomento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function esci(messaggio) {
  console.error(messaggio);
  process.exit(1);
}

const cartella = argomento("cartella");
const titolo = argomento("titolo")?.trim();
const data = argomento("data")?.trim();
const anno = argomento("anno")?.trim() ?? "2026 – 2027";
const unita = argomento("unita")?.trim() ?? "gruppo";
const sottotitolo = argomento("sottotitolo")?.trim() ?? "";
const password = argomento("password")?.trim() ?? proponiPasswordAlbum();

if (!cartella || !titolo || !data) {
  esci('Servono almeno --cartella, --titolo e --data (per esempio "Settembre 2026").');
}
if (titolo.length < 3 || titolo.length > 90) esci("Il titolo deve stare fra 3 e 90 caratteri.");
if (!/^\d{4} – \d{4}$/.test(anno)) esci("L’anno sociale si scrive «2026 – 2027», con il trattino lungo.");
if (!TUTTE_LE_UNITA.includes(unita)) esci(`Unità sconosciuta: ${unita}. Valgono: ${TUTTE_LE_UNITA.join(", ")}.`);
const erroreP = errorePasswordAlbum(password);
if (erroreP) esci(erroreP);

let file;
try {
  file = readdirSync(cartella).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
} catch (e) {
  esci(`Non riesco a leggere ${cartella}: ${e.message}`);
}
if (file.length === 0) esci(`In ${cartella} non ci sono JPEG né PNG.`);

/*
 * Un album con lo stesso titolo c'è già? Allora ci si ferma.
 *
 * `creaAlbum` non si ferma: sceglierebbe un indirizzo libero con un numero in
 * fondo, e rilanciare lo script per sbaglio produrrebbe un secondo album con le
 * stesse centoventi fotografie. Qui è quasi sempre un errore, e va detto.
 */
const atteso = await indirizzoLibero(titolo);
if (/-\d+$/.test(atteso)) {
  esci(
    `Esiste già un album con questo titolo. Non ne creo un secondo: se è rimasto a metà, ` +
      "eliminatelo dall'area riservata e rilanciate.",
  );
}

console.log(`database: ${percorsoDb()}`);
console.log(`cartella: ${cartella} — ${file.length} fotografie\n`);

const slug = await creaAlbum(
  { titolo, anno, unita, data, sottotitolo, tag: titolo },
  Date.now(),
  "",
);
impostaPasswordAlbum(slug, password);
console.log(`album creato: /foto/${slug}`);

let caricate = 0;
const scartate = [];
for (const [i, nome] of file.entries()) {
  const esito = await aggiungiFoto(slug, readFileSync(join(cartella, nome)), "", Date.now() + i, "");
  if (esito.ok) caricate++;
  else scartate.push(`${nome}: ${esito.errore}`);
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${file.length}`);
}
console.log(`\n${caricate} caricate${scartate.length ? `, ${scartate.length} scartate:` : "."}`);
for (const s of scartate) console.log(`  ! ${s}`);

if (process.argv.includes("--in-revisione")) {
  await cambiaStatoAlbum(slug, "in-revisione", Date.now(), "");
  console.log("\nMandato in revisione: lo trovate nella coda delle approvazioni dei gestori.");
} else {
  console.log("\nResta in bozza.");
}

// le derivate: finché mancano, le fotografie escono a piena misura
accodaMancanti();
avvia();
console.log("\nconversione delle derivate, una alla volta…");
await attendiCoda();
const coda = statoCoda();
console.log(`  fatto${coda.errore ? ` — ${coda.errore} conversioni fallite: vedi «Album e foto»` : ""}.`);

console.log(
  `\nPassword dell'album: ${password}\n` +
    "Si rilegge nella scheda dell'album. Per pubblicarlo: area riservata, «Album\n" +
    "fotografici», dopo aver controllato i consensi delle persone ritratte.",
);
