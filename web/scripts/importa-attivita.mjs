#!/usr/bin/env node
/**
 * Mette nel calendario le attività di un file JSON, e le pubblica.
 *
 *   npm run db:importa-attivita -- scripts/attivita/<file>.json [--in-bozza]
 *
 * Serve quando le date arrivano tutte insieme — la locandina di un'unità, il
 * programma dell'anno — e inserirle una a una dall'area riservata vorrebbe dire
 * ricopiarle a mano, con il rischio di sbagliarne una. Fa **le stesse cose**
 * della schermata «Attività», con le stesse funzioni: `creaAttivita` e
 * `cambiaStatoAttivita`, quindi stessi controlli su data, tipo e unità.
 *
 * Il file è un elenco di oggetti nella forma di `NuovaAttivita`
 * (`lib/attivita-store.ts`): `titolo`, `data` ISO, `tipo`, e facoltativi
 * `unita`, `luogo`, `durata`, `nota`.
 *
 * ## Si può rilanciare
 *
 * Un'attività con lo stesso titolo, nella stessa data e per le stesse unità c'è
 * già, e si salta. Le unità contano: «Attività di unità» di domenica 4 ottobre
 * ce l'hanno sia l'unità 3 sia l'unità 4, e sono due righe diverse. È ciò
 * che rende sicuro eseguirlo sul server dopo averlo provato in locale: i due
 * database sono separati, e una seconda esecuzione per sbaglio non raddoppia il
 * calendario delle famiglie.
 *
 * ## Perché pubblica
 *
 * Le date di un'attività non sono fotografie di minori: non c'è un consenso da
 * controllare, e chi lancia lo script ha già in mano la locandina approvata.
 * Con `--in-bozza` restano da rivedere nell'area riservata.
 */
import { readFileSync } from "node:fs";
import {
  cambiaStatoAttivita,
  creaAttivita,
  leggiAttivita,
} from "@/lib/attivita-store";
import { percorsoDb } from "@/lib/db/percorso";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const inBozza = process.argv.includes("--in-bozza");

if (!file) {
  console.error("Uso: npm run db:importa-attivita -- <file.json> [--in-bozza]");
  process.exit(1);
}

const elenco = JSON.parse(readFileSync(file, "utf8"));
console.log(`database: ${percorsoDb()}`);

// «gruppo» e nessuna unità sono lo stesso ambito: la lettura dà il primo, il
// file JSON di solito il secondo
const ambito = (unita = []) =>
  unita.filter((u) => u !== "gruppo").sort().join(",");

const presenti = new Set(
  (await leggiAttivita())
    .filter((a) => a.id > 0) // il seme non è nel database
    .map((a) => `${a.anno}-${a.mese}-${a.giorno}|${a.titolo}|${ambito(a.unita)}`),
);
const NOMI_MESE = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

let create = 0;
for (const a of elenco) {
  const [anno, mese, giorno] = a.data.split("-").map(Number);
  const chiave = `${anno}-${NOMI_MESE[mese - 1]}-${giorno}|${a.titolo}|${ambito(a.unita)}`;
  if (presenti.has(chiave)) {
    console.log(`  già presente: ${a.data} ${a.titolo}`);
    continue;
  }
  const id = await creaAttivita(a, "script");
  if (!inBozza) await cambiaStatoAttivita(id, "pubblicato", "script");
  presenti.add(chiave);
  create++;
  console.log(`  ${inBozza ? "in bozza" : "pubblicata"}: ${a.data} ${a.titolo} — ${a.luogo ?? ""}`);
}

console.log(`${create} attività inserite, ${elenco.length - create} già presenti.`);
