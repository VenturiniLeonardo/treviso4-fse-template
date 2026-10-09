/**
 * Testi delle pagine legali linkate nel piede, serviti dalla rotta
 * `/legale/[slug]`.
 *
 * Sono **segnaposto**: «Label» per i testi brevi e Lorem ipsum per quelli
 * lunghi. Vanno sostituiti con testi scritti e approvati da chi gestisce il
 * sito, che ne risponde. Finché il codice fiscale e la data di approvazione in
 * `GRUPPO` sono vuoti, `legaleApprovato()` restituisce `false` e ogni pagina
 * mostra in cima il riquadro di bozza.
 */

import { GRUPPO } from "@/lib/data";
import { type Identita } from "@/lib/identita";

export interface SezioneLegale {
  titolo: string;
  /** capoversi del corpo */
  paragrafi?: string[];
  /** elenco puntato, in coda ai capoversi */
  elenco?: { voce: string; testo: string }[];
  /** riquadro finale, per i recapiti a cui scrivere */
  nota?: string;
}

export interface PaginaLegale {
  /** indirizzo della pagina: /legale/<slug> */
  slug: string;
  /** titolo lungo, in cima alla pagina */
  titolo: string;
  /** etichetta breve, usata nel piede e nel percorso */
  breve: string;
  sommario: string;
  aggiornamento: string;
  sezioni: SezioneLegale[];
}

/**
 * La data in cima alle informative: quella dell'approvazione, e finché non c'è
 * un'etichetta segnaposto. Anche «Preferenze cookie» la usa.
 */
export const AGGIORNAMENTO = GRUPPO.legaleApprovatoIl.trim() || "Label";

/**
 * I testi legali sono approvati e completi? Servono sia il codice fiscale del
 * gruppo sia la data di approvazione: finché una delle due manca, le pagine
 * mostrano il riquadro di bozza.
 */
export function legaleApprovato(): boolean {
  return GRUPPO.codiceFiscale.trim() !== "" && GRUPPO.legaleApprovatoIl.trim() !== "";
}

/** Che cosa manca, per dirlo a chi legge il riquadro. */
export function legaleMancante(): string[] {
  const mancano: string[] = [];
  if (GRUPPO.codiceFiscale.trim() === "") mancano.push("Label");
  if (GRUPPO.legaleApprovatoIl.trim() === "") mancano.push("Label");
  return mancano;
}

/** L'ente a cui il gruppo appartiene, se c'è: segnaposto. */
export const ASSOCIAZIONE = {
  nome: "Label",
  codiceFiscale: "",
  sede: "Label",
  emailPrivacy: "",
  sito: "",
} as const;

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor " +
  "incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis " +
  "nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " +
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu " +
  "fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in " +
  "culpa qui officia deserunt mollit anim id est laborum.";

const LOREM_MEDIO =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor " +
  "incididunt ut labore et dolore magna aliqua.";

const LOREM_BREVE = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

/** Un elenco di `n` voci segnaposto. */
const elencoLorem = (n: number) =>
  Array.from({ length: n }, () => ({ voce: "Label", testo: LOREM_BREVE }));

/**
 * I testi, costruiti sull'identità corrente del gruppo: è una funzione perché i
 * recapiti (`g.email`) compaiono dentro le informative.
 */
