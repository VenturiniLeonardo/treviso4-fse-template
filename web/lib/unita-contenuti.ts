import type { Unita, UnitaKey } from "@/lib/data";

/**
 * Forma dei contenuti di un'unità, e il catalogo dei campi modificabili.
 *
 * Sta separato da `lib/unita-store.ts` per la stessa ragione per cui
 * `lib/identita.ts` sta separato da `lib/gruppo.ts`: il modulo che legge
 * importa `better-sqlite3`, e un componente client non può stare nella sua
 * catena di import. Qui non si tocca il disco e non si importa niente che non
 * sia un tipo.
 *
 * ## Il catalogo è la fonte unica del «metà e metà»
 *
 * La decisione del 31 agosto 2026 divide i campi in due: i **testi liberi**
 * vanno online appena salvati, i **recapiti e i nomi di persone** passano
 * dall'approvazione del gestore. Il perché è che un testo scritto male si
 * corregge domani, mentre un recapito sbagliato manda le famiglie nel vuoto e
 * resta lì — e i nomi dei referenti sono dati personali, di cui risponde chi ha
 * l'elenco completo, come per i consensi degli album.
 *
 * Quella divisione vive **qui e in nessun altro posto**. La leggono l'azione
 * che decide se scrivere subito o mettere in coda, l'interfaccia che disegna il
 * modulo, e la coda che mostra cosa c'è da approvare. Se fosse un `if` ripetuto
 * in tre file, prima o poi due dei tre direbbero cose diverse — e il modo in cui
 * si accorgerebbe qualcuno è un recapito finito online senza che nessuno
 * l'abbia guardato.
 */

/** I campi di contenuto che un referente di unità può toccare. */
export type CampoUnita =
  // testi liberi: si pubblicano subito
  | "occhiello"
  | "motto"
  | "ritrovo"
  | "fondazione"
  | "presentazione"
  | "storiaTitolo"
  | "notaStorico"
  | "storia"
  // recapiti e persone: passano dal gestore. L'email non c'è più: le
  // unità scrivono all'indirizzo ufficiale del gruppo (23 settembre 2026)
  | "telefono"
  | "referente"
  | "ruoloReferente";

/**
 * I campi che restano al gestore: identità dell'unità, non contenuto.
 *
 * Non sono in `CampoUnita` e non passano da `salvaCampiUnita`, e la separazione
 * è voluta: sono due righe di matrice diverse — `unita-scheda` e
 * `unita-anagrafica` — e tenerle in un catalogo solo vorrebbe dire che un errore
 * di filtro in un'azione può far scrivere a un referente di unità il nome della propria
 * unità. Due elenchi separati, due mappe di colonne separate, e la sola cosa che
 * possa mai finire nella `SET` di `salvaCampiUnita` sono i campi di contenuto.
 *
 * `slug` **non c'è**, e non è una dimenticanza: è l'indirizzo pubblico della
 * pagina. Cambiarlo romperebbe i collegamenti che le famiglie hanno salvato e i
 * risultati dei motori di ricerca, e non è una cosa da fare da un modulo — è una
 * migrazione, con un rinvio dal vecchio indirizzo al nuovo.
 */
export type CampoAnagrafica = "nome" | "eta" | "iscritti" | "sigla";

export interface DefinizioneAnagrafica {
  chiave: CampoAnagrafica;
  label: string;
  tipo: "riga" | "numero";
  hint: string;
  max: number;
}

/** I quattro campi dell'anagrafica, nell'ordine del modulo. */
export const CAMPI_ANAGRAFICA: DefinizioneAnagrafica[] = [
  {
    chiave: "nome",
    label: "Nome dell’unità",
    tipo: "riga",
    hint:
      "Come compare sul sito, per esempio: «Unità 1». " +
      "L’indirizzo della pagina non cambia.",
    max: 90,
  },
  {
    chiave: "eta",
    label: "Fascia d’età",
    tipo: "riga",
    hint: "Per esempio «8–11 anni». Compare accanto al nome, in cima alla pagina.",
    max: 40,
  },
  {
    chiave: "iscritti",
    label: "Iscritti",
    tipo: "numero",
    hint:
      "Il numero che la pagina dichiara; con zero la pagina non lo mostra. " +
      "L’etichetta la compone il sito e resta declinata come deve: «iscritti» o «iscritte».",
    max: 4,
  },
  {
    chiave: "sigla",
    label: "Sigla di tesseramento",
    tipo: "riga",
    hint: "Per esempio «U1» per l’unità 1. Senza, la riga non compare.",
    max: 8,
  },
];

