#!/usr/bin/env node
/**
 * Gli account che non possono entrare, e che risultano attivi.
 *
 *   npm run db:conti            li elenca
 *   npm run db:conti -- --togli li cancella
 *
 * ## Che cosa cerca, e perché è un problema
 *
 * Un account `attivo` senza password non può entrare da nessuna parte —
 * `verificaCredenziali` rifiuta qualunque password contro un hash assente — e
 * quindi non è un buco. È però una **bugia nella tabella utenti**: la schermata
 * «Utenti e referenti» lo conta fra gli account, chi amministra crede che qualcuno
 * possa entrare con quel nome, e gli strumenti che cercano «un utente attivo con
 * questo ruolo» lo trovano per primo.
 *
 * In produzione quello stato ha **una sola origine**: un database di sviluppo
 * copiato sulla macchina, che è esattamente la cosa che va scoperta. Per questo `instrumentation.ts` si
 * rifiuta di partire finché ci sono.
 *
 * Gli account **invitati** non entrano in questo elenco: sono senza password per
 * costruzione, in attesa che qualcuno consumi il collegamento d'invito, e sono
 * uno stato legittimo.
 */
import Database from "better-sqlite3";
import { percorsoDb } from "@/lib/db/percorso";

const togli = process.argv.includes("--togli");
const db = new Database(percorsoDb());

const inutilizzabili = db
  .prepare(
    `select id, utente, ruolo, creato_il
       from utenti
      where stato = 'attivo' and password_hash is null
      order by id`,
  )
  .all();

console.log(`database: ${percorsoDb()}\n`);

/*
 * Chi ha ancora la password provvisoria degli account iniziali: finché non la
 * cambia, chiunque la conosca può entrare al suo posto e prendersi l'account.
 * La colonna c'è dalla 0015: su un database più vecchio non si chiede.
 */
const colonne = db.prepare("select name from pragma_table_info('utenti')").all().map((c) => c.name);
if (colonne.includes("password_da_cambiare")) {
  const provvisori = db
    .prepare(
      `select utente, ruolo, ultimo_accesso from utenti
        where stato = 'attivo' and password_da_cambiare = 1 order by id`,
    )
    .all();
  if (provvisori.length === 0) {
    console.log("Nessun account con la password provvisoria.\n");
  } else {
    console.log(`${provvisori.length} account hanno ancora la password provvisoria:\n`);
    for (const u of provvisori) {
      console.log(`  ${u.utente.padEnd(16)} ${u.ruolo.padEnd(14)} ${u.ultimo_accesso ? `ultimo accesso ${u.ultimo_accesso}` : "mai entrato"}`);
    }
    console.log("");
  }
}

if (inutilizzabili.length === 0) {
  console.log("Nessun account attivo senza password. Tutto a posto.");
  db.close();
  process.exit(0);
}

console.log(`${inutilizzabili.length} account risultano attivi ma NON possono entrare:\n`);
for (const u of inutilizzabili) {
  console.log(`  ${String(u.id).padStart(3)}  ${u.utente.padEnd(16)} ${u.ruolo.padEnd(14)} creato ${u.creato_il}`);
}

if (!togli) {
  console.log("");
  console.log("Sono quasi certamente account di un database di sviluppo:");
  console.log("in produzione non dovrebbero esistere. Per cancellarli:");
  console.log("");
  console.log("  npm run db:copia            # prima una copia");
  console.log("  npm run db:conti -- --togli");
  console.log("");
  console.log("Cancellarli porta via anche le loro sessioni e i loro inviti (è il");
  console.log("CASCADE dello schema). Il registro delle operazioni resta: quello");
  console.log("non si tocca, ed è quello che serve a ricostruire chi ha fatto cosa.");
  db.close();
  process.exit(0);
}

const info = db
  .prepare(`delete from utenti where stato = 'attivo' and password_hash is null`)
  .run();
console.log(`\nCancellati: ${info.changes}.`);
db.close();
