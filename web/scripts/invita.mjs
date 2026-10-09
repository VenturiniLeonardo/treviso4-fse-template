#!/usr/bin/env node
/**
 * Crea un account e stampa il collegamento d'invito.
 *
 *   node --experimental-strip-types --import ./scripts/registra-alias.mjs \
 *     scripts/invita.mjs <utente> <ruolo> "<nome mostrato>" <iniziali> [unita]
 *
 * Oppure, per rifare l'invito a chi c'è già:
 *
 *   … scripts/invita.mjs <utente>
 *
 * §7 del piano: «nessuna registrazione pubblica… si entra solo su invito di un
 * amministratore». Questo script è l'amministratore, finché non c'è la schermata
 * che fa la stessa cosa.
 *
 * Il collegamento **si stampa una volta sola**: nel database c'è l'impronta del
 * token, non il token. Se lo perdete, rieseguite lo script — il vecchio invito
 * viene annullato e ne nasce un altro.
 */
import { crea } from "@/lib/auth/inviti";
import { DURATA_ORE } from "@/lib/auth/inviti";
import { dbSeEsiste } from "@/lib/db/db";
import { percorsoDb } from "@/lib/db/percorso";
import { unita as tabellaUnita } from "@/lib/db/schema";
import { creaUtente, trovaUtente } from "@/lib/utenti";

const RUOLI = ["referente", "gestore", "sviluppatore", "social"];
const [nomeUtente, ruolo, nome, iniziali, unita] = process.argv.slice(2);

if (!nomeUtente) {
  console.error(
    'Uso: scripts/invita.mjs <utente> <ruolo> "<nome mostrato>" <iniziali> [unita]\n' +
      "     scripts/invita.mjs <utente>          (rifà l'invito a chi c'è già)\n" +
      `Ruoli: ${RUOLI.join(", ")}`,
  );
  process.exit(1);
}

console.log(`database: ${percorsoDb()}`);

let utente = trovaUtente(nomeUtente);

if (!utente) {
  if (!ruolo || !nome || !iniziali) {
    console.error(
      `«${nomeUtente}» non esiste ancora: per crearlo servono anche ruolo, nome e iniziali.`,
    );
    process.exit(1);
  }
  if (!RUOLI.includes(ruolo)) {
    console.error(`Ruolo non valido: ${ruolo}. Ruoli: ${RUOLI.join(", ")}`);
    process.exit(1);
  }
  if (ruolo === "referente" && !unita) {
    console.error(
      "Per un referente di unità serve anche l'unità, altrimenti l'account non può\n" +
        "gestire nessun album.",
    );
    process.exit(1);
  }

  /*
   * L'unità dev'essere una **riga** di `unita`, non una chiave qualunque.
   *
   * Su un database appena migrato quella tabella è vuota — le sei unità le
   * semina `npm run db:riferimenti`, che è un passo a parte — e `creaUtente`
   * sollevava «Unità sconosciuta: u1» senza che nessuno lo prendesse: chi
   * installa il sito per la prima volta vedeva uno stack trace di Node al posto
   * di una riga che dice cosa fare. Succede esattamente il primo giorno, cioè
   * quando è meno utile doverlo interpretare.
   *
   * Le due cause si distinguono, perché la risposta è diversa: tabella vuota
   * vuol dire «manca un passo del rilascio», tabella piena vuol dire «avete
   * sbagliato a scrivere».
   */
  if (unita) {
    const d = dbSeEsiste();
    const chiavi = d
      ? d.select({ chiave: tabellaUnita.chiave }).from(tabellaUnita).all().map((u) => u.chiave)
      : [];

    if (chiavi.length === 0) {
      console.error(
        "\nLe unità non sono ancora nel database: senza, un referente di unità non può\n" +
          "essere creato — l'account non avrebbe un ambito su cui lavorare.\n\n" +
          "  npm run db:riferimenti\n\n" +
          "semina le sei unità, gli anni sociali e le domande frequenti. È un passo\n" +
          "del primo rilascio, e va eseguito una volta sola dopo «npm run db:applica».",
      );
      process.exit(1);
    }
    if (!chiavi.includes(unita)) {
      console.error(
        `\nUnità sconosciuta: «${unita}».\nQuelle nel database sono: ${chiavi.join(", ")}.`,
      );
      process.exit(1);
    }
  }

  const id = creaUtente({ utente: nomeUtente, ruolo, nome, iniziali, unita });
  utente = { id, utente: nomeUtente.trim().toLowerCase() };
  console.log(`creato: ${utente.utente} (${ruolo})`);
} else {
  console.log(`esiste già: ${utente.utente} — l'invito precedente viene annullato`);
}

const token = crea(utente.id);
const base = process.env.SITO_BASE_URL ?? "https://esempio.invalid";

console.log(`\nConsegnate questo collegamento a mano. Vale ${DURATA_ORE} ore, una volta sola:\n`);
console.log(`  ${base}/area-riservata/invito/${token}\n`);
console.log(
  "Non è stampato da nessun'altra parte e nel database c'è solo la sua impronta:\n" +
    "se lo perdete, rieseguite questo script.",
);
