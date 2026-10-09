import { cancellaCaricato } from "@/lib/archivio";
import { LATI, nomeDerivata } from "@/lib/foto/derivate";

/**
 * Toglie dall'archivio un originale e le sue tre derivate.
 *
 * Erano due copie di due righe, in `unita/actions.ts` e `immagini/actions.ts`,
 * con il commento «se un giorno diventassero tre, quel modulo va fatto». Il 3
 * ottobre 2026 sono diventate tre — l'approvazione delle fotografie proposte
 * dal social media manager porta via quella che sostituisce — ed eccolo.
 *
 * Le derivate non stanno in nessuna colonna e si ricavano dal nome: chi
 * cancellasse il solo originale lascerebbe tre file che il lavoro notturno
 * troverebbe orfani una settimana dopo.
 */
export async function portaVia(nome: string): Promise<void> {
  await cancellaCaricato(nome);
  for (const lato of LATI) await cancellaCaricato(nomeDerivata(nome, lato));
}
