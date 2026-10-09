import { GESTORI, HOME, UNITA } from "@/lib/data";
import { inIndirizzo } from "@/lib/contenuti";

/**
 * I posti del disegno in cui va una fotografia, e chi può metterla.
 *
 * ## Perché questo file esiste
 *
 * L'audit di produzione ha contato quarantotto riquadri rigati nelle pagine
 * pubbliche. Trenta erano posti già collegati a un caricamento — le copertine
 * degli album e delle unità — e si riempiono da soli appena qualcuno carica.
 * **Diciotto no**: erano `<Photo>` scritti nel codice, con dentro l'etichetta
 * del progetto grafico («foto fascia gialla», «ritratto», «foto d'archivio») e
 * nessun ramo `<img>` accanto. Restavano rettangoli colorati a righe per
 * sempre, qualunque cosa il gruppo caricasse — e sulla home erano tre blocchi
 * da 378×190 pixel di giallo, verde e rosso pieni, con sopra scritta la nota
 * del designer.
 *
 * Questo file è l'elenco di quei diciotto posti. Ogni riga dice dove sta il
 * riquadro, che nome ha per chi carica, che proporzione ha, e chi lo può
 * riempire.
 *
 * ## Perché in TypeScript e non in una tabella
 *
 * Un posto è una proprietà del **disegno**, non un dato del gruppo: esiste
 * perché una pagina ha un buco di quella forma. Se domani la home perde le tre
 * schede di fascia, i tre posti spariscono da qui e le righe rimaste nel
 * database si vedono — `npm run db:orfani` le nomina. Al contrario, un elenco
 * di posti nel database si sarebbe disallineato dalle pagine in silenzio.
 *
 * L'immagine caricata sta invece nella tabella `immagini`, una riga per posto.
 *
 * ## L'ambito: chi può caricare che cosa
 *
 * `gruppo` sono i posti delle pagine comuni — home e «Chi siamo» — e li tocca
 * solo un gestore. `unita` sono quelli della pagina di un'unità, e li tocca
 * il referente di quell'unità: è lo stesso ambito con cui si carica già la
 * copertina, quindi la matrice dei permessi non cambia forma.
 */

/** La proporzione consigliata, per dire a chi carica che taglio serve. */
export type Forma = "larga" | "quadrata" | "ritratto";

export interface Slot {
  /** la chiave nella tabella `immagini`. Non cambia: ci sono righe appese */
  chiave: string;
  /** come si chiama per chi carica */
  nome: string;
  /** dove si vede, detto in modo che si possa andare a guardare */
  dove: string;
  forma: Forma;
  /** `null` per i posti del gruppo; la chiave dell'unità per gli altri */
  unita: string | null;
  /**
   * Se il posto ritrae una persona.
   *
   * Serve a due cose: mostrare la riga sul consenso in interfaccia, e non
   * lasciare che un ritratto finisca fra le immagini decorative — che è la
   * scorciatoia con cui un giorno si pubblica la faccia di qualcuno che non
   * l'aveva chiesto.
   */
  persona: string | null;
}

/** Il taglio consigliato, scritto per chi carica e non per chi programma. */
export const TAGLIO: Record<Forma, string> = {
  larga: "orizzontale, circa 2:1 — una foto panoramica",
  quadrata: "quadrata o quasi",
  ritratto: "verticale o quadrata, con la persona al centro",
};

/**
 * I quattro posti della home e di «Chi siamo».
 *
 * Le chiavi portano davanti la pagina perché un giorno ce ne saranno altre, e
 * `galleria` da sola non direbbe quale galleria.
 */
const COMUNI: Slot[] = [
  {
    chiave: "home.galleria",
    nome: "Copertina della scheda «Foto»",
    dove: "Home, in fondo, la scheda scura che porta agli album",
    forma: "larga",
    unita: null,
    persona: null,
  },
  {
    chiave: "chi-siamo.gruppo",
    nome: "Fotografia di gruppo",
    dove: "Chi siamo, in cima",
    forma: "larga",
    unita: null,
    persona: null,
  },
];

/**
 * Le tre fotografie di fascia della home.
 *
 * Si ricavano da `HOME.fasce` invece di scriverle a mano: se un giorno il disegno
 * ne mostrasse quattro, il posto nuovo compare da solo nell'area riservata.
 */
const DI_FASCIA: Slot[] = HOME.fasce.map((b) => ({
  chiave: `home.fascia-${b.fascia}`,
  nome: `Fotografia della scheda «${b.titolo}»`,
  dove: "Home, le tre schede delle fasce",
  forma: "larga",
  unita: null,
  persona: null,
}));

