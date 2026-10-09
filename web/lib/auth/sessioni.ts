import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { sessioni as tabella, unita as tabellaUnita, utenti } from "@/lib/db/schema";
import type { RuoloSessione, Sessione } from "@/lib/sessione";

/**
 * Le sessioni: un numero casuale nel cookie, tutto il resto nel database.
 *
 * Fino alla fase 6 il cookie **era** la sessione: un JSON con nome, ruolo e
 * scadenza, firmato con HMAC. Funzionava e aveva due difetti che il piano §7
 * chiude entrambi.
 *
 * Il primo: non si poteva revocare niente. Un cookie firmato è valido finché
 * non scade, ovunque si trovi; togliere l'accesso a un referente voleva dire
 * cambiare `SESSIONE_SEGRETO` e buttare fuori tutti gli altri insieme a lui.
 * Adesso una sessione è una riga: si cancella, e alla richiesta dopo non esiste
 * più. «Revoca immediata», come dice la tabella di §7.
 *
 * Il secondo: nel cookie c'erano i dati. Ruolo e unità viaggiavano nel browser,
 * e ogni cambio di ruolo restava senza effetto fino alla scadenza — otto ore in
 * cui una promozione o una retrocessione non contavano. Adesso ruolo e unità si
 * leggono a ogni richiesta dalla riga di `utenti`.
 *
 * **Nel database non c'è il token, c'è la sua impronta SHA-256.** Chi legge il
 * file del database non ottiene delle credenziali valide: ottiene dei digest,
 * che per entrare non servono. Un SHA-256 senza sale va benissimo qui, e sarebbe
 * sbagliato per una password: la differenza è che il token ha 256 bit di
 * casualità vera, quindi non c'è nessun dizionario da provare.
 *
 * Modulo di solo server.
 */

/**
 * Otto ore di inattività, dodici in totale. Sono i due limiti di §7 del piano,
 * e sono due perché una sessione ferma da otto ore e una lavorata per dodici
 * sono due cose diverse: con una scadenza sola non si distinguono.
 */
export const INATTIVITA_S = 8 * 60 * 60;
export const DURATA_MASSIMA_S = 12 * 60 * 60;

/**
 * Quanto dura la mezza sessione fra la password e il codice a sei cifre.
 *
 * Cinque minuti: il tempo di prendere il telefono. Più a lungo, «ho dato la
 * password giusta» resterebbe appeso su un computer condiviso.
 */
export const ATTESA_TOTP_S = 5 * 60;

export type StatoSessione = "attesa_totp" | "attiva";

/** Trentadue byte casuali: quello che finisce nel cookie e da nessun'altra parte. */
function nuovoToken(): string {
  return randomBytes(32).toString("base64url");
}

