/**
 * Contenuti del sito del gruppo.
 *
 * Tutto quello che si legge qui è **segnaposto**: «Label» per i testi brevi e
 * Lorem ipsum per quelli lunghi. Servono a far vedere il sito pieno appena lo
 * si avvia; chi lo usa li sostituisce con i propri, qui o dall'area riservata.
 *
 * Questi valori sono il **seme**: quando il database è vuoto, il sito li
 * scrive nelle sue tabelle e da lì in poi legge il database. Correggere questo
 * file non cambia un database già seminato: i testi si cambiano dall'area
 * riservata.
 *
 * Un campo vuoto la pagina lo salta: meglio una riga in meno che un recapito
 * inventato. Telefono e codice fiscale, per esempio, sono vuoti apposta.
 */

// --------------------------------------------------------------------------
// Dati del gruppo
// --------------------------------------------------------------------------

export const GRUPPO = {
  nome: "Label",
  sottotitolo: "Label",
  indirizzo: "Label",
  citta: "Label",
  /**
   * Coordinate della sede, per il collegamento a Google Maps: più precise di
   * una ricerca per indirizzo. Queste sono di esempio (Roma, piazza Venezia).
   */
  coordinate: "41.9028,12.4964",
  /** L'unico indirizzo email che il sito pubblica. */
  email: "segreteria@example.org",
  /*
   * Telefono e codice fiscale: vuoti, e le pagine li saltano. Un recapito
   * inventato è peggio di un recapito assente. Il telefono si mette dall'area
   * riservata, in «Dati del gruppo»; il codice fiscale qui, insieme ai testi
   * legali che aspettano l'approvazione dei gestori.
   */
  telefonoGestori: "",
  codiceFiscale: "",
  /**
   * Quando i gestori hanno approvato i testi legali. Vuoto = non ancora.
   *
   * Finché questa riga è vuota, le informative portano in cima il riquadro
   * «Bozza da approvare». **Non è un interruttore per far sparire un avviso**:
   * è la data che quelle pagine dichiarano come ultimo aggiornamento. Il
   * riquadro sparisce solo quando ci sono sia questa data sia il codice
   * fiscale — vedi `legaleApprovato()` in `lib/legale.ts`.
   *
   * Si scrive come si vuole leggere: «settembre 2026», o una data per esteso.
   */
  legaleApprovatoIl: "",
  annoCopyright: "2026",
} as const;

/** Numero di telefono nella forma accettata da href="tel:". */
export const tel = (numero: string) => numero.replace(/\s/g, "");

// --------------------------------------------------------------------------
// Le fasce, con i colori usati in tutto il sito
// --------------------------------------------------------------------------

export type FasciaKey = "gialla" | "verde" | "rossa" | "gruppo";

export interface Fascia {
  label: string;
  /** colore pieno della fascia */
  colore: string;
  /** testo leggibile sopra il colore */
  inchiostro: string;
  /** testo del colore su fondo chiaro */
  accento: string;
  /** lo stesso testo su fondo scuro: il tema scuro dell'area riservata */
  accentoScuro: string;
  /** versione scura per i segnaposto foto */
  tinta: string;
}

export const FASCE: Record<FasciaKey, Fascia> = {
  gialla: {
    label: "Label",
    colore: "#ffcc00",
    inchiostro: "#002144",
    accento: "#7a5c00",
    accentoScuro: "#e6c35a",
    tinta: "#b38f00",
  },
  verde: {
    label: "Label",
    colore: "#006633",
    inchiostro: "#ffffff",
    accento: "#00512a",
    accentoScuro: "#7fcf9c",
    tinta: "#00512a",
  },
  rossa: {
    label: "Label",
    colore: "#a5342c",
    inchiostro: "#ffffff",
    accento: "#8c2b24",
    accentoScuro: "#f2a097",
    tinta: "#8c2b24",
  },
  gruppo: {
    label: "Label",
    colore: "#003366",
    inchiostro: "#ffffff",
    accento: "#003366",
    accentoScuro: "#8fb6ec",
    tinta: "#003366",
  },
};

export const fascia = (chiave: FasciaKey): Fascia => FASCE[chiave];

