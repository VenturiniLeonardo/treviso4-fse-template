#!/usr/bin/env node
/**
 * I lavori notturni di §16, quelli che riguardano il database.
 *
 *   npm run db:notturno              tutto quello che tocca stanotte
 *   npm run db:notturno -- --vacuum  forza il VACUUM, fuori turno
 *   npm run db:notturno -- --secco   dice cosa farebbe, senza farlo
 *
 * Un solo comando e non cinque, perché cinque unità systemd che scrivono sullo
 * stesso SQLite a distanza di venti minuti sono cinque occasioni di trovarlo
 * occupato, per un lavoro che dura meno di un secondo. L'orario di §16 resta nel
 * timer; qui c'è la sequenza.
 *
 * Sostituisce `scripts/pulizia.mjs` della fase 8, che faceva un pezzo di questo:
 * due script che ripuliscono le stesse tabelle sono due posti da tenere
 * allineati, e il giorno che divergono uno dei due cancella qualcosa che
 * l'altro credeva di conservare. `npm run db:pulizia` resta come alias, perché
 * un comando che sparisce fallisce in silenzio ogni notte in un timer che
 * qualcuno aveva già scritto.
 *
 * ## Che cosa NON fa
 *
 * Il backup delle foto e la verifica della copia — le righe 02:30 e 03:00 di
 * §16 — non sono qui. Sono `restic` verso un bucket, cioè credenziali e un
 * indirizzo che questo repository non conosce e che non vanno inventati. Le
 * unità systemd per quelli stanno nel piano infrastrutturale; `deploy/README.md`
 * dice quali sono e perché non le trovate qui.
 *
 * ## Il codice d'uscita
 *
 * `0` se è andato tutto; `1` se qualcosa è fallito; **`2` se ha trovato album
 * pubblicati non conformi**. Il due è separato di proposito: non è un guasto del
 * lavoro notturno, è un guasto che il lavoro notturno ha scoperto, e in un
 * `systemctl status` la differenza fra «il timer è rotto» e «il timer ha visto
 * qualcosa» è quella che decide chi si alza dal letto.
 */
import { GIORNI_CESTINO, svuotaCestino } from "@/lib/album";
import { pulisci as pulisciInviti } from "@/lib/auth/inviti";
import { pulisci as pulisciSessioni } from "@/lib/auth/sessioni";
import { pulisci as pulisciTentativi } from "@/lib/auth/tentativi";
import { dimensioneDb, manutenzione } from "@/lib/db/manutenzione";
import { percorsoDb } from "@/lib/db/percorso";
import { albumNonConformi } from "@/lib/iscritti-store";
import { pulisci as pulisciLimiti } from "@/lib/limiti";
import { CONSERVAZIONE_MESI as MESI_MESSAGGI, pulisci as pulisciMessaggi } from "@/lib/messaggi-store";
import {
  accorciaFuoriMisura,
  conserva,
  CONSERVAZIONE_MESI as MESI_REGISTRO,
  TIPI_CONSERVATI,
} from "@/lib/registro-store";

/**
 * Sotto systemd, la priorità delle righe si dichiara con un prefisso.
 *
 * journald legge `<3>` come «errore» e `<4>` come «avviso», li toglie dal testo
 * e imposta la priorità della voce. Senza, tutto quello che questo script
 * stampa finisce a livello `info`, e `journalctl -p err` non mostra niente —
 * cioè il modo più semplice di cercare i guai non trova quelli che questo
 * lavoro ha scoperto.
 *
 * `JOURNAL_STREAM` la imposta systemd quando l'uscita va al journal: fuori di
 * là i prefissi resterebbero visibili nel terminale, e sarebbero rumore.
 */
const sottoJournald = Boolean(process.env.JOURNAL_STREAM);
const err = (testo) => console.error(`${sottoJournald ? "<3>" : ""}${testo}`);
const avviso = (testo) => console.error(`${sottoJournald ? "<4>" : ""}${testo}`);

const argomenti = process.argv.slice(2);
const secco = argomenti.includes("--secco");
const vacuumForzato = argomenti.includes("--vacuum");

/**
 * Il `VACUUM` una volta al mese, come dice §16.
 *
 * Il primo giorno del mese e non «ogni trenta esecuzioni»: un contatore da
 * qualche parte sarebbe uno stato in più da tenere, e il giorno del mese lo sa
 * già il sistema. Se il server è spento il primo del mese, salta un mese — ed è
 * un'operazione di igiene, non di correttezza.
 */
const oggi = new Date();
const turnoVacuum = oggi.getUTCDate() === 1;

