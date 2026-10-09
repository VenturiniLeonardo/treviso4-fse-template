#!/usr/bin/env node
/**
 * Lo schema creato dalle migrazioni è quello che lo schema Drizzle descrive?
 *
 *   node scripts/schema-atteso.mjs
 *
 * Serve alla CI, sul database appena migrato. La domanda a cui risponde è
 * quella che si scopre tardi: **le migrazioni scritte a mano** — questo
 * progetto ne ha diverse, corrette perché drizzle-kit sbagliava a ricostruire
 * le tabelle — possono avere prodotto uno schema che non corrisponde più a
 * `lib/db/schema.ts`. Il codice compila lo stesso, e si rompe alla prima query.
 *
 * Il confronto è sulle **tabelle e sulle colonne**, non sul SQL testuale: due
 * modi diversi di scrivere lo stesso `CREATE TABLE` sono la stessa cosa, e
 * confrontarli come stringhe darebbe un falso allarme a ogni migrazione.
 */
import Database from "better-sqlite3";
import { percorsoDb } from "@/lib/db/percorso";
import * as schema from "@/lib/db/schema";
import { getTableConfig } from "drizzle-orm/sqlite-core";

const db = new Database(percorsoDb(), { readonly: true });
let problemi = 0;
const guaio = (m) => { console.error(`  ✗ ${m}`); problemi++; };

console.log(`database: ${percorsoDb()}\n`);

// le tabelle che lo schema descrive
const attese = new Map();
for (const v of Object.values(schema)) {
  try {
    const c = getTableConfig(v);
    attese.set(c.name, c.columns.map((x) => x.name).sort());
  } catch {
    // non è una tabella (un tipo, un indice, un enum): si salta
  }
}

if (attese.size === 0) {
  console.error("Non ho riconosciuto nessuna tabella nello schema: il controllo non prova niente.");
  process.exit(1);
}

const presenti = new Set(
  db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'")
    .all()
    .map((r) => r.name),
);

console.log(`tabelle attese: ${attese.size} · presenti: ${presenti.size}`);

for (const [nome, colonne] of attese) {
  if (!presenti.has(nome)) {
    guaio(`manca la tabella «${nome}»`);
    continue;
  }
  const vere = db.prepare(`pragma table_info(${nome})`).all().map((c) => c.name).sort();
  const mancanti = colonne.filter((c) => !vere.includes(c));
  const inPiu = vere.filter((c) => !colonne.includes(c));
  if (mancanti.length) guaio(`«${nome}»: colonne mancanti — ${mancanti.join(", ")}`);
  if (inPiu.length) guaio(`«${nome}»: colonne in più — ${inPiu.join(", ")}`);
}

// le migrazioni registrate: se sono zero, `db:applica` non ha fatto niente
const applicate = db.prepare("select count(*) n from __drizzle_migrations").get().n;
console.log(`migrazioni registrate: ${applicate}`);
if (applicate === 0) guaio("nessuna migrazione registrata: «db:applica» non ha fatto niente");

const integrita = db.pragma("integrity_check", { simple: true });
console.log(`integrity_check: ${integrita}`);
if (integrita !== "ok") guaio(`integrity_check dice «${integrita}»`);

db.close();
console.log("");
if (problemi > 0) {
  console.error(`${problemi} problemi: lo schema creato non è quello descritto.`);
  process.exit(1);
}
console.log("Lo schema creato dalle migrazioni corrisponde a lib/db/schema.ts.");
