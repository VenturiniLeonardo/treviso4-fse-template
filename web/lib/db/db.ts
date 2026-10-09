import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { percorsoDb } from "@/lib/db/percorso";
import * as schema from "@/lib/db/schema";

/**
 * L'unico posto in cui si apre il database.
 *
 * Una connessione per processo, aperta alla prima richiesta e tenuta. Il piano
 * prevede **un** processo Node (§03), quindi non serve un pool: serve che i
 * quattro pragmi siano applicati, e che lo siano su *ogni* connessione, perché
 * `foreign_keys` e `busy_timeout` valgono per connessione e non per file.
 *
 * Nessuno store apre una connessione propria. Non è una convenzione di stile:
 * due connessioni con pragmi diversi si comportano in modo diverso sullo stesso
 * file, e la differenza si vede solo quando qualcosa va storto.
 *
 * Modulo di solo server.
 */

/**
 * Il database può non esserci, e non è un errore.
 *
 * Succede in due momenti legittimi:
 *
 *  - durante `next build`, che prerenderizza sette pagine pubbliche leggendo gli
 *    store: la macchina che compila può non avere il database di produzione;
 *  - alla prima installazione, prima che `npm run db:applica` sia stato eseguito.
 *
 * In entrambi i casi la lettura deve restituire il vuoto invece di far fallire
 * la compilazione. La scrittura invece deve fallire, e dirlo chiaramente: una
 * scrittura che «riesce» senza database è il modo di perdere il lavoro di una
 * serata senza accorgersene.
 */
let connessione: Database.Database | null = null;
/**
 * L'handle Drizzle si memoizza insieme alla connessione: costruirne uno nuovo a
 * ogni chiamata significherebbe rifare la cache degli statement preparati per
 * ogni lettura, cioè buttare via il vantaggio principale di better-sqlite3.
 */
let handle: Handle | null = null;
let iniziato = false;

function apri(): Database.Database | null {
  if (iniziato) return connessione;
  iniziato = true;

  const percorso = percorsoDb();
  if (!existsSync(percorso)) {
    // una riga sola, e solo la prima volta: in compilazione è normale, a runtime
    // è il segnale che manca `npm run db:applica`
    console.warn(
      `database assente in ${percorso}: le letture restituiscono insiemi vuoti ` +
        "e le scritture falliranno. Applicate le migrazioni con «npm run db:applica».",
    );
    return null;
  }

  const c = new Database(percorso);

  // Tutti e quattro espliciti, anche quelli che better-sqlite3 imposta da sé
  // (`foreign_keys` e `busy_timeout`): dipendere dal predefinito di un driver
  // significa dipendere da qualcosa che un aggiornamento può cambiare, e la
  // perdita d'integrità sarebbe silenziosa. Il test lo verifica.
  c.pragma("journal_mode = WAL");
  c.pragma("foreign_keys = ON");
  c.pragma("busy_timeout = 5000");
  c.pragma("synchronous = NORMAL");

  connessione = c;
  handle = drizzle(c, { schema });
  return c;
}

/**
 * Il tipo dell'handle, per chi scrive funzioni che lo ricevono.
 *
 * Esportato perché senza di esso una funzione ausiliaria dentro uno store
 * dovrebbe dichiarare il parametro con un tipo condizionale illeggibile.
 */
export type Handle = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** L'handle Drizzle, o `null` se il database non c'è. Per le sole letture. */
export function dbSeEsiste(): Handle | null {
  apri();
  return handle;
}

/**
 * L'handle Drizzle, oppure solleva.
 *
 * Da usare in scrittura: se il database non c'è, l'operazione non deve
 * sembrare riuscita.
 */
export function db(): Handle {
  const d = dbSeEsiste();
  if (!d) {
    throw new Error(
      `Database non disponibile (${percorsoDb()}). Applicate le migrazioni con «npm run db:applica».`,
    );
  }
  return d;
}

/** La connessione nuda, per i pragmi e le transazioni. Solleva se manca. */
function nuda(): Database.Database {
  const c = apri();
  if (!c) {
    throw new Error(
      `Database non disponibile (${percorsoDb()}). Applicate le migrazioni con «npm run db:applica».`,
    );
  }
  return c;
}

/**
 * Esegue `fn` dentro una transazione aperta in `BEGIN IMMEDIATE`.
 *
 * `IMMEDIATE` e non il `BEGIN` semplice: prende il lucchetto di scrittura
 * subito, invece di scoprire a metà transazione che un altro scrittore l'ha
 * preso — caso in cui SQLite non può più promuovere il lucchetto e la
 * transazione va rifatta da capo. Con `busy_timeout` la seconda scrittura
 * attende, e la serializzazione è quella che il piano §18 chiede.
 *
 * **La callback è sincrona, per costruzione.** better-sqlite3 è sincrono, e una
 * `await` dentro una transazione la terrebbe aperta per tutta la durata
 * dell'attesa: è esattamente ciò che §18 vieta — «non tenere transazioni aperte
 * durante elaborazione immagini, operazioni su filesystem, chiamate esterne».
 * Il tipo lo impedisce invece di raccomandarlo: i file si scrivono prima e si
 * cancellano dopo il commit.
 */
export function transazione<T>(fn: (d: Handle) => T): T {
  const c = nuda();
  const d = db();
  return c.transaction(() => fn(d)).immediate();
}

/** I pragmi in vigore, per la sonda di stato e per i test. */
export function pragmiCorrenti(): Record<string, string | number> | null {
  const c = apri();
  if (!c) return null;
  return {
    journal_mode: c.pragma("journal_mode", { simple: true }) as string,
    foreign_keys: c.pragma("foreign_keys", { simple: true }) as number,
    busy_timeout: c.pragma("busy_timeout", { simple: true }) as number,
    synchronous: c.pragma("synchronous", { simple: true }) as number,
  };
}

/**
 * Il database risponde? Per `/api/health`.
 *
 * `SELECT 1` non è un dato applicativo: non dice quante iscrizioni ci sono, dice
 * che il motore risponde. È la distinzione che §1 del piano chiede alla sonda.
 */
export function databaseRisponde(): boolean {
  try {
    const c = apri();
    if (!c) return false;
    return c.prepare("SELECT 1 AS uno").get() !== undefined;
  } catch {
    return false;
  }
}

/**
 * Chiude la connessione. Serve **solo ai test**, che aprono e chiudono database
 * temporanei; in esercizio il processo vive quanto il servizio.
 */
export function chiudiPerTest(): void {
  connessione?.close();
  connessione = null;
  handle = null;
  iniziato = false;
}