const bytes = (n) =>
  n === null ? "—" : n < 1024 * 1024 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1)} MB`;

console.log(`lavori notturni · ${oggi.toISOString().slice(0, 19)}Z`);
console.log(`database: ${percorsoDb()}  (${bytes(dimensioneDb())})`);
if (secco) console.log("MODALITÀ SECCA: non scrivo niente.\n");

let problemi = 0;
let nonConformi = [];

/**
 * Esegue un passo, e non lascia che un passo fallito fermi gli altri.
 *
 * `soloLettura` distingue i passi che in modalità secca girano comunque: il
 * controllo di conformità non scrive niente, e in una prova a vuoto è la cosa
 * che si vuole più vedere. Saltarlo perché «non scriviamo» darebbe una prova
 * secca che tace proprio sull'unica informazione utile.
 */
function passo(nome, fn, soloLettura = false) {
  if (secco && !soloLettura) {
    console.log(`  ${nome}: non eseguito (secca)`);
    return undefined;
  }
  try {
    return fn();
  } catch (errore) {
    problemi++;
    err(`  ${nome}: FALLITO — ${errore instanceof Error ? errore.message : errore}`);
    return undefined;
  }
}

// --- 02:10 · conservazione ------------------------------------------------
console.log("\nconservazione");
const messaggi = passo("messaggi", () => pulisciMessaggi());
if (messaggi !== undefined) {
  console.log(`  messaggi: ${messaggi} cancellati (oltre ${MESI_MESSAGGI} mesi)`);
}
const registro = passo("registro", () => conserva());
if (registro !== undefined) {
  console.log(
    `  registro: ${registro.cancellate} cancellate (oltre ${MESI_REGISTRO} mesi), ` +
      `${registro.conservate} conservate perché di tipo ${TIPI_CONSERVATI.join("/")}`,
  );
}
// voci scritte prima dei tetti di `registra()`: di solito nessuna
const accorciate = passo("registro fuori misura", () => accorciaFuoriMisura());
if (accorciate) console.log(`  registro: ${accorciate} voci fuori misura accorciate`);

/*
 * Il cestino degli album (audit degli accessi, A-1): le fotografie eliminate da
 * più di trenta giorni si cancellano davvero, riga e file. È l'unico passo che
 * tocca l'archivio dei file, ed è asincrono per questo: `passo()` non lo può
 * avvolgere, quindi ha il suo `try`.
 */
if (secco) {
  console.log("  cestino delle fotografie: non eseguito (secca)");
} else {
  try {
    const portate = await svuotaCestino();
    console.log(
      `  cestino delle fotografie: ${portate.length} ` +
        `${portate.length === 1 ? "cancellata" : "cancellate"} (oltre ${GIORNI_CESTINO} giorni)`,
    );
  } catch (errore) {
    problemi++;
    err(`  cestino delle fotografie: FALLITO — ${errore instanceof Error ? errore.message : errore}`);
  }
}

// --- 02:15 · sessioni ----------------------------------------------------
console.log("\nsessioni e limiti");
for (const [nome, fn] of [
  ["sessioni", pulisciSessioni],
  ["inviti", pulisciInviti],
  ["tentativi", pulisciTentativi],
  ["limiti", pulisciLimiti],
]) {
  const n = passo(nome, fn);
  if (n !== undefined) console.log(`  ${nome}: ${n} tolti`);
}

// --- il controllo che la fase 11 aveva lasciato da eseguire a mano -------
console.log("\nconformità dei consensi");
const trovati = passo("conformità", () => albumNonConformi(), true);
if (trovati !== undefined) {
  nonConformi = trovati;
  if (trovati.length === 0) {
    console.log("  nessun album pubblicato viola la regola dei consensi");
  } else {
    err(`  ${trovati.length} ALBUM PUBBLICATI NON CONFORMI:`);
    for (const a of trovati) err(`    ${a.slug} — ${a.nomi.join(", ")}`);
    err(
      "  Non dovrebbe essere possibile: il trigger lo impedisce e la revoca ritira.\n" +
        "  Ritirateli a mano dalla sezione «Privacy e consensi» e guardate come\n" +
        "  sono arrivati lì.",
    );
  }
}

// --- 03:30 domenica · manutenzione ---------------------------------------
console.log("\nmanutenzione del database");
const conVacuum = vacuumForzato || turnoVacuum;
if (!conVacuum) console.log("  VACUUM: non è il turno (si fa il primo del mese)");
const esito = passo("manutenzione", () => manutenzione(conVacuum));
if (esito !== undefined) {
  console.log(`  PRAGMA optimize: ${esito.ottimizzato ? "fatto" : "non fatto"}`);
  if (esito.byteRecuperati !== null) {
    console.log(`  VACUUM: ${bytes(esito.byteRecuperati)} recuperati in ${esito.durataMs} ms`);
  }
  if (esito.motivo) avviso(`  ATTENZIONE: ${esito.motivo}`);
}

// --- riepilogo -----------------------------------------------------------
console.log("");
if (problemi > 0) {
  err(`${problemi} passi falliti.`);
  process.exit(1);
}
if (nonConformi.length > 0) {
  err(`Fatto, ma ${nonConformi.length} album non conformi richiedono attenzione.`);
  process.exit(2);
}
console.log("Fatto.");