const ANAGRAFICA_PER_CHIAVE = new Map(CAMPI_ANAGRAFICA.map((c) => [c.chiave, c]));

export const campoAnagrafica = (chiave: string): DefinizioneAnagrafica | undefined =>
  ANAGRAFICA_PER_CHIAVE.get(chiave as CampoAnagrafica);

// --------------------------------------------------------------------------
// La fotografia di copertina
// --------------------------------------------------------------------------

/**
 * Limiti del caricamento della copertina.
 *
 * Più larghi di quelli del marchio (1 MB, 2000 px) perché è una fotografia
 * scattata da un telefono, non un logo disegnato: otto megabyte e seimila pixel
 * di lato coprono qualunque telefono in circolazione. Sono gli stessi delle
 * fotografie degli album, e per la stessa ragione.
 */
export const COPERTINA_PESO_MAX = 8 * 1024 * 1024;
export const COPERTINA_LATO_MAX = 6000;

/**
 * Le misure consigliate, quelle che il segnaposto del mockup dichiara.
 *
 * Non sono un vincolo: `fit: "inside"` riduce senza tagliare, e una fotografia
 * più quadrata funziona comunque. Servono a dire a chi carica che l'immagine
 * sarà larga e bassa, così scegli una foto che regge il taglio.
 */
export const COPERTINA_CONSIGLIATA = { larghezza: 2400, altezza: 1200 };

export interface DefinizioneCampo {
  chiave: CampoUnita;
  label: string;
  /**
   * `paragrafi` è la casella grande: una riga vuota separa un paragrafo dal
   * successivo, ed è l'unica forma di «formattazione» che esiste nel sito. Non
   * c'è rich text e non c'è HTML — vedi `inParagrafi`.
   */
  tipo: "riga" | "paragrafi" | "email" | "tel";
  hint: string;
  /** limite di caratteri, verificato dall'azione e dichiarato nel modulo */
  max: number;
  /**
   * Vero se il referente di unità lo propone e il gestore lo pubblica.
   *
   * Per gestore e sviluppatore non vale: hanno `completo` sulla riga di
   * matrice, e chi può approvare non ha bisogno di proporre a sé stesso.
   */
  approvazione: boolean;
  /**
   * Vero se è un testo della pagina, che il social media manager può proporre.
   *
   * Falso per il ritrovo — un indirizzo e un orario, cioè dove le famiglie
   * portano i figli — e per nomi e telefono dei referenti. Il suo compito sono i
   * contenuti, le fotografie e il calendario; recapiti e indirizzi li cambiano
   * i referenti (decisione del 4 ottobre 2026).
   */
  contenuto: boolean;
}

/**
 * I campi, nell'ordine in cui compaiono nel modulo.
 *
 * L'ordine non è alfabetico ed è voluto: prima quello che si cambia spesso —
 * il ritrovo cambia a ogni cambio d'orario — poi i testi lunghi, poi i
 * recapiti, che si toccano una volta all'anno e stanno in fondo perché sono
 * quelli che aprono una richiesta di approvazione.
 */
