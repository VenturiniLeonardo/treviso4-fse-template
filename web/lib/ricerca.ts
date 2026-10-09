/**
 * Ricerca del sito pubblico: forma di una voce e regola di corrispondenza.
 *
 * Questo file non tocca il disco, come `lib/contenuti.ts` accanto a
 * `lib/album.ts`: esiste perché la **stessa** funzione di confronto serve al
 * componente client che disegna la tendina della lente e alla pagina `/cerca`,
 * che è resa dal server. Se fossero due funzioni diverse, la tendina e la
 * pagina risponderebbero in modo diverso alla stessa parola.
 *
 * L'indice vero — quello che deve leggere album e documenti pubblicati — sta in
 * `lib/ricerca-indice.ts`, che importa `node:fs` e quindi resta sul server.
 */

export interface VoceRicerca {
  /** quello che si legge in grassetto nell'elenco */
  titolo: string;
  /** riga di spiegazione sotto il titolo */
  testo: string;
  href: string;
  /** provenienza, come etichetta breve: «Unità», «Attività», «Foto»… */
  sezione: string;
  /**
   * Parole in più su cui cercare che non si mostrano: il nome del referente di
   * un'unità, il luogo di un'uscita, l'anno di un documento. Serve perché chi
   * cerca «Montagna» o «Ref1» non sta cercando il titolo di una pagina.
   */
  chiavi?: string;
}

/**
 * Minuscole, senza accenti e senza apostrofi.
 *
 * I testi del sito usano l'apostrofo tipografico (’), quello che si digita è
 * quello diritto ('): senza questa normalizzazione «Val d'Aosta» non troverebbe
 * «Val d’Aosta», e «Attività» non troverebbe «attivita».
 */
export function normalizza(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, "")
    .toLowerCase();
}

/** Quante lettere servono prima di mostrare dei risultati. */
export const MINIMO_LETTERE = 2;

/**
 * Le voci che corrispondono a `q`, dalla più pertinente alla meno.
 *
 * Le parole della richiesta valgono in **e**: «campo u4» dà solo le voci che
 * contengono entrambe, altrimenti due parole restituirebbero più risultati di
 * una e la ricerca sembrerebbe rotta. Il punteggio premia il titolo — dove la
 * corrispondenza è quasi sempre quella cercata — e conta poco il resto, che
 * serve soprattutto a non perdere le voci giuste.
 *
 * A pari punteggio resta l'ordine dell'indice, che non è casuale: prima le
 * pagine, poi unità, attività, foto, documenti, domande e informative.
 */
export function cerca(indice: VoceRicerca[], q: string, limite = 12): VoceRicerca[] {
  const parole = normalizza(q).split(/\s+/).filter(Boolean);
  if (!parole.length) return [];

  const trovate: { voce: VoceRicerca; punti: number }[] = [];

  for (const voce of indice) {
    const titolo = normalizza(voce.titolo);
    const resto = normalizza(`${voce.sezione} ${voce.testo} ${voce.chiavi ?? ""}`);

    let punti = 0;
    let tutte = true;

    for (const parola of parole) {
      if (titolo.startsWith(parola)) punti += 6;
      // inizio di una parola del titolo: «label» in «Unità Label»
      else if (titolo.includes(` ${parola}`) || titolo.includes(`-${parola}`)) punti += 4;
      else if (titolo.includes(parola)) punti += 3;
      else if (resto.includes(parola)) punti += 1;
      else {
        tutte = false;
        break;
      }
    }

    if (tutte) trovate.push({ voce, punti });
  }

  return trovate
    .sort((a, b) => b.punti - a.punti)
    .slice(0, limite)
    .map((t) => t.voce);
}
