import { defineConfig } from "drizzle-kit";
import { PERCORSO_DB } from "./lib/db/percorso";

/**
 * Configurazione di drizzle-kit: da qui si generano e si applicano le
 * migrazioni.
 *
 *   npm run db:genera     produce il prossimo file SQL numerato in drizzle/
 *   npm run db:applica    applica a PERCORSO_DB le migrazioni non ancora applicate
 *
 * Il percorso del database si importa e non si riscrive: vedi il commento in
 * `lib/db/percorso.ts`. L'import è **relativo** perché drizzle-kit non passa dal
 * risolutore di alias di Next e `@/…` qui non si risolverebbe.
 *
 * `casing: "snake_case"` non serve: i nomi delle colonne sono già scritti in
 * italiano minuscolo con l'underscore nello schema, che è la convenzione del
 * piano (§2, «nomi in italiano, minuscoli, plurali»). Dichiararli espliciti
 * costa qualche carattere e toglie ogni dubbio su come finiscono nel SQL.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: PERCORSO_DB },
  // le migrazioni sono file versionati, non un allineamento automatico:
  // `push` sovrascriverebbe lo schema senza lasciare traccia di cosa è cambiato
  strict: true,
  verbose: true,
});