/** L'impronta con cui la riga si ritrova. Esadecimale, 64 caratteri. */
export function improntaDi(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const fraSecondi = (s: number) => sql`strftime('%Y-%m-%dT%H:%M:%SZ','now',${`+${s} seconds`})`;
const ADESSO = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`;

/**
 * Apre una sessione e restituisce il token **una volta sola**.
 *
 * Da qui in poi il token non è più recuperabile da nessuna parte: nel database
 * c'è solo l'impronta. Chi chiama lo mette nel cookie e lo dimentica.
 *
 * Una sessione in `attesa_totp` scade in cinque minuti e non in dodici ore: fra
 * la password e il secondo fattore non si è ancora dentro.
 */
export function apri(
  utenteId: number,
  ip: string | null,
  stato: StatoSessione = "attiva",
): string {
  const token = nuovoToken();
  try {
    transazione((d) => {
      d.insert(tabella)
        .values({
          utenteId,
          impronta: improntaDi(token),
          scadeIl: fraSecondi(stato === "attiva" ? DURATA_MASSIMA_S : ATTESA_TOTP_S),
          ip,
          stato,
        })
        .run();
    });
  } catch (errore) {
    solleva("sessioni.apri", errore);
  }
  return token;
}

export interface SessioneViva {
  /** identificativo della riga, per promuoverla o chiuderla */
  id: number;
  utenteId: number;
  stato: StatoSessione;
  /**
   * Vero se l'account ha ancora la password provvisoria. Una sessione `attiva`
   * con questo segno apre soltanto la schermata del cambio password: lo fanno
   * rispettare `proxy.ts` per le pagine e `sessioneCorrente` per tutto il resto.
   * Si rilegge a ogni richiesta, come il ruolo: cambiata la password, vale subito.
   */
  daCambiare: boolean;
  /** la sessione nella forma che il resto dell'applicazione già conosce */
  sessione: Sessione;
}

/**
 * Legge la sessione di un token, e le rinfresca l'inattività.
 *
 * Restituisce `null` per qualunque motivo di rifiuto — token sconosciuto, ferma
 * da più di otto ore, aperta da più di dodici, utente revocato o sparito. Chi
 * chiama non deve poter distinguere i casi: nessuno di quei dettagli serve a chi
 * non è entrato, e tutti servono a chi ci sta provando.
 *
 * La scrittura di `ultimo_uso` sta nella **stessa transazione** della lettura, e
 * avviene solo se la sessione è ancora buona: aggiornarla prima di aver
 * verificato la scadenza terrebbe viva per sempre una sessione morta, bastando
 * ricaricare una pagina.
 */
export function leggi(token: string | undefined): SessioneViva | null {
  if (!token) return null;
  const d = dbSeEsiste();
  if (!d) return null;

  try {
    return transazione((dd) => {
      const r = dd
        .select({
          id: tabella.id,
          utenteId: tabella.utenteId,
          stato: tabella.stato,
          scadeIl: tabella.scadeIl,
          ultimoUso: tabella.ultimoUso,
          utente: utenti.utente,
          ruolo: utenti.ruolo,
          nome: utenti.nome,
          iniziali: utenti.iniziali,
          statoUtente: utenti.stato,
          daCambiare: utenti.passwordDaCambiare,
          unita: tabellaUnita.chiave,
        })
        .from(tabella)
        .innerJoin(utenti, eq(tabella.utenteId, utenti.id))
        .leftJoin(tabellaUnita, eq(utenti.unitaId, tabellaUnita.id))
        .where(
          and(
            eq(tabella.impronta, improntaDi(token)),
            // limite assoluto
            sql`${tabella.scadeIl} > ${ADESSO}`,
            // limite di inattività
            sql`${tabella.ultimoUso} > strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${INATTIVITA_S} seconds`})`,
          ),
        )
        .get();

      // un account revocato non ha più sessioni valide, anche se la riga c'è
      // ancora: la revoca le cancella, ma questo è il controllo che non si
      // affida a quella cancellazione essere andata a buon fine
      if (!r || r.statoUtente !== "attivo") return null;

      dd.update(tabella).set({ ultimoUso: ADESSO }).where(eq(tabella.id, r.id)).run();

      return {
        id: r.id,
        utenteId: r.utenteId,
        stato: r.stato as StatoSessione,
        daCambiare: r.daCambiare === 1,
        sessione: {
          u: r.utente,
          r: r.ruolo as RuoloSessione,
          n: r.nome,
          i: r.iniziali,
          ...(r.unita ? { un: r.unita } : {}),
          exp: Math.floor(Date.parse(r.scadeIl) / 1000),
        },
      };
    });
  } catch (errore) {
    solleva("sessioni.leggi", errore);
  }
}

/**
 * Promuove una mezza sessione a sessione piena, dopo il secondo fattore.
 *
 * Insieme allo stato si allunga la scadenza: la riga era nata con cinque minuti
 * davanti, adesso ne ha dodici ore. Il token **non** cambia — cambiarlo
 * costringerebbe a riscrivere il cookie in una risposta che di solito è un
 * `redirect`, e non aggiungerebbe niente: quel token non è mai stato valido per
 * entrare da nessuna parte.
 */