export const paginelegali = (g: Identita): PaginaLegale[] => [
  // ------------------------------------------------------------------ privacy
  {
    slug: "privacy",
    titolo: "Label",
    breve: "Label",
    sommario: LOREM_MEDIO,
    aggiornamento: AGGIORNAMENTO,
    sezioni: [
      {
        titolo: "Label",
        paragrafi: [LOREM, LOREM_MEDIO],
        nota: `${LOREM_BREVE} ${g.email}`,
      },
      {
        titolo: "Label",
        paragrafi: [LOREM_MEDIO],
        elenco: elencoLorem(4),
      },
      {
        titolo: "Label",
        elenco: elencoLorem(3),
        paragrafi: [LOREM_MEDIO],
      },
      {
        titolo: "Label",
        paragrafi: [LOREM, LOREM_MEDIO],
        nota: `${LOREM_BREVE} ${g.email}`,
      },
    ],
  },

  // ------------------------------------------------------------------- cookie
  {
    slug: "cookie",
    titolo: "Label",
    breve: "Label",
    sommario: LOREM_MEDIO,
    aggiornamento: AGGIORNAMENTO,
    sezioni: [
      {
        titolo: "Label",
        paragrafi: [LOREM],
      },
      {
        titolo: "Label",
        elenco: elencoLorem(4),
        paragrafi: [LOREM_MEDIO],
      },
      {
        titolo: "Label",
        paragrafi: [LOREM],
        nota: LOREM_MEDIO,
      },
    ],
  },

  // ------------------------------------------------------ immagini e minori
  {
    slug: "immagini-e-minori",
    titolo: "Label",
    breve: "Label",
    sommario: LOREM_MEDIO,
    aggiornamento: AGGIORNAMENTO,
    sezioni: [
      {
        titolo: "Label",
        paragrafi: [LOREM],
      },
      {
        titolo: "Label",
        elenco: elencoLorem(3),
      },
      {
        titolo: "Label",
        paragrafi: [`${LOREM_MEDIO} ${g.email}`, LOREM_MEDIO],
        nota: LOREM_MEDIO,
      },
    ],
  },

  // ------------------------------------------------------------------ diritti
  {
    slug: "diritti",
    titolo: "Label",
    breve: "Label",
    sommario: LOREM_MEDIO,
    aggiornamento: AGGIORNAMENTO,
    sezioni: [
      {
        titolo: "Label",
        elenco: elencoLorem(5),
      },
      {
        titolo: "Label",
        paragrafi: [`${LOREM} ${g.email}`, LOREM_MEDIO],
      },
      {
        titolo: "Label",
        paragrafi: [LOREM, LOREM_MEDIO],
      },
    ],
  },

  // -------------------------------------------------------------- note legali
  {
    slug: "note-legali",
    titolo: "Label",
    breve: "Label",
    sommario: LOREM_MEDIO,
    aggiornamento: AGGIORNAMENTO,
    sezioni: [
      {
        titolo: "Label",
        paragrafi: [`${LOREM_MEDIO} ${g.email}`],
      },
      {
        titolo: "Label",
        paragrafi: [LOREM, LOREM_MEDIO],
      },
      {
        titolo: "Label",
        elenco: elencoLorem(3),
      },
    ],
  },

  // ------------------------------------------------------------ accessibilità
  {
    slug: "accessibilita",
    titolo: "Label",
    breve: "Label",
    sommario: LOREM_MEDIO,
    aggiornamento: AGGIORNAMENTO,
    sezioni: [
      {
        titolo: "Label",
        paragrafi: [LOREM, LOREM_MEDIO],
      },
      {
        titolo: "Label",
        elenco: elencoLorem(4),
      },
      {
        titolo: "Label",
        elenco: elencoLorem(3),
      },
      {
        titolo: "Label",
        paragrafi: [`${LOREM_MEDIO} ${g.email}`, LOREM_MEDIO],
      },
    ],
  },
];

/**
 * Solo gli indirizzi e le etichette: bastano a `generateStaticParams` e
 * all'elenco in fondo alle pagine, senza costruire tutti i testi.
 */
export const SLUG_LEGALI: { slug: string; breve: string }[] = [
  { slug: "privacy", breve: "Label" },
  { slug: "cookie", breve: "Label" },
  { slug: "immagini-e-minori", breve: "Label" },
  { slug: "diritti", breve: "Label" },
  { slug: "note-legali", breve: "Label" },
  { slug: "accessibilita", breve: "Label" },
];

export const paginaLegalePerSlug = (slug: string, g: Identita) =>
  paginelegali(g).find((p) => p.slug === slug);
