/**
 * Un indirizzo di ritorno, accettato solo se resta dentro il sito.
 *
 * Il filtro di prima — comincia con `/`, non con `//`, niente `..` — lasciava
 * passare `/\esempio.com`: molti browser trattano la barra rovesciata come una
 * barra, e il collegamento «torna indietro» portava fuori dal sito (audit di
 * sicurezza, WEB-01). Qui, oltre ai controlli di prima, niente barre
 * rovesciate né caratteri di controllo, e la prova del nove: risolto contro
 * un'origine qualunque, l'indirizzo deve restare su quell'origine.
 *
 * Funzione pura: la usano le pagine, e la provano le prove.
 */
export function percorsoInterno(da: string | null | undefined, prefisso = "/"): string | null {
  if (!da || !da.startsWith(prefisso) || da.startsWith("//") || da.includes("..")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(da)) return null;
  const origine = "http://interno.invalid";
  try {
    return new URL(da, origine).origin === origine ? da : null;
  } catch {
    return null;
  }
}