export const CAMPI_UNITA: DefinizioneCampo[] = [
  {
    chiave: "ritrovo",
    label: "Luogo e orario del ritrovo",
    tipo: "riga",
    hint: "Per esempio «Sabato 15:00 – 17:30, sede di Via dell’Esempio». Compare nella scheda dell’unità.",
    max: 120,
    approvazione: false,
    contenuto: false,
  },
  {
    chiave: "motto",
    label: "Motto dell’unità",
    tipo: "riga",
    hint: "Una frase breve. Compare nella scheda dell’unità e nella ricerca del sito.",
    max: 60,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "occhiello",
    label: "Riga sopra il titolo",
    tipo: "riga",
    hint: "La pastiglia colorata in cima alla pagina dell’unità.",
    max: 80,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "fondazione",
    label: "Anno di fondazione",
    tipo: "riga",
    hint: "Anche approssimativo: «2002», oppure «anni Ottanta» se l’archivio non dice di più.",
    max: 40,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "presentazione",
    label: "Testo di presentazione",
    tipo: "paragrafi",
    hint:
      "Due righe su che cosa si fa nell’unità, per chi non la conosce: stanno in cima alla " +
      "pagina, prima della storia. Svuotata, la pagina torna al testo del progetto.",
    max: 600,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "storiaTitolo",
    label: "Titolo della sezione «La storia dell’unità»",
    tipo: "riga",
    hint: "Senza, la pagina usa il titolo predefinito.",
    max: 120,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "storia",
    label: "La storia dell’unità",
    tipo: "paragrafi",
    hint: "Lasciate una riga vuota fra un paragrafo e il successivo. Niente nomi di ragazzi.",
    max: 6000,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "notaStorico",
    label: "Nota sotto lo storico dei responsabili",
    tipo: "riga",
    hint: "Serve a spiegare i trattini: gli anni che l’archivio non registra non vanno dedotti.",
    max: 240,
    approvazione: false,
    contenuto: true,
  },
  {
    chiave: "referente",
    label: "Referente di unità",
    tipo: "riga",
    hint: "Come compare nella pagina Contatti: «Ref1 — Mario Rossi», o il solo nome.",
    max: 80,
    approvazione: true,
    contenuto: false,
  },
  {
    chiave: "ruoloReferente",
    label: "Come si chiama il ruolo",
    tipo: "riga",
    hint: "«Referente di unità», «Responsabile», «Coordinatrice». Intesta anche la tabella dello storico.",
    max: 40,
    approvazione: true,
    contenuto: false,
  },
  {
    chiave: "telefono",
    label: "Telefono di riferimento",
    tipo: "tel",
    hint: "Pubblicato in Contatti. Lasciatelo vuoto se preferite non pubblicarlo.",
    max: 40,
    approvazione: true,
    contenuto: false,
  },
];

/** I campi che si pubblicano appena salvati. */
export const CAMPI_LIBERI: CampoUnita[] = CAMPI_UNITA.filter((c) => !c.approvazione).map(
  (c) => c.chiave,
);

/** I campi che il referente di unità propone e il gestore pubblica. */
export const CAMPI_DA_APPROVARE: CampoUnita[] = CAMPI_UNITA.filter((c) => c.approvazione).map(
  (c) => c.chiave,
);

/** I campi che il social media manager propone: i testi, senza recapiti né indirizzi. */
export const CAMPI_DEI_CONTENUTI: CampoUnita[] = CAMPI_UNITA.filter((c) => c.contenuto).map(
  (c) => c.chiave,
);

const PER_CHIAVE = new Map(CAMPI_UNITA.map((c) => [c.chiave, c]));

/** La definizione di un campo, o `undefined` se il nome non è nel catalogo. */
export const campoUnita = (chiave: string): DefinizioneCampo | undefined =>
  PER_CHIAVE.get(chiave as CampoUnita);

/**
 * Questo campo, scritto da questo livello, va in coda o va online?
 *
 * `completo` — gestore e sviluppatore — pubblica sempre: la coda serve a
 * far guardare una modifica a qualcuno che non è chi l'ha fatta, e con
 * `completo` quel qualcuno è già chi sta scrivendo.
 */
export function serveApprovazione(chiave: string, livello: "completo" | "limitato"): boolean {
  if (livello === "completo") return false;
  return PER_CHIAVE.get(chiave as CampoUnita)?.approvazione ?? false;
}

// --------------------------------------------------------------------------
// Paragrafi
// --------------------------------------------------------------------------

/**
 * Da una casella di testo a un elenco di paragrafi.
 *
 * Una riga vuota separa un paragrafo dal successivo. È tutta la
 * «formattazione» che il sito conosce, e la ragione per cui non serve né un
 * editor di testo ricco né una sanificazione dell'HTML: quello che entra è
 * testo, quello che esce è testo, e React lo scappa da sé. La classe XSS da
 * rich text non si mitiga qui — non si apre.
 *
 * `\r\n` si normalizza perché i browser su Windows lo mandano così, e senza
 * questa riga un paragrafo separato da una riga vuota arriverebbe come un
 * paragrafo solo con dentro dei ritorni a capo.
 */