/**
 * Le introduzioni delle pagine che non passano dal database.
 *
 * Home e Chi siamo hanno i loro testi in `HOME` e `CHI_SIAMO`, e i referenti li
 * cambiano da «Testi delle pagine». Queste cinque no: sono la riga sotto il
 * titolo di Unità, Attività, Foto, Documenti e Contatti, che nel progetto
 * grafico erano cinque «Lorem ipsum» e che stavano scritte a mano dentro
 * altrettanti file di rotta. Riunite qui perché sono contenuto, e il contenuto
 * di questo sito sta in questo file — non sparso fra i componenti.
 */
export const INTRO = {
  unita:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  attivita:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  foto:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  documenti:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  contatti:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
} as const;

// --------------------------------------------------------------------------
// Le unità
// --------------------------------------------------------------------------

/** Chiave usata dai filtri di Attività e Foto. */
export type UnitaKey =
  | "gruppo"
  | "u1"
  | "u2"
  | "u3"
  | "u4"
  | "u5"
  | "u6";

export interface Unita {
  /** indirizzo della pagina: /unita/<slug> */
  slug: string;
  chiave: UnitaKey;
  nome: string;
  ramo: string;
  ramoPlurale: string;
  eta: string;
  fascia: FasciaKey;
  logo: string;
  /**
   * Quanti sono, se il gestore l'ha scritto in «Anagrafica»; zero vuol dire
   * «non indicato», e le pagine pubbliche non stampano il numero.
   *
   * Il predefinito è zero per tutte e sei.
   */
  iscritti: number;
  iscrittiLabel: string;
  /*
   * Niente `email`: le unità non ne pubblicano una propria. Si scrive
   * all'indirizzo ufficiale del gruppo (`GRUPPO.email`), l'unico che il sito
   * mostra. La colonna `unita.email` resta in tabella, e non la legge nessuno.
   */
  telefono: string;
  referente: string;
  ruoloReferente: string;
  fondazione: string;
  ritrovo: string;
  motto: string;
  occhiello: string;
  /**
   * Sigla con cui l'unità compare nella causale del tesseramento: «U1» per
   * l'unità 1, «U2» per l'unità 2, e così via. Facoltativa perché è un dato
   * d'archivio: le unità di cui non lo sappiamo non la mostrano.
   */
  sigla?: string;
  /**
   * Due righe su che cosa si fa nell'unità, per chi non la conosce: stanno in
   * cima alla pagina, prima della storia. Facoltativa — senza, la pagina parte
   * dalla storia come prima.
   */
  presentazione?: string;
  storia: string[];
  /**
   * Titolo della sezione «La storia dell'unità». Facoltativo: senza, la pagina
   * usa il titolo segnaposto del mockup, che è quello che serve alle unità i
   * cui testi sono ancora da scrivere.
   */
  storiaTitolo?: string;
  /**
   * Didascalia sotto la tabella dei responsabili passati — per esempio da dove
   * vengono i nomi, o perché su certe righe manca l'anno.
   *
   * Facoltativa, e **senza valore predefinito**: la scrivono i referenti dall'area
   * riservata, e se non l'hanno scritta la riga non compare. Il predefinito
   * c'era e diceva al visitatore che i nomi erano ancora segnaposto: una nota
   * sullo stato dei lavori, che è una cosa da registro di sviluppo e non da
   * pagina pubblica.
   */
  notaStorico?: string;
  /**
   * La fotografia di copertina, se un gestore l'ha caricata.
   *
   * Facoltativa, e **nessuna unità di `UNITA` la valorizza**: l'assenza è il
   * caso normale, e vuol dire che la pagina mostra il segnaposto a righe del
   * mockup con la misura consigliata scritta sopra. La riempie
   * `lib/unita-store.ts` dalle quattro colonne di `unita`, come
   * `lib/identita.ts` fa con il marchio del gruppo.
   *
   * Le misure ci sono perché servono a `width` e `height` sull'`img`: senza,
   * l'immagine non riserva il suo spazio e la pagina sobbalza al caricamento —
   * la soglia CLS di §04.
   */
  copertina?: { src: string; larghezza: number; altezza: number };
  /**
   * La copertina nascosta, al posto di `copertina`: il file resta, il sito
   * mostra il segnaposto, e l'area la fa vedere — da `/in-attesa/`, dietro il
   * cancello — a chi la può rimettere o eliminare. Dal 6 ottobre 2026.
   */
  copertinaNascosta?: { src: string; larghezza: number; altezza: number };
  /** nome, ruolo, dal */
  responsabili: [string, string, string][];
  /** anni, nome, nota */
  storico: [string, string, string][];
  /** nome, ruolo */
  staff: [string, string][];
}

