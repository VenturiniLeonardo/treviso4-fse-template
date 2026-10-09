import type { GruppoNav, Ruolo } from "@/lib/data-area";

/**
 * Il menu del ruolo senza le sezioni che la matrice non concede.
 *
 * Sta in un file suo, che da `data-area.ts` prende solo i tipi, perché la
 * tendina è un componente client: importare un valore da lì porterebbe nel
 * browser tutti i testi dell'area riservata.
 *
 * I menu sono due — la colonna laterale e la tendina dei telefoni — e prima
 * filtrava solo la colonna: su schermo stretto la tendina offriva ancora le
 * voci chiuse, e sceglierne una portava al rifiuto. Il filtro sta qui perché
 * i due non possano più dire cose diverse.
 *
 * Un gruppo rimasto senza voci si toglie: un'intestazione sola sembra una
 * sezione che non ha finito di caricare. `tieni` è una voce che resta anche se
 * nascosta: la tendina mostra sempre la sezione aperta, altrimenti un
 * `<select>` senza l'opzione corrispondente indicherebbe la prima della lista,
 * cioè un posto in cui non si è.
 */
export function navVisibile(
  ruolo: Ruolo,
  nascoste: ReadonlySet<string> | undefined,
  tieni?: string,
): GruppoNav[] {
  return ruolo.nav
    .map((g) => ({
      ...g,
      voci: g.voci.filter((v) => v.chiave === tieni || !nascoste?.has(v.chiave)),
    }))
    .filter((g) => g.voci.length > 0);
}
