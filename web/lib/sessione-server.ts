import { cookies } from "next/headers";
import { leggi, type SessioneViva } from "@/lib/auth/sessioni";
import { NOME_COOKIE, type Sessione } from "@/lib/sessione";

/**
 * La sessione corrente, per le pagine e le azioni.
 *
 * Separata da `lib/sessione.ts` perché quel modulo deve restare senza
 * dipendenze — lo importano anche i componenti — mentre qui si legge un cookie
 * e si interroga il database.
 */

/** La riga di sessione viva, con l'identificativo: serve a promuoverla o chiuderla. */
export async function sessioneVivaCorrente(): Promise<SessioneViva | null> {
  const barattolo = await cookies();
  return leggi(barattolo.get(NOME_COOKIE)?.value);
}

/**
 * La sessione corrente, o `null`.
 *
 * Attenzione: una sessione in attesa del secondo fattore **non** conta come
 * sessione. Chi ha dato solo la password non è dentro, e questa funzione la
 * chiamano decine di posti che darebbero per scontato il contrario.
 *
 * Nemmeno una sessione con la password provvisoria ancora da cambiare: così
 * ogni azione, rotta di file ed esportazione la rifiuta senza doverlo sapere,
 * e la sola strada aperta resta la schermata del cambio
 * (`/area-riservata/accedi/password`), che legge la sessione viva.
 */
export async function sessioneCorrente(): Promise<Sessione | null> {
  const viva = await sessioneVivaCorrente();
  return viva && viva.stato === "attiva" && !viva.daCambiare ? viva.sessione : null;
}
