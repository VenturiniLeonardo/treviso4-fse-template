#!/usr/bin/env node
/**
 * Aggiunge `STRICT` alle tabelle delle migrazioni generate da drizzle-kit.
 *
 * Serve perché `STRICT` non è esprimibile nello schema Drizzle: `sqliteTable`
 * non ha l'opzione, e drizzle-kit emette `CREATE TABLE … );` senza. Il piano lo
 * pretende su tutte le tabelle (§2), e la ragione è concre: senza, SQLite
 * accetta la stringa «quarantaquattro» in una colonna dichiarata `INTEGER`.
 *
 * Gira **dentro** `npm run db:genera`, subito dopo drizzle-kit, così non c'è un
 * passaggio manuale da ricordare fra il generare e l'applicare. Un passaggio
 * manuale che protegge un invariante è un invariante che prima o poi salta.
 *
 * È idempotente: una tabella che ha già `STRICT` non viene toccata, quindi
 * rieseguirlo non fa danni. Riscrive solo i file che ha effettivamente
 * cambiato, e stampa cosa ha fatto.
 *
 * Attenzione: applica `STRICT` a una migrazione **non ancora pubblicata**.
 * Quelle già applicate in produzione non si modificano — è la regola del piano
 * §9 — e infatti questo script gira solo subito dopo la generazione.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CARTELLA = new URL("../drizzle/", import.meta.url).pathname;

/**
 * Divide il file negli statement che drizzle-kit separa da sé, aggiunge
 * `STRICT` a quelli che creano una tabella, e ricompone.
 *
 * Si lavora per statement e non con una sostituzione sul file intero perché
 * `);` compare anche dentro un `CHECK`: `CHECK(x IN ('a','b'))` finisce con due
 * parentesi, e una regex ingenua lo colpirebbe.
 */
function aggiungiStrict(sql) {
  const SEPARATORE = "--> statement-breakpoint";
  let toccate = 0;

  const pezzi = sql.split(SEPARATORE).map((pezzo) => {
    const testo = pezzo.trim();
    if (!testo.toUpperCase().startsWith("CREATE TABLE")) return pezzo;
    // già fatto: niente da aggiungere
    if (/\)\s*STRICT\s*;?\s*$/i.test(testo)) return pezzo;

    // l'ultima parentesi chiusa del corpo della tabella, seguita dal punto e virgola
    const sostituito = pezzo.replace(/\)\s*;(\s*)$/, ") STRICT;$1");
    if (sostituito === pezzo) {
      throw new Error(
        `Non riesco a chiudere con STRICT questo statement:\n${testo.slice(0, 200)}…`,
      );
    }
    toccate++;
    return sostituito;
  });

  return { sql: pezzi.join(SEPARATORE), toccate };
}

const file = (await readdir(CARTELLA)).filter((n) => n.endsWith(".sql")).sort();
if (file.length === 0) {
  console.error("Nessuna migrazione in drizzle/: drizzle-kit non ha generato niente?");
  process.exit(1);
}

let totale = 0;
for (const nome of file) {
  const percorso = join(CARTELLA, nome);
  const prima = await readFile(percorso, "utf8");
  const { sql, toccate } = aggiungiStrict(prima);
  if (toccate === 0) continue;
  await writeFile(percorso, sql, "utf8");
  console.log(`  ${nome}: STRICT su ${toccate} tabelle`);
  totale += toccate;
}

console.log(
  totale === 0
    ? "STRICT: già a posto su tutte le tabelle, niente da fare."
    : `STRICT: aggiunto a ${totale} tabelle.`,
);
