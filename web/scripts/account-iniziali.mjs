#!/usr/bin/env node
/**
 * Gli account con cui il sito va in produzione, con una password provvisoria.
 *
 *   SITO_PASSWORD_PROVVISORIA='…' npm run db:account-iniziali
 *
 * Sette account, uno per chi gestisce il sito: lo sviluppatore, il referente
 * gruppo, i referenti delle quattro unità che hanno un account e il social media
 * manager. Hanno tutti la **stessa** password provvisoria, che quindi conosce
 * più di una persona: per questo al primo accesso — dopo aver attivato il
 * secondo fattore — non si arriva a nessuna pagina finché non se ne sceglie una
 * propria (`proxy.ts`, `sessioneCorrente`, `/area-riservata/accedi/password`).
 *
 * La password non è scritta qui né altrove nel repository, che un giorno sarà
 * pubblico: arriva dall'ambiente, come le altre credenziali.
 *
 * Idempotente: un account che esiste già, in qualunque stato, non si tocca —
 * rilanciarlo dopo che qualcuno ha cambiato la password non gliela riporta
 * indietro. Le unità devono esserci (`npm run db:riferimenti`).
 */
import { percorsoDb } from "@/lib/db/percorso";
import { creaUtente, impostaPasswordProvvisoria, trovaUtente } from "@/lib/utenti";

export const ACCOUNT_INIZIALI = [
  { utente: "admin", ruolo: "sviluppatore", nome: "Amministratore del sito", iniziali: "AD" },
  { utente: "gestore", ruolo: "gestore", nome: "Gestore", iniziali: "GE" },
  { utente: "u1", ruolo: "referente", unita: "u1", nome: "Referenti dell'unità 1", iniziali: "UA" },
  { utente: "u2", ruolo: "referente", unita: "u2", nome: "Referenti dell'unità 2", iniziali: "UB" },
  { utente: "u3", ruolo: "referente", unita: "u3", nome: "Referenti dell'unità 3", iniziali: "UC" },
  { utente: "u4", ruolo: "referente", unita: "u4", nome: "Referenti dell'unità 4", iniziali: "UD" },
  { utente: "social", ruolo: "social", nome: "Social media manager", iniziali: "SM" },
];

const provvisoria = process.env.SITO_PASSWORD_PROVVISORIA ?? "";
if (provvisoria === "") {
  console.error(
    "Manca SITO_PASSWORD_PROVVISORIA: la password provvisoria arriva dall'ambiente.\n" +
      "  SITO_PASSWORD_PROVVISORIA='…' npm run db:account-iniziali",
  );
  process.exit(1);
}

console.log(`database: ${percorsoDb()}\n`);

let creati = 0;
for (const a of ACCOUNT_INIZIALI) {
  if (trovaUtente(a.utente)) {
    console.log(`  = ${a.utente} — già presente, lascio com'è`);
    continue;
  }
  const id = creaUtente(a);
  await impostaPasswordProvvisoria(id, provvisoria);
  console.log(`  + ${a.utente} (${a.ruolo}${a.unita ? `, ${a.unita}` : ""})`);
  creati++;
}

console.log(
  `\n${creati} creati. Al primo accesso ciascuno attiva il secondo fattore e poi deve\n` +
    "cambiare la password provvisoria: finché non lo fa, l'area riservata non si apre.",
);
