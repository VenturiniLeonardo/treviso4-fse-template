/** Voci del menu principale e del piede, con i nuovi indirizzi senza `.html`. */

export interface NavLink {
  href: string;
  label: string;
}

/** Le voci del menu; «Foto» solo con gli album accesi (vedi `lib/funzioni.ts`). */
export const navLinks = (album: boolean): NavLink[] => [
  { href: "/chi-siamo", label: "Label" },
  { href: "/unita", label: "Label" },
  { href: "/attivita", label: "Label" },
  ...(album ? [{ href: "/foto", label: "Label" }] : []),
  { href: "/documenti", label: "Label" },
  { href: "/contatti", label: "Label" },
];

/** Punto d'ingresso dell'area riservata. */
export const AREA_RISERVATA = "/area-riservata";

/**
 * Le stesse voci del menu, con una riga di spiegazione: servono alla pagina 404,
 * dove un elenco secco di sei parole non aiuterebbe chi si è perso.
 */
export const scorciatoie = (album: boolean): (NavLink & { testo: string })[] => [
  {
    href: "/chi-siamo",
    label: "Label",
    testo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
  {
    href: "/unita",
    label: "Label",
    testo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
  {
    href: "/attivita",
    label: "Label",
    testo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
  ...(album
    ? [
        {
          href: "/foto",
          label: "Label",
          testo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        },
      ]
    : []),
  {
    href: "/documenti",
    label: "Label",
    testo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
  {
    href: "/contatti",
    label: "Label",
    testo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  },
];

/**
 * I collegamenti fuori dal sito, tutti in un posto solo. **Una stringa vuota
 * vuol dire «non c'è», e il piede non stampa la voce.**
 *
 * Cinque di questi sei erano la pagina iniziale del servizio invece di quella
 * del gruppo: «Instagram del gruppo» portava alla schermata d'accesso di
 * Instagram, «Distretto» e «Riviste» tutti e due alla home del sito
 * nazionale. Un collegamento che promette una cosa e ne apre un'altra è peggio di
 * un collegamento che non c'è: il primo lo si scopre solo cliccando, il
 * secondo si vede subito che manca.
 *
 * Non vanno indovinati: un gruppo nuovo può non avere ancora i suoi profili, e
 * scrivere un indirizzo
 * plausibile avrebbe voluto dire mandare le famiglie sul profilo di qualcun
 * altro. Si riempiono qui, quando ci sono, e il piede li rimette da sé.
 */
export const ESTERNI = {
  /** il sito di riferimento nazionale, se c'è */
  nazionale: "",
  /**
   * Le riviste dell'associazione, una per fascia e una per i referenti: va
   * l'indirizzo del portale che le raccoglie tutte, non quello di una sola.
   */
  riviste: "",
  /**
   * la pagina del distretto del gruppo — servono il nome e l'indirizzo.
   */
  distretto: "",
  /** il profilo Instagram del gruppo */
  instagram: "",
  /**
   * la pagina Facebook del gruppo: se la pagina non ha un nome utente,
   * l’indirizzo lungo con il numero
   */
  facebook: "",
  /** il canale YouTube del gruppo */
  youtube: "",
} as const;

/**
 * I profili del gruppo, per le pastiglie del piede e per le righe della pagina
 * Contatti. `profilo` è il nome con cui il gruppo compare dentro il servizio —
 * quello che si cerca nell'app, e quindi quello che serve leggere: un indirizzo
 * lungo con dentro un numero non lo ricopia nessuno.
 *
 * Stessa regola di `ESTERNI`: si stampano solo quelli che hanno un indirizzo.
 */
export const SOCIAL = (
  [
    { href: ESTERNI.instagram, sigla: "IG", nome: "Instagram", profilo: "@label" },
    { href: ESTERNI.facebook, sigla: "FB", nome: "Facebook", profilo: "Label" },
    { href: ESTERNI.youtube, sigla: "YT", nome: "YouTube", profilo: "" },
  ] as const
).filter((s) => s.href);

/**
 * Pagine legali linkate nel piede. Nel mockup puntavano tutte a `#`; adesso
 * sono pagine vere sotto `/legale`, con i testi in `lib/legale.ts`. L'ordine è
 * quello del mockup, per non spostare il disegno del piede.
 *
 * «Preferenze cookie» è l'unica che non nasce da `PAGINE_LEGALI`: è un pannello
 * con dei comandi, non un testo, e sta in una rotta sua.
 */
export const LINK_LEGALI: NavLink[] = [
  { href: "/legale/privacy", label: "Label" },
  { href: "/legale/cookie", label: "Label" },
  { href: "/legale/preferenze-cookie", label: "Label" },
  { href: "/legale/immagini-e-minori", label: "Label" },
  { href: "/legale/diritti", label: "Label" },
  { href: "/legale/note-legali", label: "Label" },
  { href: "/legale/accessibilita", label: "Label" },
];
