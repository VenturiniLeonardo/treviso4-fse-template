/**
 * I testi delle pagine pubbliche che i gestori possono cambiare.
 *
 * Gemello di `lib/unita-contenuti.ts` per le due pagine editoriali del sito,
 * Home e Chi siamo. Qui non si tocca il disco: tipi, catalogo e le due funzioni
 * pure dei paragrafi, che si riusano da là.
 *
 * ## Che cosa è modificabile, e che cosa no
 *
 * **Le parole, non la griglia.** Sono modificabili i testi che si leggono come
 * testi: l'occhiello, il titolo, l'introduzione, i paragrafi, la citazione. Non
 * lo sono i blocchi strutturati — le tre fasce, i quattro pilastri, i quattro
 * «cosa facciamo», i contatori, le schede, la storia.
 *
 * Il motivo non è pigrizia. Quei blocchi sono **griglie di disegno**: tre
 * colonne di fascia con tre colori, quattro riquadri numerati da 01 a 04,
 * quattro contatori che stanno su una riga. Un modulo che permette di averne
 * cinque, o tre, non produce un contenuto diverso — produce una pagina rotta. E
 * i loro testi sono legati a un colore e a un numero che non sono contenuto ma
 * layout: renderli modificabili significherebbe far scegliere a un gestore
 * il colore della fascia gialla.
 *
 * Restano quindi in `lib/data.ts`, dove si correggono con un rilascio — che per
 * una griglia disegnata una volta è la frequenza giusta.
 *
 * ## Le FAQ non ci sono, e vanno decise
 *
 * `FAQ` è un elenco di domande e risposte: sarebbe modificabile, e avrebbe senso
 * che lo fosse. Non è qui perché serve un editor di elenco — il terzo, dopo
 * quello delle persone e quello delle attività — e perché nella conversazione in
 * cui è stato deciso «Home e chi siamo» le FAQ non sono state confermate. È una
 * cosa da chiedere, non da dare per scontata.
 */

import { CHI_SIAMO, HOME } from "@/lib/data";

export type CampoPagina =
  // Home
  | "home.occhiello"
  | "home.titolo"
  | "home.intro"
  | "home.chiSiamoTitolo"
  | "home.chiSiamoTesti"
  | "home.citazione"
  | "home.citazioneAutore"
  // Chi siamo
  | "chi-siamo.titolo"
  | "chi-siamo.sommario"
  | "chi-siamo.testi";

export interface DefinizionePagina {
  chiave: CampoPagina;
  label: string;
  /**
   * `righe` è il caso del titolo della home, e merita una riga di spiegazione:
   * quel titolo va a capo in un punto preciso — «La strada comincia / dietro
   * l'angolo.» — e l'interruzione **fa parte del disegno**. Non è un paragrafo
   * e non è una riga sola: è un testo di due righe, e si scrive in una casella
   * dove ogni riga è una riga.
   */
  tipo: "riga" | "righe" | "paragrafi";
  hint: string;
  max: number;
}

/** Il gruppo in cui il campo compare nel modulo. */
export const GRUPPI_PAGINE = [
  { chiave: "home", titolo: "Home", pagina: "/" },
  { chiave: "chi-siamo", titolo: "Chi siamo", pagina: "/chi-siamo" },
] as const;

export const CAMPI_PAGINE: DefinizionePagina[] = [
  {
    chiave: "home.occhiello",
    label: "Riga sopra il titolo",
    tipo: "riga",
    hint: "La riga piccola in cima alla home: «Label · Esempio».",
    max: 80,
  },
  {
    chiave: "home.titolo",
    label: "Titolo della home",
    tipo: "righe",
    hint:
      "Scrivete ogni riga del titolo su una riga distinta. " +
      "Al massimo tre righe, altrimenti il titolo esce dal riquadro giallo.",
    max: 160,
  },
  {
    chiave: "home.intro",
    label: "Testo introduttivo",
    tipo: "paragrafi",
    hint: "Sotto il titolo. Una o due frasi: è la prima cosa che legge chi arriva.",
    max: 400,
  },
  {
    chiave: "home.chiSiamoTitolo",
    label: "Titolo del blocco «Chi siamo»",
    tipo: "riga",
    hint: "A metà pagina, sopra i due paragrafi di presentazione.",
    max: 160,
  },
  {
    chiave: "home.chiSiamoTesti",
    label: "Presentazione nella home",
    tipo: "paragrafi",
    hint: "Due paragrafi, separati da una riga vuota. Il testo lungo sta in «Chi siamo».",
    max: 2000,
  },
  {
    chiave: "home.citazione",
    label: "Citazione",
    tipo: "riga",
    hint: "La frase nel riquadro scuro. Senza virgolette: le mette il disegno.",
    max: 300,
  },
  {
    chiave: "home.citazioneAutore",
    label: "Chi l’ha detta",
    tipo: "riga",
    hint: "Per esempio «Mario Rossi».",
    max: 80,
  },
  {
    chiave: "chi-siamo.titolo",
    label: "Titolo della pagina",
    tipo: "riga",
    hint: "In cima a «Chi siamo».",
    max: 200,
  },
  {
    chiave: "chi-siamo.sommario",
    label: "Sommario",
    tipo: "paragrafi",
    hint: "Il paragrafo grande sotto il titolo.",
    max: 600,
  },
  {
    chiave: "chi-siamo.testi",
    label: "Chi siamo — il testo",
    tipo: "paragrafi",
    hint:
      "Il racconto del gruppo, in paragrafi separati da una riga vuota. " +
      "È il posto dove la storia del sito si scrive per esteso.",
    max: 6000,
  },
];

const PER_CHIAVE = new Map(CAMPI_PAGINE.map((c) => [c.chiave, c]));

export const campoPagina = (chiave: string): DefinizionePagina | undefined =>
  PER_CHIAVE.get(chiave as CampoPagina);

/**
 * I valori predefiniti, da `lib/data.ts`.
 *
 * Nella forma **testuale** che il modulo mostra: un array di paragrafi diventa
 * un testo con le righe vuote in mezzo, l'array del titolo diventa un testo con
 * i ritorni a capo. La conversione inversa la fa lo store quando salva.
 */
export function predefinitoDi(chiave: CampoPagina): string {
  switch (chiave) {
    case "home.occhiello":
      return HOME.occhiello;
    case "home.titolo":
      return HOME.titolo.join("\n");
    case "home.intro":
      return HOME.intro;
    case "home.chiSiamoTitolo":
      return HOME.chiSiamoTitolo;
    case "home.chiSiamoTesti":
      return HOME.chiSiamoTesti.join("\n\n");
    case "home.citazione":
      return HOME.citazione;
    case "home.citazioneAutore":
      return HOME.citazioneAutore;
    case "chi-siamo.titolo":
      return CHI_SIAMO.titolo;
    case "chi-siamo.sommario":
      return CHI_SIAMO.sommario;
    case "chi-siamo.testi":
      return CHI_SIAMO.testi.join("\n\n");
  }
}

/**
 * Le righe di un titolo multiriga.
 *
 * Diverso da `inParagrafi`: qui **ogni** ritorno a capo conta, perché il punto
 * in cui il titolo va a capo è una scelta di disegno e non la separazione fra
 * due pensieri. Le righe vuote si scartano, così un invio di troppo non produce
 * una riga bianca alta sessanta pixel.
 */
export function inRighe(testo: string): string[] {
  return testo
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "");
}
