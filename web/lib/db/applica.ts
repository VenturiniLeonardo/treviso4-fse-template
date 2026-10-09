import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Applica le migrazioni con le chiavi esterne spente, poi le ricontrolla.
 *
 * Fino alla 0012 `npm run db:applica` era `drizzle-kit migrate`, e bastava. La
 * 0013 deve ricostruire `utenti` per allargare un `CHECK`, e con le chiavi
 * esterne accese `DROP TABLE utenti` esegue le azioni delle ventuno tabelle che
 * la referenziano: autori azzerati, sessioni cancellate. Spegnerle dentro la
 * migrazione non si può — `PRAGMA foreign_keys` dentro una transazione non fa
 * niente, e il migratore apre la sua prima di leggere il primo file.
 *
 * Quindi le spegne chi apre la connessione, prima della transazione: è il primo
 * dei dodici passi di https://sqlite.org/lang_altertable.html §7. E l'ultimo
 * passo è il controllo che qui fa `foreign_key_check`: una migrazione scritta
 * male con le chiavi spente lascerebbe riferimenti appesi senza dirlo, e questa
 * funzione li restituisce perché chi la chiama si fermi.
 *
 * Il migratore è quello di Drizzle, lo stesso che `drizzle-kit migrate` usa
 * dentro: stessa tabella `__drizzle_migrations`, stesse impronte. Un database
 * migrato con l'uno è un database migrato con l'altro.
 *
 * Qui non si legge `percorsoDb()`: la connessione la passa chi chiama, così le
 * prove la usano su un file temporaneo e lo script sul database vero.
 */
export interface EsitoMigrazioni {
  /** quante migrazioni risultavano applicate prima, e quante dopo */
  prima: number;
  dopo: number;
  /** le righe che puntano a qualcosa che non c'è: devono essere zero */
  appese: { table: string; rowid: number | null; parent: string; fkid: number }[];
}

function applicate(c: Database.Database): number {
  const c1 = c
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get() as { n: number };
  if (c1.n === 0) return 0;
  return (c.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
}

export function applicaMigrazioni(c: Database.Database, cartella = "./drizzle"): EsitoMigrazioni {
  const prima = applicate(c);

  // fuori da ogni transazione, o non fa niente: per questo è il primo comando
  c.pragma("foreign_keys = OFF");
  try {
    migrate(drizzle(c), { migrationsFolder: cartella });
  } finally {
    // si riaccendono anche se una migrazione è fallita: la connessione può
    // restare aperta, e lasciarla senza chiavi esterne sarebbe il guasto
    // silenzioso che tutto questo serve a evitare
    c.pragma("foreign_keys = ON");
  }

  const appese = c.pragma("foreign_key_check") as EsitoMigrazioni["appese"];
  return { prima, dopo: applicate(c), appese };
}
