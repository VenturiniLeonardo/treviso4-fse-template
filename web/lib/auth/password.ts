import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/**
 * Le password: argon2id per quelle nuove, scrypt per quelle che c'erano già.
 *
 * §7 del piano prescrive argon2id con 19 MiB, due passate e parallelismo 1 — il
 * minimo raccomandato da OWASP. Fino a questa fase il codice usava **scrypt**,
 * che sta nella libreria standard di Node e non richiede niente di compilato;
 * la divergenza era annotata nell'audit come una cosa da chiudere, non da
 * dimenticare. Qui si chiude.
 *
 * ## Perché argon2id in WebAssembly e non nativo
 *
 * I due modi di avere argon2id in Node sono un modulo nativo (`@node-rs/argon2`)
 * o una compilazione in WebAssembly (`hash-wasm`). Il nativo è più veloce, e
 * sarebbe la scelta ovvia se non fosse per come questo progetto viene rilasciato:
 * §6 del piano dice che si copia una cartella sul server e parte. La cartella la
 * produce `next build` con `output: standalone`, cioè su **questa** macchina —
 * un Mac — mentre il server è un Debian x86-64.
 *
 * `@node-rs/argon2` distribuisce un pacchetto diverso per ogni piattaforma e npm
 * ne installa **solo quello del sistema corrente**: il pacchetto Linux non
 * esisterebbe nemmeno in `node_modules`, quindi non finirebbe nella cartella
 * standalone, e il server si fermerebbe al primo accesso con un errore di
 * modulo mancante. Verificato leggendo le `optionalDependencies` del pacchetto.
 * `better-sqlite3` non ha questo problema perché porta dentro di sé i binari di
 * tutte le piattaforme — l'ho controllato nella cartella standalone.
 *
 * `hash-wasm` è un pacchetto solo, senza dipendenze, con il WebAssembly incluso
 * nel JavaScript: la stessa cartella funziona ovunque. Il costo è la velocità, e
 * misurata è irrilevante: **28 ms** per un hash e 22 ms per una verifica, con i
 * parametri del piano. Sono quattordici account e qualche accesso alla settimana.
 *
 * ## Perché scrypt resta
 *
 * Gli account esistenti hanno hash `scrypt$…`. Buttarli significherebbe
 * azzerare le password di tutti in un rilascio. Invece si verificano entrambi i
 * formati — si distinguono dal prefisso — e al primo accesso riuscito con un
 * hash vecchio si riscrive quello nuovo: `daRiHashare()` dice quando. Passata
 * una tornata di accessi non resta uno scrypt, senza che nessuno abbia dovuto
 * fare niente.
 *
 * Modulo di solo server: usa `node:crypto`.
 */

/** I parametri di §7: 19 MiB, due passate, parallelismo 1. */
export const ARGON2 = { memoriaKiB: 19456, passate: 2, parallelismo: 1, lunghezza: 32 } as const;

/** Formato di un hash salvato, riconosciuto dal prefisso. */
export type FormatoHash = "argon2id" | "scrypt" | "sconosciuto";

export function formatoHash(salvato: string): FormatoHash {
  if (salvato.startsWith("$argon2id$")) return "argon2id";
  if (salvato.startsWith("scrypt$")) return "scrypt";
  return "sconosciuto";
}

/**
 * Vero se l'hash va riscritto nel formato corrente.
 *
 * Chiamatelo **dopo** una verifica riuscita, quando la password in chiaro è
 * ancora in mano: è l'unico momento in cui si può ricalcolare.
 */
export function daRiHashare(salvato: string): boolean {
  return formatoHash(salvato) !== "argon2id";
}

/** Crea l'hash da salvare: argon2id, in formato PHC (`$argon2id$v=19$m=…`). */
export async function creaHashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: ARGON2.parallelismo,
    iterations: ARGON2.passate,
    memorySize: ARGON2.memoriaKiB,
    hashLength: ARGON2.lunghezza,
    outputType: "encoded",
  });
}

/**
 * `promisify(scrypt)` perde la firma con le opzioni: la si scrive a mano.
 * Resta qui, e non in `lib/utenti.ts`, perché è l'unico posto che deve sapere
 * come sono fatti gli hash.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  lunghezza: number,
  opzioni: ScryptOptions,
): Promise<Buffer> {
  return new Promise((risolvi, rifiuta) => {
    scrypt(password, salt, lunghezza, opzioni, (errore, derivata) =>
      errore ? rifiuta(errore) : risolvi(derivata),
    );
  });
}

/** Il formato vecchio: `scrypt$N$r$p$saltBase64$hashBase64`. */
async function verificaScrypt(password: string, salvato: string): Promise<boolean> {
  const parti = salvato.split("$");
  if (parti.length !== 6 || parti[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parti;
  let atteso: Buffer;
  let derivata: Buffer;
  try {
    atteso = Buffer.from(hashB64, "base64");
    derivata = await scryptAsync(password, Buffer.from(saltB64, "base64"), atteso.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    // parametri illeggibili o fuori dai limiti di scrypt: è un hash rotto, non
    // una password sbagliata — ma la risposta all'utente è la stessa
    return false;
  }
  return atteso.length === derivata.length && timingSafeEqual(atteso, derivata);
}

/**
 * Verifica una password contro l'hash salvato, in qualunque dei due formati.
 *
 * Non solleva mai: un hash malformato è `false`. Chi chiama non deve poter
 * distinguere «password sbagliata» da «riga del database rovinata», perché la
 * differenza è utile solo a chi sta provando a entrare.
 */
export async function verificaPassword(password: string, salvato: string): Promise<boolean> {
  switch (formatoHash(salvato)) {
    case "argon2id":
      try {
        return await argon2Verify({ password, hash: salvato });
      } catch {
        return false;
      }
    case "scrypt":
      return verificaScrypt(password, salvato);
    default:
      return false;
  }
}

/**
 * Un hash finto contro cui verificare quando l'utente non esiste.
 *
 * Senza, «utente inesistente» risponderebbe in un millesimo del tempo di
 * «password sbagliata», e i nomi utente diventerebbero elencabili cronometrando
 * le risposte. Si calcola una volta sola all'avvio, ed è argon2id perché il
 * tempo da imitare è quello di un account vero.
 */
export const HASH_FINTO: Promise<string> = creaHashPassword(
  randomBytes(24).toString("base64url"),
);

/**
 * Brucia il tempo di una verifica senza avere un utente.
 *
 * Da chiamare nel ramo «non l'ho trovato», al posto della verifica vera.
 */
export async function verificaAVuoto(password: string): Promise<false> {
  await verificaPassword(password, await HASH_FINTO);
  return false;
}

/**
 * Le regole sulla password nuova arrivano dal modulo puro e si ri-esportano qui
 * per comodità di chi già importava da questo file. Non stanno qui perché le
 * legge anche il browser, e questo modulo il browser non lo può caricare.
 */
export { PASSWORD_MIN, passwordAccettabile } from "@/lib/password-regole";