export function inParagrafi(testo: string): string[] {
  return testo
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Da un elenco di paragrafi al testo per la casella. L'inverso di `inParagrafi`. */
export const daParagrafi = (paragrafi: readonly string[]): string => paragrafi.join("\n\n");

// --------------------------------------------------------------------------
// Persone
// --------------------------------------------------------------------------

export type TipoPersona = "responsabile" | "staff" | "storico";

/**
 * Una persona di un'unità: un responsabile in carica, un aiuto, o un
 * predecessore.
 *
 * Tre elenchi con la stessa forma, distinti da `tipo` — che è anche il modo in
 * cui stanno in una tabella sola invece di tre. Vedi `unita_persone` in
 * `lib/db/schema.ts`.
 */
export interface Persona {
  /** assente per le persone che vengono dal predefinito di `lib/data.ts` */
  id?: number;
  tipo: TipoPersona;
  nome: string;
  /** il soprannome, o il ruolo: dipende dall'unità */
  ruolo: string;
  /** «dal 2022» per chi c'è, «2018 – 2022» per chi c'è stato, «—» se ignoto */
  periodo: string;
  /** la terza colonna dello storico */
  nota: string;
  ordine: number;
  stato: "bozza" | "in-revisione" | "pubblicato";
}

/**
 * Le tuple di `Unita` nella forma che il modulo compila.
 *
 * `Unita` porta tre array di tuple con tre ordini diversi — `responsabili` è
 * `[nome, ruolo, dal]`, `staff` è `[nome, ruolo]`, `storico` è `[anni, nome,
 * nota]` — perché è così che le tre tabelle della pagina pubblica li stampano.
 * La traduzione sta qui, in un posto solo: farla nel componente vorrebbe dire
 * tre `map` in linea, e il giorno in cui una colonna si sposta se ne accorge
 * solo chi guarda la pagina.
 */
export function righeDaUnita(
  unita: Unita,
  tipo: TipoPersona,
): { nome: string; ruolo: string; periodo: string; nota: string }[] {
  if (tipo === "responsabile") {
    return unita.responsabili.map(([nome, ruolo, periodo]) => ({
      nome,
      ruolo,
      periodo,
      nota: "",
    }));
  }
  if (tipo === "staff") {
    return unita.staff.map(([nome, ruolo]) => ({ nome, ruolo, periodo: "", nota: "" }));
  }
  // lo storico non ha un ruolo per persona: la colonna è intestata col ruolo
  // dell'unità («Referente di unità»), che è un campo della scheda e non di ogni riga
  return unita.storico.map(([periodo, nome, nota]) => ({ nome, ruolo: "", periodo, nota }));
}

export const ETICHETTA_TIPO_PERSONA: Record<TipoPersona, string> = {
  responsabile: "Responsabile in carica",
  staff: "Staff dell’unità",
  storico: "Responsabile precedente",
};

// --------------------------------------------------------------------------
// Proposte
// --------------------------------------------------------------------------

/** Una modifica che aspetta l'approvazione del gestore. */
export interface Proposta {
  unita: UnitaKey;
  campo: CampoUnita;
  /** quello che c'è online adesso, per il confronto in coda */
  attuale: string;
  /** quello che il referente di unità propone */
  proposto: string;
  autore: string;
  quando: number;
}

/**
 * Le chiavi con cui i testi lunghi stanno in `pagine_testi`.
 *
 * `unita.u1.storia`. Il prefisso tiene separati questi testi da quelli
 * del gruppo, che usano `gruppo.` — sono nella stessa tabella perché sono la
 * stessa cosa, testi editoriali, e §4 del mandato vieta di inventarne una
 * seconda per la stessa forma di dato.
 */
export const PREFISSO_TESTI = "unita.";

/**
 * I campi di contenuto che non stanno in una colonna ma in `pagine_testi`.
 *
 * La presentazione c'è dal 6 ottobre 2026: prima era solo in `lib/data.ts`, e
 * il riquadro «Presentazione» dell'area non aveva un campo per cambiarla.
 * Sta qui e non in una colonna nuova per la stessa ragione della storia: è un
 * testo editoriale, e così non serve una migrazione.
 */
export const CAMPI_TESTO_LUNGO = ["storia", "presentazione"] as const;
export type CampoTestoLungo = (typeof CAMPI_TESTO_LUNGO)[number];

export const eCampoTestoLungo = (campo: string): campo is CampoTestoLungo =>
  (CAMPI_TESTO_LUNGO as readonly string[]).includes(campo);

export const chiaveTesto = (unita: UnitaKey, campo: CampoTestoLungo): string =>
  `${PREFISSO_TESTI}${unita}.${campo}`;

/**
 * Un'unità come la vede il sito, con l'indicazione di che cosa è stato
 * personalizzato.
 *
 * `Unita` è la forma che le pagine già usano e non cambia — è il punto di tutto
 * lo store. `personalizzati` serve solo all'area riservata, che mostra quali
 * campi sono stati toccati e quali stanno ancora sul predefinito del codice.
 */
export interface UnitaConStato {
  unita: Unita;
  personalizzati: Set<string>;
}