/**
 * Il referente in carica, per le unità di cui l'archivio dà i nomi veri.
 *
 * È l'**ultima** voce dello storico: l'archivio elenca i referenti in ordine di
 * successione, quindi in fondo c'è chi guida oggi. Prima di questa funzione la
 * scheda «Chi guida l'unità quest'anno» diceva «Nome Cognome» mentre due righe
 * sotto, nello storico, il nome vero c'era: la stessa persona, scritta in due
 * modi diversi nella stessa pagina.
 *
 * `dal` resta vuoto quando l'archivio non dà l'anno — che è quasi sempre.
 * Meglio una riga in meno che un anno inventato.
 */
const referenteInCarica = (nome: string, ruolo = "Referente di unità", dal = ""): Unita["responsabili"] => [
  [nome, ruolo, dal],
];

export const UNITA: Unita[] = [
  {
    slug: "unita-1",
    chiave: "u1",
    nome: "Label 1",
    ramo: "Label",
    ramoPlurale: "Label",
    eta: "Label",
    fascia: "gialla",
    logo: "logo-u1.png",
    iscritti: 0,
    iscrittiLabel: "0 iscritti",
    telefono: "",
    referente: "Nome 1",
    ruoloReferente: "Label",
    fondazione: "Label",
    ritrovo: "Label",
    motto: "Label",
    occhiello: "Label",
    presentazione:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    storia: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    ],
    storiaTitolo: "Label",
    responsabili: referenteInCarica("Nome 1", "Label"),
    storico: [
      ["2000", "Label", "Lorem ipsum dolor sit amet."],
      ["2015", "Nome 1", ""],
    ],
    staff: [["Nome 1", "Label"]],
  },
  {
    slug: "unita-2",
    chiave: "u2",
    nome: "Label 2",
    ramo: "Label",
    ramoPlurale: "Label",
    eta: "Label",
    fascia: "gialla",
    logo: "logo-u2.png",
    iscritti: 0,
    iscrittiLabel: "0 iscritte",
    telefono: "",
    referente: "Nome 2",
    ruoloReferente: "Label",
    fondazione: "Label",
    ritrovo: "Label",
    motto: "Label",
    occhiello: "Label",
    presentazione:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    storia: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    ],
    storiaTitolo: "Label",
    responsabili: referenteInCarica("Nome 2", "Label"),
    storico: [
      ["2000", "Label", "Lorem ipsum dolor sit amet."],
      ["2015", "Nome 2", ""],
    ],
    staff: [["Nome 2", "Label"]],
  },
  {
    slug: "unita-3",
    chiave: "u3",
    nome: "Label 3",
    ramo: "Label",
    ramoPlurale: "Label",
    eta: "Label",
    fascia: "verde",
    logo: "logo-u3.png",
    iscritti: 0,
    iscrittiLabel: "0 iscritti",
    telefono: "",
    referente: "Nome 3",
    ruoloReferente: "Label",
    fondazione: "Label",
    ritrovo: "Label",
    motto: "Label",
    occhiello: "Label",
    storia: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    ],
    storiaTitolo: "Label",
    responsabili: referenteInCarica("Nome 3", "Label"),
    storico: [
      ["2000", "Label", "Lorem ipsum dolor sit amet."],
      ["2015", "Nome 3", ""],
    ],
    staff: [["Nome 3", "Label"]],
  },
  {
    slug: "unita-4",
    chiave: "u4",
    nome: "Label 4",
    ramo: "Label",
    ramoPlurale: "Label",
    eta: "Label",
    fascia: "verde",
    logo: "logo-u4.png",
    iscritti: 0,
    iscrittiLabel: "0 iscritte",
    telefono: "",
    referente: "Nome 4",
    ruoloReferente: "Label",
    /*
     * Fondazione e storico vuoti: la pagina salta la riga «Fondazione» e la
     * tabella dei responsabili passati. Fa vedere come si presenta un'unità
     * senza storia.
     */
    fondazione: "",
    ritrovo: "Label",
    motto: "Label",
    occhiello: "Label",
    storia: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    ],
    storiaTitolo: "Label",
    responsabili: referenteInCarica("Nome 4", "Label"),
    storico: [],
    staff: [["Nome 4", "Label"]],
  },
  {
    slug: "unita-5",
    chiave: "u5",
    nome: "Label 5",
    ramo: "Label",
    ramoPlurale: "Label",
    eta: "Label",
    fascia: "rossa",
    logo: "logo-u5.png",
    iscritti: 0,
    iscrittiLabel: "0 iscritti",
    telefono: "",
    referente: "Nome 5",
    ruoloReferente: "Label",
    fondazione: "Label",
    ritrovo: "Label",
    motto: "Label",
    occhiello: "Label",
    storia: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    ],
    storiaTitolo: "Label",
    responsabili: referenteInCarica("Nome 5", "Label"),
    storico: [
      ["2000", "Label", "Lorem ipsum dolor sit amet."],
      ["2015", "Nome 5", ""],
    ],
    staff: [["Nome 5", "Label"]],
  },
  {
    slug: "unita-6",
    chiave: "u6",
    nome: "Label 6",
    ramo: "Label",
    ramoPlurale: "Label",
    eta: "Label",
    fascia: "rossa",
    logo: "logo-u6.png",
    iscritti: 0,
    iscrittiLabel: "0 iscritte",
    telefono: "",
    referente: "Nome 6",
    ruoloReferente: "Label",
    fondazione: "Label",
    ritrovo: "Label",
    motto: "Label",
    occhiello: "Label",
    storia: [
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    ],
    storiaTitolo: "Label",
    responsabili: referenteInCarica("Nome 6", "Label"),
    storico: [
      ["2000", "Label", "Lorem ipsum dolor sit amet."],
      ["2015", "Nome 6", ""],
    ],
    staff: [["Nome 6", "Label"]],
  },
];

