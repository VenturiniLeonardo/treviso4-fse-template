#!/usr/bin/env node
/**
 * Travasa gli account da `utenti.json` alla tabella `utenti`. Una volta sola.
 *
 *   npm run db:applica          prima: le tabelle
 *   npm run db:riferimenti      poi:   le sei unità (servono ai referenti di unità)
 *   npm run db:importa-utenti   infine: gli account
 *
 * Legge il file indicato da `SITO_UTENTI_FILE`, che è lo stesso da cui
 * l'applicazione leggeva prima della fase 6 e da cui adesso non legge più.
 *
 * **Gli hash si travasano come sono.** Sono `scrypt$…`, e restano scrypt: il
 * codice li verifica ancora e li riscrive in argon2id al primo accesso riuscito
 * di ciascuno. Ricalcolarli qui non si potrebbe — servirebbe la password in
 * chiaro, che nessuno ha — e obbligare tutti a rifarla sarebbe un fastidio
 * inutile per una cosa che si sistema da sé.
 *
 * Idempotente: un account già presente viene saltato, non sovrascritto. Chi
 * dopo l'importazione cambia la password nell'applicazione non se la vede
 * tornare indietro rieseguendo questo script.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { percorsoDb } from "@/lib/db/percorso";
import { unita, utenti } from "@/lib/db/schema";
import { RUOLI_VALIDI } from "@/lib/sessione";

const percorso = process.env.SITO_UTENTI_FILE;
if (!percorso) {
  console.error(
    "Manca SITO_UTENTI_FILE: indicate il file JSON da cui importare.\n" +
      "  SITO_UTENTI_FILE=./utenti.json npm run db:importa-utenti",
  );
  process.exit(1);
}

let dati;
try {
  dati = JSON.parse(readFileSync(percorso, "utf-8"));
} catch (e) {
  console.error(`Non riesco a leggere ${percorso}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(dati)) {
  console.error(`${percorso} deve contenere un array JSON.`);
  process.exit(1);
}

const d = db();
console.log(`database: ${percorsoDb()}`);
console.log(`sorgente: ${percorso}\n`);

let importati = 0;
let saltati = 0;
const problemi = [];

for (const u of dati) {
  const nome = String(u?.utente ?? "").trim().toLowerCase();
  if (!nome) {
    problemi.push("una riga senza «utente»: saltata");
    continue;
  }
  if (!RUOLI_VALIDI.includes(u?.ruolo)) {
    problemi.push(`${nome}: ruolo «${u?.ruolo}» non valido`);
    continue;
  }
  if (typeof u?.hash !== "string" || u.hash === "") {
    problemi.push(`${nome}: senza hash, non potrebbe entrare`);
    continue;
  }

  const gia = d
    .select({ id: utenti.id })
    .from(utenti)
    .where(sql`lower(${utenti.utente}) = ${nome}`)
    .get();
  if (gia) {
    console.log(`  = ${nome} — già presente, lascio com'è`);
    saltati++;
    continue;
  }

  /*
   * Un referente di unità senza `unita` viene rifiutato, non accomodato.
   *
   * Lo dice il CHECK dello schema e lo aveva già annotato l'audit
   * dell'importazione (§A3.1): un referente di unità senza unità non può modificare
   * nessun album, cioè è un account che non può fare il proprio lavoro.
   * Crearlo lo nasconderebbe; rifiutarlo per nome lo mette davanti agli occhi.
   */
  let idUnita = null;
  if (u.ruolo === "referente") {
    if (!u.unita) {
      problemi.push(
        `${nome}: è referente di unità ma non ha «unita». NON importato. ` +
          "Aggiungete l'unità nel file e rieseguite.",
      );
      continue;
    }
    idUnita = d.select({ id: unita.id }).from(unita).where(eq(unita.chiave, u.unita)).get()?.id;
    if (!idUnita) {
      problemi.push(
        `${nome}: unità «${u.unita}» sconosciuta. NON importato. ` +
          "Avete eseguito «npm run db:riferimenti»?",
      );
      continue;
    }
  } else if (u.unita) {
    problemi.push(`${nome}: ha «unita» ma non è referente di unità — l'unità viene ignorata`);
  }

  d.insert(utenti)
    .values({
      utente: nome,
      ruolo: u.ruolo,
      nome: String(u.nome ?? nome),
      iniziali: String(u.iniziali ?? nome.slice(0, 2).toUpperCase()),
      unitaId: idUnita,
      email: u.email ? String(u.email) : null,
      passwordHash: u.hash,
      stato: "attivo",
    })
    .run();
  console.log(`  + ${nome} (${u.ruolo}${u.unita ? `, ${u.unita}` : ""})`);
  importati++;
}

console.log(`\n${importati} importati, ${saltati} già presenti.`);

if (problemi.length > 0) {
  console.log("\nDa sistemare:");
  for (const p of problemi) console.log(`  ! ${p}`);
}

console.log(
  "\nAl primo accesso ciascuno dovrà attivare il secondo fattore: è obbligatorio\n" +
    "e non c'è una strada che lo salti. Avvisateli prima.",
);
