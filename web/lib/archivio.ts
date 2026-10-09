import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CARTELLA_DATI } from "@/lib/db/percorso";

/**
 * Archivio su file: il posto dove il sito scrive quello che i referenti cambiano.
 *
 * Non è un database, ed è una scelta consapevole. Il piano prevede SQLite con
 * Drizzle (§05, fase F3): finché non c'è, questi file JSON tengono i contenuti
 * fuori dal codice, sopravvivono ai riavvii e hanno la forma delle tabelle
 * previste. Il giorno del passaggio si sostituiscono `leggi` e `scrivi`, e le
 * pagine non se ne accorgono.
 *
 * Modulo di solo server: importa `node:fs`, quindi non può finire in un
 * componente client nemmeno per sbaglio.
 *
 * Limiti da conoscere, perché non sono nascosti:
 *
 *  - La scrittura è atomica sul singolo file (si scrive a fianco e si rinomina),
 *    ma **non** c'è un lucchetto fra richieste: due referenti che salvano lo stesso
 *    elenco nello stesso istante producono l'ultimo dei due. Con un gruppo di
 *    sessanta referenti e un processo solo (§03) è un rischio teorico; con il
 *    database sparisce, perché diventa una transazione.
 *  - Tutto sta in memoria a ogni lettura: sono elenchi da decine di righe, non
 *    da milioni.
 */

/**
 * Ri-esportata da `lib/db/percorso.ts`, che è l'unica definizione: la legge
 * anche `drizzle.config.ts`, fuori dal risolutore di alias di Next. I moduli
 * che la importano da qui non cambiano.
 */
export { CARTELLA_DATI };

/** Percorso di un file dentro l'archivio, senza vie d'uscita dalla cartella. */
export function dentroArchivio(nome: string): string | null {
  // niente separatori, niente risalite: i nomi li generiamo noi, e questa è la
  // rete di sicurezza per quando arriveranno da una richiesta
  if (!/^[A-Za-z0-9._-]+$/.test(nome) || nome.startsWith(".")) return null;
  return join(CARTELLA_DATI, nome);
}

export async function leggiArchivio<T>(nome: string, iniziale: T): Promise<T> {
  const percorso = dentroArchivio(nome);
  if (!percorso) return iniziale;
  try {
    return JSON.parse(await readFile(percorso, "utf8")) as T;
  } catch {
    // file assente o illeggibile: si parte dai valori iniziali, che è quello
    // che deve succedere alla prima installazione
    return iniziale;
  }
}

/**
 * Scrittura atomica: si scrive un file a fianco e lo si rinomina sopra.
 *
 * Serve perché un'interruzione a metà `writeFile` lascerebbe un JSON troncato,
 * cioè un archivio illeggibile — e con la lettura tollerante qui sopra,
 * illeggibile vuol dire *vuoto*: si perderebbe tutto in silenzio. `rename` sullo
 * stesso filesystem è atomico, quindi o c'è il file vecchio o c'è quello nuovo.
 */
export async function scriviArchivio<T>(nome: string, dati: T): Promise<void> {
  const percorso = dentroArchivio(nome);
  if (!percorso) throw new Error(`Nome di archivio non valido: ${nome}`);
  await mkdir(CARTELLA_DATI, { recursive: true });
  const provvisorio = `${percorso}.nuovo`;
  await writeFile(provvisorio, JSON.stringify(dati, null, 2) + "\n", "utf8");
  await rename(provvisorio, percorso);
}

/** Legge un file caricato (foto, PDF, marchio). */
export async function leggiCaricato(nome: string): Promise<Buffer | null> {
  const percorso = dentroArchivio(nome);
  if (!percorso) return null;
  try {
    return await readFile(percorso);
  } catch {
    return null;
  }
}

export async function scriviCaricato(
  nome: string,
  dati: Buffer,
  opzioni: { esclusivo?: boolean } = {},
): Promise<void> {
  const percorso = dentroArchivio(nome);
  if (!percorso) throw new Error(`Nome di file non valido: ${nome}`);
  await mkdir(CARTELLA_DATI, { recursive: true });
  // `esclusivo`: se il nome è già preso si fallisce invece di sovrascrivere il
  // file di un'altra operazione (report QA, BUG-006)
  await writeFile(percorso, dati, opzioni.esclusivo ? { flag: "wx" } : undefined);
}

export async function cancellaCaricato(nome: string): Promise<void> {
  const percorso = dentroArchivio(nome);
  if (!percorso) return;
  await unlink(percorso).catch(() => {});
}
