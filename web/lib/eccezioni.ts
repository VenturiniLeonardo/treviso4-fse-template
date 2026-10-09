import { registroDi } from "@/lib/registro-store";
import type { Sessione } from "@/lib/sessione";

/**
 * Accesso eccezionale («break-glass») dell'amministratore ai dati delle persone.
 *
 * Audit degli accessi del 4 ottobre 2026, M-8 e SoD-3: lo sviluppatore ha
 * `completo` su tutto perché deve poter rimediare a un guasto, ma questo non
 * fa dell'elenco dei minori o della posta delle famiglie una lettura
 * ordinaria del suo lavoro. Prima di aprirli scrive **perché**: la riga va nel
 * registro, che dal 4 ottobre legge anche il gestore, e compare nel suo
 * riquadro «Da sapere». L'accesso dura mezz'ora, poi si richiede.
 *
 * Lo stato non sta in un cookie, che chi lo riceve potrebbe fabbricarsi: sta
 * nel registro stesso. L'accesso è aperto se c'è una riga di quest'utente,
 * per questa cosa, negli ultimi trenta minuti — e quella riga non si cancella.
 *
 * Modulo di solo server.
 */

export const COSE_ECCEZIONALI = {
  iscritti: "l’elenco degli iscritti e i consensi",
  messaggi: "i messaggi arrivati dal sito",
} as const;
export type CosaEccezionale = keyof typeof COSE_ECCEZIONALI;

export const DURATA_ECCEZIONE_MS = 30 * 60 * 1000;

/** L'inizio della riga di registro: è anche ciò che la verifica cerca. */
export const segnoEccezione = (cosa: CosaEccezionale) => `Accesso eccezionale a «${cosa}»`;

/** Questa sessione deve dichiarare un motivo prima di leggere? Solo l'amministratore. */
export function serveEccezione(sessione: Sessione): boolean {
  return sessione.r === "sviluppatore";
}

/** C'è un accesso eccezionale aperto, per questa sessione e questa cosa? */
export async function eccezioneAperta(sessione: Sessione, cosa: CosaEccezionale): Promise<boolean> {
  if (!serveEccezione(sessione)) return true;
  const adesso = Date.now();
  const segno = segnoEccezione(cosa);
  return (await registroDi(sessione.u)).some(
    (v) => v.operazione.startsWith(segno) && adesso - v.quando < DURATA_ECCEZIONE_MS,
  );
}
