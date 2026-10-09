import { and, desc, eq, sql } from "drizzle-orm";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { dataValida } from "@/lib/attivita";
import { DESCRIZIONE_GDPR_MAX } from "@/lib/contenuti";
import { solleva } from "@/lib/db/errori";
import { richiesteGdpr as tabella, utenti } from "@/lib/db/schema";

/**
 * Il registro delle richieste degli interessati. Modulo di solo server.
 *
 * §15 del piano lo chiama «registro artt. 15–22»: gli articoli del GDPR che
 * danno a una persona il diritto di sapere quali suoi dati abbiamo, di
 * correggerli, di farli cancellare, di opporsi. La tabella `richieste_gdpr`
 * esisteva dalla fase 2A e non era usata da nessuno: era l'ultima delle ventuno
 * a non avere uno store.
 *
 * ## A che serve davvero, dato che nessuno lo controlla
 *
 * Non c'è un'autorità che lo chiede ogni anno. Serve il giorno in cui una
 * famiglia dice «vi ho chiesto di cancellare le foto di mio figlio a novembre e
 * non è stato fatto». Senza registro, quel giorno si discute di ricordi; con il
 * registro si guarda una riga, e se la riga dice «eseguita il 3 dicembre» la
 * conversazione finisce lì.
 *
 * Per questo `arrivata_il` è la data in cui la richiesta è **arrivata**, non
 * quella in cui è stata registrata: quasi mai coincidono, e la seconda non
 * dimostra niente su quanto ci è voluto.
 */

/** Gli otto diritti di §15, con le parole di chi li esercita. */
export const DIRITTI = [
  "accesso",
  "rettifica",
  "cancellazione",
  "limitazione",
  "portabilita",
  "opposizione",
  "rimozione_foto",
  "revoca_consenso",
] as const;

export type Diritto = (typeof DIRITTI)[number];

export const ETICHETTA_DIRITTO: Record<Diritto, string> = {
  accesso: "sapere quali dati abbiamo (art. 15)",
  rettifica: "correggere un dato sbagliato (art. 16)",
  cancellazione: "cancellare i dati (art. 17)",
  limitazione: "sospendere l’uso dei dati (art. 18)",
  portabilita: "ricevere i dati in un file (art. 20)",
  opposizione: "opporsi al trattamento (art. 21)",
  rimozione_foto: "togliere una fotografia dal sito",
  revoca_consenso: "revocare il consenso alle immagini",
};

export const STATI = ["ricevuta", "in_corso", "eseguita", "respinta"] as const;
export type StatoRichiesta = (typeof STATI)[number];

export const ETICHETTA_STATO: Record<StatoRichiesta, string> = {
  ricevuta: "ricevuta",
  in_corso: "in corso",
  eseguita: "eseguita",
  respinta: "respinta",
};

export const eDirittoValido = (d: string): d is Diritto =>
  (DIRITTI as readonly string[]).includes(d);
export const eStatoValido = (s: string): s is StatoRichiesta =>
  (STATI as readonly string[]).includes(s);

export interface Richiesta {
  id: number;
  arrivataIl: string;
  diritto: Diritto;
  descrizione: string;
  stato: StatoRichiesta;
  chiusaIl: string | null;
  /** nome utente di chi l'ha aperta, o `null` se l'account è stato cancellato */
  apertaDa: string | null;
  /** giorni passati dall'arrivo: il numero che conta per l'art. 12 */
  giorni: number;
}

/**
 * Un mese per rispondere, dice l'art. 12 §3. Trenta giorni è
 * l'approssimazione che serve a colorare una riga, non un termine legale.
 */
export const GIORNI_LIMITE = 30;

function giorniDa(iso: string): number {
  const quando = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(quando)) return 0;
  return Math.max(0, Math.floor((Date.now() - quando) / 86_400_000));
}

/** Le richieste, dalla più recente. `soloAperte` lascia fuori quelle chiuse. */
export function elenco(soloAperte = false): Richiesta[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    const righe = d
      .select({
        id: tabella.id,
        arrivataIl: tabella.arrivataIl,
        diritto: tabella.diritto,
        descrizione: tabella.descrizione,
        stato: tabella.stato,
        chiusaIl: tabella.chiusaIl,
        apertaDa: utenti.utente,
      })
      .from(tabella)
      .leftJoin(utenti, eq(tabella.apertaDa, utenti.id))
      .where(
        soloAperte
          ? sql`${tabella.stato} IN ('ricevuta','in_corso')`
          : undefined,
      )
      .orderBy(desc(tabella.arrivataIl), desc(tabella.id))
      .all();

    return righe.map((r) => ({
      ...r,
      diritto: r.diritto as Diritto,
      stato: r.stato as StatoRichiesta,
      giorni: giorniDa(r.arrivataIl),
    }));
  } catch (errore) {
    solleva("gdpr.elenco", errore);
  }
}

