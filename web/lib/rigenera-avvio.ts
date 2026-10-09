import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * All'avvio, tutte le pagine pubbliche si dichiarano scadute (QA BUG-013).
 *
 * ## Perché
 *
 * Una modifica salvata nell'area riservata chiama `revalidatePath`, e Next
 * segna la pagina come scaduta **in memoria**: la rigenera alla prima visita.
 * Se il processo si riavvia prima di quella visita — un aggiornamento del
 * sistema alle tre di notte, un crash — il segno si perde, e il processo nuovo
 * serve la pagina che ha su disco: quella della compilazione, o l'ultima
 * rigenerata, cioè quella di prima della modifica. Il dato nel database è
 * giusto, la pagina no, e nessuno lo vede finché qualcuno non risalva.
 *
 * Dichiararle tutte scadute all'avvio costa una lettura del database per
 * pagina, una volta per riavvio, alla prima visita di ciascuna: poco, e chiude
 * il buco qualunque sia l'ordine fra salvataggio, visita e riavvio.
 *
 * ## Perché una rotta
 *
 * `revalidatePath` vuole una richiesta in corso: chiamata da
 * `instrumentation.ts` fallisce. Quindi `register()` chiama sé stesso, una
 * volta, su `/api/rigenera-avvio`, con un gettone casuale che esiste solo nella
 * memoria di questo processo e vale una volta. Senza il gettone giusto la rotta
 * risponde 404, come se non ci fosse.
 */

const CHIAVE = Symbol.for("sito.rigenera-avvio");

type ConGettone = typeof globalThis & { [CHIAVE]?: string };

/** Crea il gettone dell'avvio. Lo chiama soltanto `instrumentation.ts`. */
export function nuovoGettone(): string {
  const gettone = randomBytes(32).toString("base64url");
  (globalThis as ConGettone)[CHIAVE] = gettone;
  return gettone;
}

/** Vero una volta sola, e solo con il gettone di questo processo. */
export function consumaGettone(dato: string | null): boolean {
  const atteso = (globalThis as ConGettone)[CHIAVE];
  if (!atteso || !dato) return false;
  const a = Buffer.from(atteso);
  const b = Buffer.from(dato);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  delete (globalThis as ConGettone)[CHIAVE];
  return true;
}

export const INTESTAZIONE_GETTONE = "x-sito-avvio";
