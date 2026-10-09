import { concesso } from "@/lib/auth/contesto";
import { soloIPropri } from "@/lib/auth/decisione";
import type { UnitaKey } from "@/lib/data";
import type { Livello } from "@/lib/permessi";
import type { Sessione } from "@/lib/sessione";
import { trovaUtente } from "@/lib/utenti";

/**
 * «È suo?» — la domanda che il social media manager deve passare prima di
 * **cancellare da sé** un album o un'attività.
 *
 * Audit degli accessi del 4 ottobre 2026 (rilievi A-4 e M-1): `copre()` gli
 * dà tutte le unità perché prepara contenuti per tutte, e fino a quel giorno
 * questo voleva dire anche vedere le bozze degli altri, con le password in
 * chiaro, ed eliminarle. Dal 4 ottobre toccava solo quello che aveva creato lui
 * (`creato_da`, migrazione 0014).
 *
 * Dal 6 ottobre 2026 lavora anche sugli album e sulle attività degli altri: è
 * lui che tiene aggiornato il sito, perché i referenti di unità non ne hanno il tempo.
 * Le password restano dei gestori, e ogni sua modifica passa da loro. La
 * domanda resta solo dove qualcosa sparirebbe senza che nessuno la guardi:
 * cancella da sé soltanto quello che ha creato lui, e il resto lo chiede.
 * Gli altri ruoli non passano di qui: per loro la risposta è sempre sì, e
 * l'ambito lo fa `copre()`.
 *
 * Modulo di solo server.
 */

/** Con questa sessione e questo livello, un contenuto creato da `creatore` è suo? */
export function eSuo(
  sessione: Sessione,
  livello: Exclude<Livello, "nessuno">,
  creatore: number | null,
): boolean {
  if (!soloIPropri(sessione.r, livello)) return true;
  // un contenuto senza autore noto non è di nessuno, e quindi non suo
  if (creatore === null) return false;
  return trovaUtente(sessione.u)?.id === creatore;
}

/**
 * La sessione corrente può mettere le mani su quest'album — vederne le bozze,
 * modificarlo, caricarci foto? Il cancello di `album-carica` sull'unità.
 *
 * Fino al 6 ottobre 2026 chiedeva anche «è suo?» per il social media manager;
 * adesso lui lavora su tutti gli album, e la password resta comunque riservata
 * (`riservata` nella sezione album, `cambiaPasswordAlbum`).
 */
export async function puoSuAlbum(_slug: string, unita: UnitaKey): Promise<boolean> {
  return !!(await concesso("album-carica", { unita }));
}

/** Come `puoSuAlbum`, per chi ha l'identificativo: la rotta delle fotografie. */
export async function puoSuAlbumId(_id: number, unita: UnitaKey): Promise<boolean> {
  return !!(await concesso("album-carica", { unita }));
}