/**
 * La fotografia d'archivio accanto alla storia di ogni unità.
 *
 * `larga` e non `quadrata`, che è come era dichiarata: il riquadro **non è
 * quadrato**. La colonna destra di `.split--storia` è larga 480 px — 1128 px
 * di griglia divisi 1,35fr + 1fr — e il riquadro è alto 240, quindi la
 * proporzione vera è 2:1. Con `object-fit: cover` un quadrato caricato
 * seguendo il vecchio suggerimento perdeva metà dell'immagine, tagliata in
 * cima e in fondo: cioè il suggerimento faceva sbagliare chi lo seguiva.
 *
 * Se un domani il riquadro torna quadrato, questa riga cambia con lui — è
 * l'unico posto in cui il taglio consigliato è scritto.
 */
const DI_ARCHIVIO: Slot[] = UNITA.map((u) => ({
  chiave: `unita.${u.chiave}.archivio`,
  nome: "Fotografia d’archivio",
  dove: `Pagina dell’unità, accanto a «La storia dell’unità»`,
  forma: "larga",
  unita: u.chiave,
  persona: null,
}));

/**
 * I ritratti: uno per ogni persona nominata sulle pagine pubbliche.
 *
 * La chiave è l'indirizzo del **nome**, non una posizione nell'elenco: se un
 * giorno i referenti di un'unità diventano due, il ritratto del primo non scivola
 * addosso al secondo. Se invece il nome cambia, il ritratto si stacca — ed è
 * quello che deve succedere, perché un nome nuovo è una persona nuova.
 */
export function ritratto(nome: string, dove: string, unita: string | null): Slot {
  return {
    chiave: `referente.${inIndirizzo(nome)}`,
    nome: `Ritratto di ${nome}`,
    dove,
    forma: "ritratto",
    unita,
    persona: nome,
  };
}

const RITRATTI: Slot[] = [
  ...GESTORI.map((p) => ritratto(p.nome, "Chi siamo, le schede dei gestori", null)),
  ...UNITA.flatMap((u) =>
    u.responsabili.map(([nome]) =>
      ritratto(nome, `Pagina dell’unità, «Chi guida l’unità quest’anno»`, u.chiave),
    ),
  ),
];

/**
 * I ritratti dei referenti **come sono adesso**, non come li consegna il codice.
 *
 * `RITRATTI` qui sopra è l'elenco dei nomi di `lib/data.ts`, e andava bene
 * finché i referenti erano quelli: da quando la sezione «Referenti» li aggiunge, li sposta
 * e li toglie, l'elenco dei posti deve seguire. Prende i responsabili in carica
 * di ogni unità (quelli che le pagine pubbliche mostrano con il ritratto) e i
 * gestori, e ne fa un posto ciascuno — con la stessa chiave di sempre, così
 * un ritratto già caricato per un nome che c'è ancora resta dov'è.
 */
export function ritrattiDei(
  unita: readonly { chiave: string; responsabili: readonly (readonly string[])[] }[],
): Slot[] {
  return [
    ...GESTORI.map((p) => ritratto(p.nome, "Chi siamo, le schede dei gestori", null)),
    ...unita.flatMap((u) =>
      u.responsabili.map(([nome]) =>
        ritratto(nome, `Pagina dell’unità, «Chi guida l’unità quest’anno»`, u.chiave),
      ),
    ),
  ];
}

/** Tutti i posti, nell'ordine in cui conviene mostrarli. */
export const SLOT: Slot[] = [...COMUNI, ...DI_FASCIA, ...DI_ARCHIVIO, ...RITRATTI];

/**
 * I posti da mostrare fra i riquadri da caricare: la copertina della scheda
 * «Foto» non ha dove stare quando gli album sono spenti (`lib/funzioni.ts`).
 */
export const conAlbum = (album: boolean) => (s: Slot) => album || s.chiave !== "home.galleria";

/** Il posto con questa chiave, se esiste. Una chiave inventata non passa di qui. */
export function slotDi(chiave: string): Slot | undefined {
  return SLOT.find((s) => s.chiave === chiave);
}

/** I posti che tocca un referente di unità: solo quelli della sua unità. */
export function slotDiUnita(unita: string): Slot[] {
  return SLOT.filter((s) => s.unita === unita);
}

/** I posti che tocca un gestore: tutti. */
export function slotDelGruppo(): Slot[] {
  return SLOT.filter((s) => s.unita === null);
}
