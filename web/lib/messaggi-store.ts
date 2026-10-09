import { and, desc, eq, lt, sql } from "drizzle-orm";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { messaggi as tabella } from "@/lib/db/schema";

/**
 * I messaggi del modulo contatti. Modulo di solo server.
 *
 * Prima non c'era niente: la Server Action validava e buttava via, e il
 * commento in fondo diceva «da collegare (fase F5)». Questa è quella fase per
 * la parte che riguarda il database.
 *
 * ## Quello che questo modulo NON fa
 *
 * **Non manda niente per posta.** §9 del piano prevede una notifica ai referenti
 * gruppo con un servizio di posta transazionale, e quello non c'è ancora. Un
 * messaggio salvato qui è raggiungibile — i gestori lo vedono entrando
 * nell'area riservata — ma nessuno riceve un avviso. È una differenza che chi
 * scrive deve sapere, e la schermata gliela dice: «lo leggono quando entrano».
 * Chiamarlo «inviato» sarebbe di nuovo la bugia che l'altra sessione ha appena
 * tolto di mezzo.
 *
 * ## Dati personali
 *
 * Nome, indirizzo, telefono e testo libero di una persona che spesso non è
 * iscritta a niente: è la tabella con i dati più esposti del sistema dopo
 * `utenti`. Per questo la conservazione è di ventiquattro mesi e la
 * cancellazione singola esiste — §15 del piano, diritto alla cancellazione.
 */

/** Ventiquattro mesi, come dice §16. Il lavoro notturno cancella oltre. */
export const CONSERVAZIONE_MESI = 24;

export type StatoMessaggio = "da_leggere" | "letto" | "risposto";

export interface Messaggio {
  id: number;
  quando: string;
  nome: string;
  email: string;
  telefono: string;
  /** una delle chiavi di `MOTIVI_CONTATTO` */
  motivo: string;
  messaggio: string;
  stato: StatoMessaggio;
  ip: string | null;
}

export interface NuovoMessaggio {
  nome: string;
  email: string;
  telefono: string;
  motivo: string;
  messaggio: string;
}

/**
 * Salva un messaggio. Restituisce il suo identificativo.
 *
 * L'indirizzo IP si conserva perché serve a riconoscere un invio automatico che
 * riempie la casella, ed è l'unico modo di distinguerlo da venti famiglie che
 * scrivono nello stesso pomeriggio. Sparisce con il messaggio dopo
 * ventiquattro mesi, insieme a tutto il resto.
 */
export function salva(nuovo: NuovoMessaggio, ip: string | null): number {
  try {
    return transazione((d) => {
      const r = d
        .insert(tabella)
        .values({
          nome: nuovo.nome,
          email: nuovo.email,
          telefono: nuovo.telefono,
          motivo: nuovo.motivo,
          messaggio: nuovo.messaggio,
          stato: "da_leggere",
          ip,
        })
        .returning({ id: tabella.id })
        .get();
      return r.id;
    });
  } catch (errore) {
    solleva("messaggi.salva", errore);
  }
}

/**
 * I messaggi, dal più recente. `stato` filtra, se dato.
 *
 * Nessuna paginazione: sono le richieste di un gruppo locale, non di un
 * servizio. Se un giorno fossero migliaia, il limite sarebbe la prima cosa da
 * aggiungere — e lo si scoprirebbe da questa riga.
 */
export function elenco(stato?: StatoMessaggio): Messaggio[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return d
      .select()
      .from(tabella)
      .where(stato ? eq(tabella.stato, stato) : undefined)
      .orderBy(desc(tabella.quando), desc(tabella.id))
      .all()
      .map((r) => ({ ...r, stato: r.stato as StatoMessaggio }));
  } catch (errore) {
    solleva("messaggi.elenco", errore);
  }
}

/** Quanti ce ne sono per stato. Serve al pallino sul menù. */
export function conteggi(): Record<StatoMessaggio, number> {
  const vuoto = { da_leggere: 0, letto: 0, risposto: 0 };
  const d = dbSeEsiste();
  if (!d) return vuoto;
  try {
    const righe = d
      .select({ stato: tabella.stato, n: sql<number>`count(*)` })
      .from(tabella)
      .groupBy(tabella.stato)
      .all();
    const fuori = { ...vuoto };
    for (const r of righe) fuori[r.stato as StatoMessaggio] = r.n;
    return fuori;
  } catch {
    // il pallino è un di più: se il database non risponde, la schermata mostra
    // il resto invece di un errore
    return vuoto;
  }
}

/**
 * Cambia lo stato di un messaggio. Vero se c'era.
 *
 * Non si torna indietro da `risposto` a `da_leggere` — non è vietato, è che non
 * esiste un pulsante che lo faccia: è uno stato che descrive un fatto avvenuto.
 */
export function cambiaStato(id: number, stato: StatoMessaggio): boolean {
  try {
    return transazione(
      (d) => d.update(tabella).set({ stato }).where(eq(tabella.id, id)).run().changes > 0,
    );
  } catch (errore) {
    solleva("messaggi.cambiaStato", errore);
  }
}

/**
 * Cancella un messaggio, davvero. Vero se c'era.
 *
 * Nessun contrassegno «cancellato»: §15 del piano dice che la cancellazione
 * cancella. Chi scrive per chiedere che i propri dati spariscano non deve
 * ritrovarseli in una riga marcata.
 */
export function elimina(id: number): boolean {
  try {
    return transazione(
      (d) => d.delete(tabella).where(eq(tabella.id, id)).run().changes > 0,
    );
  } catch (errore) {
    solleva("messaggi.elimina", errore);
  }
}

/**
 * Toglie i messaggi oltre la conservazione. Restituisce quanti.
 *
 * §16 lo mette alle 02:10 insieme al registro. Non è una gentilezza: tenere i
 * dati di contatto di una famiglia per sempre, quando la domanda a cui
 * servivano ha avuto risposta due anni fa, non ha una base per cui farlo.
 */
export function pulisci(): number {
  try {
    return transazione(
      (d) =>
        d
          .delete(tabella)
          .where(
            lt(
              tabella.quando,
              sql`strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${CONSERVAZIONE_MESI} months`})`,
            ),
          )
          .run().changes,
    );
  } catch (errore) {
    solleva("messaggi.pulisci", errore);
  }
}

/** Cancella tutti i messaggi di un indirizzo. La richiesta GDPR più comune. */
export function eliminaPerEmail(email: string): number {
  try {
    return transazione(
      (d) =>
        d
          .delete(tabella)
          .where(and(sql`lower(${tabella.email}) = ${email.trim().toLowerCase()}`))
          .run().changes,
    );
  } catch (errore) {
    solleva("messaggi.eliminaPerEmail", errore);
  }
}