export function promuovi(id: number): boolean {
  try {
    return transazione((d) => {
      const n = d
        .update(tabella)
        .set({ stato: "attiva", scadeIl: fraSecondi(DURATA_MASSIMA_S), ultimoUso: ADESSO })
        .where(and(
          eq(tabella.id, id),
          eq(tabella.stato, "attesa_totp"),
          sql`${tabella.scadeIl} > ${ADESSO}`,
          sql`${tabella.ultimoUso} > strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${INATTIVITA_S} seconds`})`,
          sql`exists (select 1 from ${utenti} where ${utenti.id} = ${tabella.utenteId} and ${utenti.stato} = 'attivo')`,
        ))
        .run();
      return n.changes > 0;
    });
  } catch (errore) {
    solleva("sessioni.promuovi", errore);
  }
}

/** Chiude una sessione: l'uscita. Cancella la riga, non la marca. */
export function chiudi(token: string | undefined): void {
  if (!token) return;
  try {
    transazione((d) => {
      d.delete(tabella).where(eq(tabella.impronta, improntaDi(token))).run();
    });
  } catch (errore) {
    solleva("sessioni.chiudi", errore);
  }
}

/**
 * Butta fuori un utente da ogni suo accesso aperto. Restituisce quante.
 *
 * È la seconda metà della revoca di §7: senza, un referente a cui è stato tolto
 * l'accesso resterebbe dentro fino a dodici ore. Serve anche al cambio di
 * password — chi cambia la password di solito lo fa proprio perché sospetta che
 * qualcun altro la conosca.
 */
export function chiudiTuttePerUtente(utenteId: number): number {
  try {
    return transazione((d) => {
      return d.delete(tabella).where(eq(tabella.utenteId, utenteId)).run().changes;
    });
  } catch (errore) {
    solleva("sessioni.chiudiTuttePerUtente", errore);
  }
}

/**
 * Chiude tutte le sessioni di un utente **tranne una**. Restituisce quante.
 *
 * È il cambio di password: chi lo fa quasi sempre teme che qualcun altro
 * conosca la vecchia, e lasciare aperte le sessioni già avviate renderebbe il
 * cambio inutile — chi era dentro resterebbe dentro fino a dodici ore. Ma
 * buttare fuori anche chi ha appena fatto la cosa giusta sarebbe una punizione
 * senza motivo, e per questo il proprio token si esclude.
 *
 * Si esclude per impronta, non cancellando e ricreando la riga: ricreare
 * vorrebbe dire una funzione «fabbrica una sessione da un token», che è
 * esattamente ciò che questo modulo esiste per non offrire a nessuno.
 */
export function chiudiAltrePerUtente(utenteId: number, tokenDaTenere: string): number {
  try {
    return transazione((d) =>
      d
        .delete(tabella)
        .where(
          and(eq(tabella.utenteId, utenteId), ne(tabella.impronta, improntaDi(tokenDaTenere))),
        )
        .run().changes,
    );
  } catch (errore) {
    solleva("sessioni.chiudiAltrePerUtente", errore);
  }
}

/**
 * Toglie le righe scadute. Restituisce quante.
 *
 * §16 del piano la mette fra i lavori notturni delle 02:15. Non serve alla
 * correttezza — `leggi` scarta comunque le scadute — serve a non lasciare che la
 * tabella cresca per sempre con righe che non valgono più niente.
 */
export function pulisci(): number {
  try {
    return transazione((d) =>
      d
        .delete(tabella)
        .where(
          or(
            lt(tabella.scadeIl, ADESSO),
            lt(
              tabella.ultimoUso,
              sql`strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${INATTIVITA_S} seconds`})`,
            ),
          ),
        )
        .run().changes,
    );
  } catch (errore) {
    solleva("sessioni.pulisci", errore);
  }
}

/** Solo metadati delle sessioni vive dell'account; nessun token o digest esce. */
export function elencoSessioniPerUtente(utenteId: number, tokenCorrente: string): { id: number; creataIl: string; ultimoUso: string; ip: string | null; corrente: boolean }[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return d.select({ id: tabella.id, creataIl: tabella.creataIl, ultimoUso: tabella.ultimoUso, ip: tabella.ip, impronta: tabella.impronta })
      .from(tabella).where(and(eq(tabella.utenteId, utenteId), eq(tabella.stato, "attiva"), sql`${tabella.scadeIl} > ${ADESSO}`, sql`${tabella.ultimoUso} > strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${INATTIVITA_S} seconds`})`)).all()
      .map(({ impronta, ...r }) => ({ ...r, corrente: impronta === improntaDi(tokenCorrente) }));
  } catch (errore) { solleva("sessioni.elencoPerUtente", errore); }
}

/** Il bersaglio deve essere dell'account corrente e diverso dal suo accesso. */
export function chiudiSessionePerUtente(utenteId: number, id: number, tokenDaTenere: string): boolean {
  try {
    return transazione((d) => d.delete(tabella).where(and(eq(tabella.utenteId, utenteId), eq(tabella.id, id), ne(tabella.impronta, improntaDi(tokenDaTenere)))).run().changes > 0);
  } catch (errore) { solleva("sessioni.chiudiPerUtente", errore); }
}