/**
 * Il nome del referente, senza il soprannome.
 *
 * `referente` può portare le due cose insieme — «Ref1 — Mario Rossi» — perché
 * in alcune unità il soprannome è parte di come si chiama il referente.
 * Dove accanto c'è già la carica, però, ripeterlo fa leggere «Ref1 — Mario
 * Rossi» con sotto «Ref1»: due volte la stessa parola, che sembra un
 * errore di compilazione della scheda. Le pagine che stampano nome **e** ruolo
 * usano questa, e il soprannome lo dice la riga del ruolo.
 *
 * Era la stessa espressione scritta a mano nell'eroe dell'unità; sta qui perché
 * adesso la usano due pagine, e due copie divergono al primo referente che scrive il
 * suo nome con un trattino diverso.
 */
export const nomeReferente = (referente: string): string => referente.split("—").pop()!.trim();

export const unitaPerSlug = (slug: string): Unita | undefined =>
  UNITA.find((u) => u.slug === slug);

/** L'unità dalla chiave di ambito della sessione (`u1`, `u4`, …). */
export const unitaPerChiave = (chiave: string): Unita | undefined =>
  UNITA.find((u) => u.chiave === chiave);

/** Filtri usati da Attività e Foto: chiave → etichetta e fascia di riferimento. */
export const FILTRI_UNITA: { chiave: UnitaKey; label: string; fascia: FasciaKey }[] = [
  { chiave: "gruppo", label: "Label", fascia: "gruppo" },
  { chiave: "u1", label: "Label", fascia: "gialla" },
  { chiave: "u2", label: "Label", fascia: "gialla" },
  { chiave: "u3", label: "Label", fascia: "verde" },
  { chiave: "u4", label: "Label", fascia: "verde" },
  { chiave: "u5", label: "Label", fascia: "rossa" },
  { chiave: "u6", label: "Label", fascia: "rossa" },
];

