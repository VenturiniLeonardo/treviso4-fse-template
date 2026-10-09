import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { inviti as tabella, unita as tabellaUnita, utenti } from "@/lib/db/schema";
import { improntaDi } from "@/lib/auth/sessioni";

/**
 * Gli inviti: l'unico modo di entrare per la prima volta. Modulo di solo server.
 *
 * §7 del piano: «nessuna registrazione pubblica, nessun accesso con Google. Si
 * entra solo su invito di un amministratore». Un invito è un token monouso che
 * dura settantadue ore e serve a fare in un passaggio le due cose che un account
 * nuovo deve fare: scegliere la password e attivare il secondo fattore.
 *
 * Come per le sessioni, nel database c'è **l'impronta** del token, mai il token.
 * Chi legge il database non può usare un invito, e nemmeno chi legge una copia
 * di sicurezza — che è dove le credenziali finiscono per restare più a lungo.
 *
 * Un invito non è una credenziale a metà: chi lo consuma sceglie la password, e
 * finché non l'ha scelta l'account resta `invitato`, cioè uno con cui
 * `verificaCredenziali` non fa entrare nessuno.
 */

/** Settantadue ore, come dice la tabella di §7. */
export const DURATA_ORE = 72;

const ADESSO = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`;

/**
 * Crea un invito e restituisce il token **una volta sola**.
 *
 * Chi chiama lo consegna a mano o per posta e non lo salva da nessuna parte: da
 * qui in poi non è più ricavabile.
 *
 * Gli inviti aperti dello stesso utente vengono cancellati: se si reinvita
 * qualcuno è perché il primo non è arrivato o si è perso, e lasciarne due in
 * giro raddoppia le occasioni che uno finisca nelle mani sbagliate.
 */
export function crea(utenteId: number): string {
  const token = randomBytes(32).toString("base64url");
  try {
    transazione((d) => {
      d.delete(tabella)
        .where(and(eq(tabella.utenteId, utenteId), isNull(tabella.usatoIl)))
        .run();
      d.insert(tabella)
        .values({
          utenteId,
          impronta: improntaDi(token),
          scadeIl: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now',${`+${DURATA_ORE} hours`})`,
        })
        .run();
    });
  } catch (errore) {
    solleva("inviti.crea", errore);
  }
  return token;
}

export interface InvitoValido {
  id: number;
  utenteId: number;
  utente: string;
  nome: string;
  ruolo: string;
  unita?: string;
}

/**
 * L'invito di un token, se è ancora buono. `null` per qualunque altro motivo.
 *
 * «Ancora buono» vuol dire: esiste, non è scaduto, non è stato usato, e
 * l'account a cui punta non è stato revocato nel frattempo. L'ultimo controllo
 * non è teorico — fra l'invio di un invito e il suo uso passano fino a tre
 * giorni, e in tre giorni si può cambiare idea su chi far entrare.
 */
export function leggi(token: string | undefined): InvitoValido | null {
  if (!token) return null;
  const d = dbSeEsiste();
  if (!d) return null;

  try {
    const r = d
      .select({
        id: tabella.id,
        utenteId: tabella.utenteId,
        utente: utenti.utente,
        nome: utenti.nome,
        ruolo: utenti.ruolo,
        statoUtente: utenti.stato,
        unita: tabellaUnita.chiave,
      })
      .from(tabella)
      .innerJoin(utenti, eq(tabella.utenteId, utenti.id))
      .leftJoin(tabellaUnita, eq(utenti.unitaId, tabellaUnita.id))
      .where(
        and(
          eq(tabella.impronta, improntaDi(token)),
          isNull(tabella.usatoIl),
          sql`${tabella.scadeIl} > ${ADESSO}`,
        ),
      )
      .get();

    if (!r || r.statoUtente === "revocato") return null;
    return {
      id: r.id,
      utenteId: r.utenteId,
      utente: r.utente,
      nome: r.nome,
      ruolo: r.ruolo,
      ...(r.unita ? { unita: r.unita } : {}),
    };
  } catch (errore) {
    solleva("inviti.leggi", errore);
  }
}

/**
 * Segna l'invito come consumato. Vero se è riuscito, falso se qualcuno è
 * arrivato prima.
 *
 * Il `WHERE usato_il IS NULL` dentro l'`UPDATE` è ciò che rende il token
 * davvero monouso: due richieste simultanee con lo stesso token entrano
 * entrambe nella transazione, ma solo la prima trova la riga da aggiornare —
 * `changes` dice quale. Controllare prima e aggiornare dopo, in due passi,
 * lascerebbe la fessura in mezzo.
 */
export function consuma(id: number): boolean {
  try {
    return transazione((d) => {
      const n = d
        .update(tabella)
        .set({ usatoIl: ADESSO })
        .where(and(eq(tabella.id, id), isNull(tabella.usatoIl)))
        .run();
      return n.changes > 0;
    });
  } catch (errore) {
    solleva("inviti.consuma", errore);
  }
}

/** Toglie gli inviti scaduti e quelli già usati. Restituisce quanti. */
export function pulisci(): number {
  try {
    return transazione(
      (d) =>
        d
          .delete(tabella)
          .where(or(lt(tabella.scadeIl, ADESSO), isNotNull(tabella.usatoIl)))
          .run().changes,
    );
  } catch (errore) {
    solleva("inviti.pulisci", errore);
  }
}
