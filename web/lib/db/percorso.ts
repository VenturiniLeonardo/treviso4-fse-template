import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Dove stanno i dati scritti a runtime, e dove sta il file del database.
 *
 * Questo modulo **non importa niente dall'applicazione**, di proposito: lo legge
 * anche `drizzle.config.ts`, che gira sotto `drizzle-kit` e non passa dal
 * risolutore di alias di Next. Un modulo con solo `node:path` dentro si importa
 * da entrambi i mondi con un percorso relativo.
 *
 * È l'unica definizione dei due percorsi. Averla in un posto solo conta più del
 * solito: due definizioni che divergono qui significano migrare un database e
 * servirne un altro, senza nessun errore che lo dica. `lib/archivio.ts`
 * ri-esporta `CARTELLA_DATI` da qui, così i moduli che la usano non cambiano
 * import.
 *
 * In produzione entrambi vanno **fuori** dalle cartelle di rilascio, perché un
 * deploy sostituisce quella cartella: §06 del piano infrastrutturale indica
 * `/srv/sito/data/`, dove vengono conservati database e archivi del sito.
 */
export const CARTELLA_DATI =
  process.env.SITO_DATI_DIR ?? join(process.cwd(), "dati");

if (!existsSync(CARTELLA_DATI)) {
  mkdirSync(CARTELLA_DATI, { recursive: true });
}

export const PERCORSO_DB =
  process.env.SITO_DB ?? join(CARTELLA_DATI, "sito.db");

/**
 * Lo stesso percorso, ma **riletto a ogni chiamata**.
 *
 * La costante qui sopra si valuta all'import, e va bene per `drizzle.config.ts`,
 * che è un processo a sé avviato con l'ambiente già pronto. Non va bene per i
 * test: importano lo strato di connessione e poi impostano `SITO_DB` su un
 * database temporaneo, e a quel punto la costante è già stata calcolata.
 *
 * Chi apre il database usa questa, non quella: costa una lettura di
 * `process.env` una volta per processo, e rende il modulo verificabile.
 */
export function percorsoDb(): string {
  const cartella = process.env.SITO_DATI_DIR ?? join(process.cwd(), "dati");
  return process.env.SITO_DB ?? join(cartella, "sito.db");
}