export const TUTTE_LE_UNITA: UnitaKey[] = FILTRI_UNITA.map((f) => f.chiave);

const fasciaPerChiave = new Map(FILTRI_UNITA.map((f) => [f.chiave, f.fascia]));
const labelPerChiave = new Map(FILTRI_UNITA.map((f) => [f.chiave, f.label]));

export const fasciaDiUnita = (chiave: UnitaKey): Fascia =>
  FASCE[fasciaPerChiave.get(chiave) ?? "gruppo"];
export const labelDiUnita = (chiave: UnitaKey): string =>
  labelPerChiave.get(chiave) ?? chiave;

// --------------------------------------------------------------------------
// Home
// --------------------------------------------------------------------------

export const HOME = {
  occhiello: "Label",
  /** l'interruzione di riga è voluta: fa parte del disegno del titolo */
  titolo: ["Lorem ipsum dolor", "sit amet."],
  titoloTesto: "Lorem ipsum dolor sit amet.",
  intro:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  info: [
    /* la prima scheda mostra la sede presa dai Dati del gruppo: vedi la home */
    { kicker: "Label", valore: "Label", azione: "Label →", href: "/contatti" },
    { kicker: "Label", valore: "Label", azione: "Label", href: null },
    { kicker: "Label", valore: "Lorem ipsum dolor sit amet", azione: "Label →", href: "/unita" },
  ] as { kicker: string; valore: string; azione: string; href: string | null }[],
  chiSiamoTitolo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  chiSiamoTesti: [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  ],
  citazione: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  citazioneAutore: "Label",
  /*
   * I contatori della home: vuoti, e la home salta la fascia. Quattro voci,
   * come le prevede il disegno.
   */
  contatori: [] as { valore: number; label: string; sub: string; alt: boolean }[],
  fasce: [
    {
      fascia: "gialla" as FasciaKey,
      titolo: "Label 1",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      eta: "Label",
    },
    {
      fascia: "verde" as FasciaKey,
      titolo: "Label 2",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      eta: "Label",
    },
    {
      fascia: "rossa" as FasciaKey,
      titolo: "Label 3",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      eta: "Label",
    },
  ],
  cosaFacciamo: [
    {
      num: "01",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      num: "02",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      num: "03",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      num: "04",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
  ],
};

// --------------------------------------------------------------------------
// Chi siamo
// --------------------------------------------------------------------------

/** Chi guida il gruppo: gestori e altre figure di riferimento. */
export interface Gestore {
  nome: string;
  ruolo: string;
  /**
   * Accende l'arancione (`--orange`), che è il colore con cui il gestore si
   * identifica. È un campo e non un confronto su `ruolo` perché il giorno che
   * la dicitura cambia — «Gestori» al plurale, o altro — un confronto di
   * stringhe smetterebbe di funzionare in silenzio. Le altre figure non ce
   * l'hanno: quel colore non è loro.
   */
  gestore?: boolean;
}

export const GESTORI: Gestore[] = [
  { nome: "Nome 7", ruolo: "Label", gestore: true },
  { nome: "Nome 8", ruolo: "Label" },
];

export const CHI_SIAMO = {
  titolo: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  sommario:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.",
  testi: [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  ],
  schede: [
    { kicker: "Label", valore: "Label", navy: false },
    { kicker: "Label", valore: "Label", navy: true },
  ],
  pilastri: [
    {
      colore: "#003366",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      colore: "#006633",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      colore: "#ffcc00",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      colore: "#a5342c",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
  ],
  /**
   * Le tappe della storia, dalla più vecchia. Si aggiungono man mano, con la
   * data vera.
   */
  storia: [
    {
      anno: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      first: true,
    },
  ],
  fasce: [
    {
      chiave: "gialla" as FasciaKey,
      kicker: "Label",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      chiave: "verde" as FasciaKey,
      kicker: "Label",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
    {
      chiave: "rossa" as FasciaKey,
      kicker: "Label",
      titolo: "Label",
      testo:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    },
  ],
  gestori: GESTORI,
};

/** I gradini della scala della pagina /unita, dall'alto: la fascia rossa in cima, la gialla in fondo. */
export const ORGANIGRAMMA: {
  fascia: FasciaKey;
  titolo: string;
  eta: string;
  slug: string[];
}[] = [
  { fascia: "rossa", titolo: "Label", eta: "Label", slug: ["unita-5", "unita-6"] },
  { fascia: "verde", titolo: "Label", eta: "Label", slug: ["unita-3", "unita-4"] },
  { fascia: "gialla", titolo: "Label", eta: "Label", slug: ["unita-1", "unita-2"] },
];

// --------------------------------------------------------------------------
// Attività / calendario
// --------------------------------------------------------------------------

export const MESI_ORDINE = [
  "Settembre", "Ottobre", "Novembre", "Dicembre", "Gennaio", "Febbraio",
  "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto",
];

export interface Evento {
  giorno: number;
  dow: string;
  mese: string;
  anno: number;
  titolo: string;
  tipo: string;
  unita: UnitaKey[];
  nota: string;
  luogo: string;
  durata: string;
}

/**
 * Il seme del calendario: vuoto, di proposito.
 *
 * Qui c'erano diciannove attività dell'anno 2026–2027 — date, luoghi, durate —
 * scritte per far vedere il disegno del calendario, non prese dal programma
 * vero. Tolte prima della messa in linea (23 settembre 2026): su un sito vero,
 * una famiglia che legge «Uscita, 17 gennaio, in montagna» se lo segna. Le
 * attività le inseriscono i referenti dall'area riservata, e finché non ce ne sono
 * la pagina lo dice.
 */
export const EVENTI: Evento[] = [];

/**
 * Chiavi di filtro di un evento: "gruppo" implica tutte le unità, così una
 * data di gruppo resta visibile qualunque unità si scelga.
 */
export const chiaviEvento = (e: Evento): UnitaKey[] => {
  const keys = new Set<UnitaKey>(e.unita);
  if (keys.has("gruppo")) TUTTE_LE_UNITA.forEach((k) => keys.add(k));
  return [...keys].sort();
};

// --------------------------------------------------------------------------
// Foto
// --------------------------------------------------------------------------

export interface Album {
  /** indirizzo della pagina: /foto/<slug> */
  slug: string;
  /** anno sociale */
  anno: string;
  unita: UnitaKey;
  titolo: string;
  data: string;
  foto: number;
  /** riga di presentazione in cima alla pagina dell'album */
  sottotitolo: string;
  /** etichetta larga, per l'album in evidenza in cima alla galleria */
  tag: string;
}

/**
 * Il seme degli album: vuoto, di proposito.
 *
 * C'erano dodici album di eventi immaginati per il mockup, con il numero di
 * fotografie scritto a mano. Tolti prima della messa in linea (23 settembre
 * 2026): gli album li creano i referenti dall'area riservata, ciascuno con la sua
 * password.
 */
export const ALBUM: Album[] = [];

// --------------------------------------------------------------------------
// Documenti
// --------------------------------------------------------------------------

export interface AnnoDoc {
  chiave: string;
  label: string;
  corrente: boolean;
  nota: string;
}

export const ANNI_DOC: AnnoDoc[] = [
  { chiave: "2026-2027", label: "2026 – 2027", corrente: true, nota: "Label" },
  { chiave: "2025-2026", label: "2025 – 2026", corrente: false, nota: "Label" },
  { chiave: "2024-2025", label: "2024 – 2025", corrente: false, nota: "Label" },
  { chiave: "2023-2024", label: "2023 – 2024", corrente: false, nota: "Label" },
];

/**
 * Le cartelle **di partenza** della pagina Documenti.
 *
 * Fino alla migrazione 0012 erano l'elenco chiuso delle categorie, ripetuto in
 * un `CHECK` del database. Adesso le cartelle stanno nella tabella `cartelle` e
 * le decidono i gestori — «Tesseramenti», «Campi estivi» — e questo elenco fa
 * due cose sole:
 *
 * - è ciò che la migrazione ha scritto in tabella, con queste chiavi e questi
 *   nomi. **Correggere un nome qui non cambia un database esistente**: si
 *   rinomina dall'area riservata;
 * - è il ripiego quando il database non c'è, cioè in compilazione, e la lista
 *   degli indirizzi `/documenti/<chiave>` prerenderizzati.
 *
 * Le sei non si possono eliminare: sono quelle a cui il codice rimanda (il
 * piede del sito punta a statuti e quote, il `CHECK` delle circolari alla sua).
 * Si rinominano e si riordinano come le altre.
 */
export const CATEGORIE_DOC: { chiave: string; label: string }[] = [
  { chiave: "iscrizioni", label: "Label 1" },
  { chiave: "autorizzazioni", label: "Label 2" },
  { chiave: "campi", label: "Label 3" },
  { chiave: "quote", label: "Label 4" },
  { chiave: "statuti", label: "Label 5" },
  /**
   * Le circolari, aggiunte nella fase 14.7.
   *
   * È l'unica categoria **di un'unità**: le altre valgono per tutto il gruppo,
   * e il `CHECK` `documenti_circolari_hanno_unita` lega le due cose — una
   * circolare ha un'unità, gli altri documenti no. Sta in fondo perché l'ordine
   * di questo elenco è quello con cui le cartelle sono nate, e le circolari
   * interessano le famiglie di una sola unità.
   */
  { chiave: "circolari", label: "Label 6" },
];

export interface Documento {
  anno: string;
  categoria: string;
  titolo: string;
  nota: string;
  formato: "PDF" | "DOCX";
  peso: string;
  aggiornamento: string;
}

/**
 * Il seme della modulistica: vuoto, di proposito.
 *
 * C'erano venticinque voci — moduli, quote, rendiconti di quattro anni — con
 * peso e data di aggiornamento inventati e nessun file dietro. Tolte prima
 * della messa in linea (23 settembre 2026): una voce «Quote associative» che
 * non scarica niente è peggio di una pagina che dice che i moduli arrivano. I
 * documenti li caricano i gestori dall'area riservata.
 */
export const DOCUMENTI: Documento[] = [];

// --------------------------------------------------------------------------
// Contatti
// --------------------------------------------------------------------------

export interface Faq {
  colore: string;
  domanda: string;
  /** la risposta può contenere un collegamento: si rende come nodo React */
  risposta: string;
  /** eventuale collegamento in coda alla risposta */
  link?: { testo: string; href: string; coda: string };
}

/**
 * Le domande frequenti di partenza: i gestori le cambiano da «Domande
 * frequenti», e questo elenco vale finché la tabella `faq` è vuota.
 *
 * Vanno scritte sulle fonti ufficiali dell'organizzazione: niente impegni che
 * quelle fonti non prendono.
 */
export const FAQ: Faq[] = [
  {
    colore: "#ffcc00",
    domanda: "Lorem ipsum dolor sit amet, consectetur adipiscing elit?",
    risposta:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  {
    colore: "#006633",
    domanda: "Lorem ipsum dolor sit amet, consectetur adipiscing elit?",
    risposta:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  {
    colore: "#006633",
    domanda: "Lorem ipsum dolor sit amet, consectetur adipiscing elit?",
    risposta:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  {
    colore: "#002144",
    domanda: "Lorem ipsum dolor sit amet, consectetur adipiscing elit?",
    risposta:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
      "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  },
  {
    colore: "#a5342c",
    domanda: "Lorem ipsum dolor sit amet, consectetur adipiscing elit?",
    risposta:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Vedi la pagina ",
    link: { testo: "Label", href: "/documenti", coda: "." },
  },
];

export const MOTIVI_CONTATTO: { chiave: string; label: string }[] = [
  { chiave: "iscrizione", label: "Label 1" },
  { chiave: "informazioni", label: "Label 2" },
  { chiave: "quote", label: "Label 3" },
  { chiave: "referenti", label: "Label 4" },
  { chiave: "privacy", label: "Label 5" },
  { chiave: "altro", label: "Label 6" },
];
