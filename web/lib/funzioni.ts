import { eq } from "drizzle-orm";
import { cache } from "react";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { pagineTesti } from "@/lib/db/schema";

/**
 * Le parti del sito che si possono spegnere senza toglierle dal codice.
 *
 * ## Gli album fotografici
 *
 * Spenti il 23 settembre 2026 su indicazione dei gestori, riaccesi il 3
 * ottobre col social media manager, **rispenti il 6 ottobre 2026**: per ora la
 * scheda «Foto» non deve esistere. Da quel giorno non è più una costante nel
 * codice ma un interruttore che lo sviluppatore gira dalla sua area
 * («Stato del sistema»), senza un rilascio.
 *
 * Il valore sta in `pagine_testi`, chiave `funzioni.album`, `"1"` o `"0"` —
 * la stessa tabella chiave/valore dell'identità del gruppo, quindi nessuna
 * migrazione. **La riga assente vuol dire spenti**, ed è anche quello che si
 * legge senza database (compilazione, prima installazione): un sito appena
 * installato non mostra una sezione che nessuno ha deciso di aprire.
 *
 * Con gli album spenti:
 *
 * - `/foto` e `/foto/<album>` rispondono 404, e `/foto-file/<file>` non serve
 *   più nessuna fotografia, nemmeno a chi ne conosce l'indirizzo;
 * - la voce «Foto» sparisce dal menu, dal piede, dalla home, dalla pagina 404,
 *   dalla mappa del sito e dalla ricerca;
 * - nell'area riservata la sezione «Album» sparisce dal menu, e il suo
 *   indirizzo risponde 404.
 *
 * Tabelle, consensi, coda delle derivate e album già caricati restano dove
 * sono: riaccendere li rimette online come erano.
 */
const CHIAVE_ALBUM = "funzioni.album";

/** Gli album sono accesi? `cache` la lega alla richiesta: una lettura sola. */
export const albumAttivi = cache(async (): Promise<boolean> => {
  const d = dbSeEsiste();
  if (!d) return false;
  try {
    const riga = d
      .select({ valore: pagineTesti.valore })
      .from(pagineTesti)
      .where(eq(pagineTesti.chiave, CHIAVE_ALBUM))
      .get();
    return riga?.valore === "1";
  } catch (errore) {
    solleva("funzioni.albumAttivi", errore);
  }
});

/** Accende o spegne gli album. La revalidazione delle pagine è del chiamante. */
export async function impostaAlbumAttivi(attivi: boolean): Promise<void> {
  const valore = attivi ? "1" : "0";
  const quando = adessoIso();
  try {
    transazione((d) =>
      d
        .insert(pagineTesti)
        .values({ chiave: CHIAVE_ALBUM, valore, aggiornatoIl: quando })
        .onConflictDoUpdate({ target: pagineTesti.chiave, set: { valore, aggiornatoIl: quando } })
        .run(),
    );
  } catch (errore) {
    solleva("funzioni.impostaAlbumAttivi", errore);
  }
}