export interface ConteggiGdpr {
  aperte: number;
  /** aperte da più di trenta giorni: quelle che sono già in ritardo */
  inRitardo: number;
  eseguite: number;
  totale: number;
}

export function conteggi(): ConteggiGdpr {
  const tutte = elenco();
  const aperte = tutte.filter((r) => r.stato === "ricevuta" || r.stato === "in_corso");
  return {
    aperte: aperte.length,
    inRitardo: aperte.filter((r) => r.giorni > GIORNI_LIMITE).length,
    eseguite: tutte.filter((r) => r.stato === "eseguita").length,
    totale: tutte.length,
  };
}

/**
 * Apre una richiesta. Restituisce l'identificativo.
 *
 * `descrizione` è testo libero, e resta testo libero di proposito: una richiesta
 * arriva come la scrive chi la fa — al telefono, a voce dopo una riunione, in un
 * messaggio — e costringerla in campi strutturati vorrebbe dire perdere la parte
 * che poi serve a capire che cosa era stato chiesto davvero.
 *
 * **Non** mettete qui il nome del ragazzo se la richiesta si può descrivere
 * senza: questo registro non è coperto dalla conservazione a 24 mesi dei
 * messaggi, e resta finché non lo si cancella a mano.
 */
export function apri(
  arrivataIl: string,
  diritto: Diritto,
  descrizione: string,
  apertaDa: number | null,
): number {
  if (!eDirittoValido(diritto)) throw new Error(`Diritto non valido: ${diritto}`);
  // la forma non basta: `2026-02-31` la rispetta (report QA, BUG-009)
  if (!dataValida(arrivataIl)) {
    throw new Error(`Data non valida: ${arrivataIl}. Serve la forma 2026-11-05.`);
  }
  if (descrizione.length > DESCRIZIONE_GDPR_MAX) {
    throw new Error(`Descrizione troppo lunga: al massimo ${DESCRIZIONE_GDPR_MAX} caratteri.`);
  }
  try {
    return transazione((d) => {
      const r = d
        .insert(tabella)
        .values({ arrivataIl, diritto, descrizione, stato: "ricevuta", apertaDa })
        .returning({ id: tabella.id })
        .get();
      return r.id;
    });
  } catch (errore) {
    solleva("gdpr.apri", errore);
  }
}

/**
 * Cambia lo stato di una richiesta. Vero se c'era.
 *
 * `chiusa_il` si valorizza passando a `eseguita` o `respinta`, e si azzera
 * tornando indietro: una richiesta riaperta non ha una data di chiusura, e
 * lasciarcela vorrebbe dire un registro che dice due cose insieme.
 */
export function cambiaStato(id: number, stato: StatoRichiesta): boolean {
  if (!eStatoValido(stato)) throw new Error(`Stato non valido: ${stato}`);
  const chiusa = stato === "eseguita" || stato === "respinta";
  try {
    return transazione(
      (d) =>
        d
          .update(tabella)
          .set({
            stato,
            chiusaIl: chiusa ? sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')` : null,
          })
          .where(eq(tabella.id, id))
          .run().changes > 0,
    );
  } catch (errore) {
    solleva("gdpr.cambiaStato", errore);
  }
}

/**
 * Cancella una richiesta dal registro. Vero se c'era.
 *
 * Esiste per gli sbagli — una riga aperta due volte, una descrizione con dentro
 * un nome che non ci doveva stare — e non per ripulire la storia. Che sia stata
 * cancellata, e da chi, resta nel registro delle operazioni: è l'unico posto in
 * cui questa cancellazione lascia una traccia, e va bene così, perché quella
 * traccia non contiene i dati della richiesta.
 */
export function elimina(id: number): boolean {
  try {
    return transazione(
      (d) => d.delete(tabella).where(eq(tabella.id, id)).run().changes > 0,
    );
  } catch (errore) {
    solleva("gdpr.elimina", errore);
  }
}

/** Una richiesta per identificativo. */
export function perId(id: number): Richiesta | null {
  return elenco().find((r) => r.id === id) ?? null;
}

/** Quante richieste aperte esistono per un certo diritto. Serve agli avvisi. */
export function apertePerDiritto(diritto: Diritto): number {
  const d = dbSeEsiste();
  if (!d) return 0;
  try {
    return (
      d
        .select({ n: sql<number>`count(*)` })
        .from(tabella)
        .where(
          and(
            eq(tabella.diritto, diritto),
            sql`${tabella.stato} IN ('ricevuta','in_corso')`,
          ),
        )
        .get()?.n ?? 0
    );
  } catch {
    return 0;
  }
}
