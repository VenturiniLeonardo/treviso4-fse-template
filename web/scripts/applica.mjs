#!/usr/bin/env node
/**
 * Applica le migrazioni al database.
 *
 *   npm run db:applica
 *
 * Fino alla 0012 era `drizzle-kit migrate`. Adesso le applica
 * `applicaMigrazioni` in `lib/db/applica.ts`, che spegne le chiavi esterne
 * **prima** della transazione del migratore e le ricontrolla dopo: la 0013
 * ricostruisce `utenti`, e con le chiavi accese quella ricostruzione
 * azzererebbe ogni autore del sito. Il perché intero sta nell'intestazione
 * della migrazione.
 *
 * Il database si crea se non c'è: è il primo rilascio, e il caso che la CI
 * prova a ogni push.
 */
import Database from "better-sqlite3";
import { applicaMigrazioni } from "@/lib/db/applica";
import { percorsoDb } from "@/lib/db/percorso";

const percorso = percorsoDb();
console.log(`database: ${percorso}`);

const c = new Database(percorso);
c.pragma("busy_timeout = 5000");

let esito;
try {
  esito = applicaMigrazioni(c);
} catch (errore) {
  console.error(`\nMigrazione NON applicata, il database è com'era: ${errore.message}`);
  c.close();
  process.exit(1);
}
c.close();

const nuove = esito.dopo - esito.prima;
console.log(
  nuove === 0
    ? `Nessuna migrazione da applicare: ${esito.dopo} già presenti.`
    : `Applicate ${nuove} migrazioni (${esito.dopo} in tutto).`,
);

if (esito.appese.length > 0) {
  console.error(`\n${esito.appese.length} righe puntano a qualcosa che non c'è più:`);
  for (const r of esito.appese.slice(0, 20)) {
    console.error(`  ${r.table} riga ${r.rowid} → ${r.parent}`);
  }
  console.error(
    "\nNON riavviate il servizio: rimettete la copia fatta prima del rilascio\n" +
      "(npm run db:ripristina) e segnalate la migrazione.",
  );
  process.exit(1);
}
