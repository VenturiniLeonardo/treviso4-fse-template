import { sql } from "drizzle-orm";
import { db, dbSeEsiste } from "@/lib/db/db";

/**
 * Manutenzione del database — §16, il lavoro delle 03:30 di domenica.
 *
 * Due operazioni con caratteri opposti, e vale la pena sapere quale è quale.
 *
 * **`PRAGMA optimize`** è economica e si può eseguire quanto si vuole:
 * ricalcola le statistiche che il pianificatore usa per scegliere gli indici.
 * Senza, SQLite continua a usare un piano deciso quando la tabella era vuota — e
 * su `registro`, che cresce di qualche migliaio di righe l'anno, dopo un po' si
 * vede.
 *
 * **`VACUUM`** riscrive il file da zero. Recupera lo spazio delle righe
 * cancellate, che con la conservazione a dodici mesi non è poco, e in cambio:
 *
 *  - richiede spazio libero pari alla dimensione del database, perché lo scrive
 *    a fianco prima di sostituirlo;
 *  - prende un lucchetto esclusivo, quindi per la sua durata **nessuno** scrive;
 *  - non si può eseguire dentro una transazione.
 *
 * Per questo §16 lo mette una volta al mese e non ogni notte, e per questo qui
 * non passa da `transazione()`.
 *
 * Modulo di solo server.
 */

export interface EsitoManutenzione {
  ottimizzato: boolean;
  /** `null` se non era il turno del VACUUM */
  byteRecuperati: number | null;
  /** quanto è durato il VACUUM, in millisecondi */
  durataMs: number | null;
  /** perché non è stato fatto, quando non è stato fatto */
  motivo?: string;
}

/**
 * `PRAGMA optimize`, e il `VACUUM` se `conVacuum`.
 *
 * `conVacuum` lo decide chi chiama — lo script guarda il giorno del mese —
 * perché una funzione che consulta il calendario da sé non si può provare senza
 * spostare l'orologio.
 */
export function manutenzione(conVacuum = false): EsitoManutenzione {
  const d = dbSeEsiste();
  if (!d) {
    return {
      ottimizzato: false,
      byteRecuperati: null,
      durataMs: null,
      motivo: "il database non è raggiungibile",
    };
  }

  // `optimize` non solleva e non blocca: è la parte che si fa sempre
  d.run(sql`PRAGMA optimize`);
  if (!conVacuum) return { ottimizzato: true, byteRecuperati: null, durataMs: null };

  /*
   * Le pagine libere **prima**, per poter dire quanto si è recuperato.
   *
   * `page_count * page_size` è la dimensione logica del file; `freelist_count`
   * sono le pagine che il `VACUUM` restituirà al filesystem. Si legge prima
   * perché dopo, per costruzione, la lista libera è vuota.
   */
  const prima = pagine(d);

  const inizio = Date.now();
  try {
    // fuori da qualunque transazione: SQLite rifiuta un VACUUM dentro una
    db().$client.exec("VACUUM");
  } catch (errore) {
    return {
      ottimizzato: true,
      byteRecuperati: null,
      durataMs: Date.now() - inizio,
      motivo: `il VACUUM non è riuscito: ${errore instanceof Error ? errore.name : "errore"}`,
    };
  }

  return {
    ottimizzato: true,
    byteRecuperati: prima.libere * prima.dimensionePagina,
    durataMs: Date.now() - inizio,
  };
}

function pagine(d: NonNullable<ReturnType<typeof dbSeEsiste>>): {
  libere: number;
  dimensionePagina: number;
} {
  const leggi = (nome: string): number => {
    const r = d.$client.pragma(nome, { simple: true });
    return typeof r === "number" ? r : 0;
  };
  return { libere: leggi("freelist_count"), dimensionePagina: leggi("page_size") };
}

/**
 * Quanto occupa il database, in byte. Serve al rapporto del lavoro notturno.
 *
 * È la dimensione **logica** — pagine per byte-per-pagina — e non quella del
 * file su disco: con il WAL attivo il file può essere più piccolo di così, e in
 * ogni caso quello che interessa è quanto sta crescendo il contenuto.
 */
export function dimensioneDb(): number | null {
  const d = dbSeEsiste();
  if (!d) return null;
  const leggi = (nome: string): number => {
    const r = d.$client.pragma(nome, { simple: true });
    return typeof r === "number" ? r : 0;
  };
  return leggi("page_count") * leggi("page_size");
}
