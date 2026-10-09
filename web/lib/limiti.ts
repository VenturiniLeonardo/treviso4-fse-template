import { lt, sql } from "drizzle-orm";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { limiti as tabella } from "@/lib/db/schema";

/**
 * Contatori di frequenza per quello che non è l'accesso. Modulo di solo server.
 *
 * `tentativi_accesso` conta i tentativi falliti di entrare; questa conta gli
 * invii riusciti di chi non è entrato affatto — oggi il modulo contatti, domani
 * quello che verrà. Sono due tabelle e non una perché hanno forma diversa: là
 * una riga per tentativo, qui un secchiello per finestra temporale.
 *
 * **Finestra fissa, non scorrevole**, al contrario di `tentativi.ts`. La
 * differenza è deliberata: là si difende una password, e una finestra fissa
 * lascerebbe provare dieci volte a cavallo di due finestre; qui si evita che
 * qualcuno riempia la casella dei gestori, e sbagliare di qualche minuto
 * non ha conseguenze. In cambio ci sono poche righe invece di una per invio.
 */

export interface EsitoLimite {
  ok: boolean;
  /** quanti minuti mancano alla finestra nuova, quando è pieno */
  attesaMinuti?: number;
}

/**
 * Registra un uso e dice se era consentito.
 *
 * Il conteggio si incrementa **anche quando rifiuta**. È voluto: se non lo
 * facesse, chi continua a spingere resterebbe fermo al limite e riprenderebbe
 * esattamente allo scoccare della finestra. Incrementando, chi insiste vede la
 * finestra riempirsi e non guadagna niente a insistere.
 *
 * Lettura e scrittura stanno nella stessa transazione: fuori, due invii
 * simultanei leggerebbero lo stesso conteggio e passerebbero entrambi.
 */
export function consuma(
  ambito: string,
  chiave: string,
  massimo: number,
  finestraMinuti: number,
): EsitoLimite {
  const d = dbSeEsiste();
  // senza database non si limita niente: è il caso della compilazione, e
  // rifiutare lì bloccherebbe una pagina invece di proteggere qualcosa
  if (!d) return { ok: true };

  const finestraMs = finestraMinuti * 60_000;
  const inizioMs = Math.floor(Date.now() / finestraMs) * finestraMs;
  const inizio = `${new Date(inizioMs).toISOString().slice(0, 19)}Z`;

  try {
    return transazione((dd) => {
      const riga = dd
        .insert(tabella)
        .values({ ambito, chiave, finestraDa: inizio, conteggio: 1 })
        .onConflictDoUpdate({
          target: [tabella.ambito, tabella.chiave, tabella.finestraDa],
          set: { conteggio: sql`${tabella.conteggio} + 1` },
        })
        .returning({ conteggio: tabella.conteggio })
        .get();

      if (riga.conteggio <= massimo) return { ok: true };

      const mancano = Math.ceil((inizioMs + finestraMs - Date.now()) / 60_000);
      return { ok: false, attesaMinuti: Math.max(1, mancano) };
    });
  } catch (errore) {
    solleva("limiti.consuma", errore);
  }
}

/** Quante finestre aperte ci sono per una chiave. Serve alle prove. */
export function conteggio(ambito: string, chiave: string): number {
  const d = dbSeEsiste();
  if (!d) return 0;
  try {
    return (
      d
        .select({ n: sql<number>`coalesce(sum(${tabella.conteggio}), 0)` })
        .from(tabella)
        .where(sql`${tabella.ambito} = ${ambito} AND ${tabella.chiave} = ${chiave}`)
        .get()?.n ?? 0
    );
  } catch {
    return 0;
  }
}

/**
 * Toglie i secchielli di finestre ormai passate. Restituisce quanti.
 *
 * Fra i lavori notturni di §16. Un giorno di margine perché la finestra più
 * lunga che si usi resti comunque dentro: cancellare un secchiello ancora
 * valido regalerebbe un giro completo a chi sta spingendo.
 */
export function pulisci(): number {
  try {
    return transazione(
      (d) =>
        d
          .delete(tabella)
          .where(
            lt(tabella.finestraDa, sql`strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')`),
          )
          .run().changes,
    );
  } catch (errore) {
    solleva("limiti.pulisci", errore);
  }
}
