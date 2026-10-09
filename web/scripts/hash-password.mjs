#!/usr/bin/env node
/**
 * Genera la riga di un utente per il file `utenti.json`.
 *
 *   . .toolchain/activate
 *   cd web && node scripts/hash-password.mjs ref1 referente "Ref1 — Nome Cognome" AK u1
 *
 * La password si digita quando richiesto, così non finisce nella cronologia
 * della shell. Il risultato è un oggetto JSON da mettere nell'array del file.
 *
 * SUPERATO dalla fase 6. Gli account non stanno più in un file JSON ma nella
 * tabella `utenti`, e non si creano incollando una riga: si creano con un
 * invito, che imposta password e secondo fattore in un passaggio.
 *
 *   npm run db:invita -- <utente> <ruolo> "<nome>" <iniziali> [unita]
 *
 * Questo script resta per un caso solo: costruire il file da dare in pasto a
 * `npm run db:importa-utenti` la prima volta. Dopo quella, non serve più — e
 * l'hash che produce è scrypt, che il codice verifica ancora ma non scrive più.
 */
import { randomBytes, scrypt } from "node:crypto";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const RUOLI = ["referente", "gestore", "sviluppatore", "social"];
// Le stesse chiavi di `UnitaKey` in lib/data.ts. Sono ripetute qui perché
// questo script gira senza compilare l'applicazione: se là ne compare una
// nuova, va aggiunta anche qui.
const UNITA = ["u1", "u2", "u3", "u4", "u5", "u6"];
const N = 16384;
const R = 8;
const P = 1;

const [utente, ruolo, nome, iniziali, unita] = process.argv.slice(2);

if (!utente || !ruolo || !nome || !iniziali) {
  console.error(
    'Uso: node scripts/hash-password.mjs <utente> <ruolo> "<nome mostrato>" <iniziali> [unita]\n' +
      `Ruoli: ${RUOLI.join(", ")}\n` +
      `Unità (obbligatoria per referente): ${UNITA.join(", ")}`,
  );
  process.exit(1);
}
if (!RUOLI.includes(ruolo)) {
  console.error(`Ruolo non valido: ${ruolo}. Ruoli: ${RUOLI.join(", ")}`);
  process.exit(1);
}

// Un referente di unità senza unità non può toccare nessun album: l'interfaccia gli
// mostra «questo utente non ha un'unità assegnata» e finisce lì. Meglio
// accorgersene qui, mentre si crea l'account, che il primo giorno di scuola.
if (ruolo === "referente" && !unita) {
  console.error(
    "Per un referente di unità serve anche l'unità, altrimenti l'account non può\n" +
      "gestire nessun album.\n" +
      `  node scripts/hash-password.mjs ${utente} referente "${nome}" ${iniziali} <unita>\n` +
      `Unità possibili: ${UNITA.join(", ")}`,
  );
  process.exit(1);
}
if (unita && !UNITA.includes(unita)) {
  console.error(`Unità non valida: ${unita}. Unità: ${UNITA.join(", ")}`);
  process.exit(1);
}
if (unita && ruolo !== "referente") {
  console.error(`L'unità si assegna solo ai referenti di unità, non a ${ruolo}.`);
  process.exit(1);
}

function chiediPassword(richiesta) {
  return new Promise((risolvi) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // niente eco a schermo
    const scrivi = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (s) => {
      if (s.includes(richiesta)) scrivi?.(s);
    };
    rl.question(richiesta, (risposta) => {
      rl.close();
      process.stdout.write("\n");
      risolvi(risposta);
    });
  });
}

const password = await chiediPassword("Password: ");
const conferma = await chiediPassword("Ripeti la password: ");

if (password !== conferma) {
  console.error("Le due password non coincidono.");
  process.exit(1);
}
if (password.length < 12) {
  console.error(
    "Password troppo corta: almeno 12 caratteri. Quest'area contiene dati di minori.",
  );
  process.exit(1);
}

const salt = randomBytes(16);
const derivata = await scryptAsync(password, salt, 32, { N, r: R, p: P });
const hash = ["scrypt", N, R, P, salt.toString("base64"), derivata.toString("base64")].join("$");

console.log("\nAggiungete questo oggetto all'array del file utenti (SITO_UTENTI_FILE):\n");
console.log(
  JSON.stringify({
    utente: utente.trim().toLowerCase(),
    ruolo,
    nome,
    iniziali,
    ...(unita ? { unita } : {}),
    hash,
  }),
);
console.log();
