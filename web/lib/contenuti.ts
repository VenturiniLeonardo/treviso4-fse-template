import type { UnitaKey } from "@/lib/data";

/**
 * Forma dei contenuti che i referenti caricano: album, fotografie, documenti.
 *
 * Come `lib/identita.ts`, questo file non tocca il disco — ci sono solo i tipi e
 * le costanti, così può essere importato anche da un componente client. La
 * lettura e la scrittura stanno in `lib/album.ts` e `lib/documenti-store.ts`.
 */

// --------------------------------------------------------------------------
// Ciclo di approvazione
// --------------------------------------------------------------------------

/**
 * Stato di un contenuto.
 *
 * È la regola di §05 del piano messa in pratica: un referente di unità prepara, un referente
 * gruppo pubblica. Serve perché negli album ci sono foto di minori, e il
 * controllo dei consensi lo fa chi ha l'elenco completo.
 */
export type Stato = "bozza" | "in-revisione" | "pubblicato";

export const ETICHETTA_STATO: Record<Stato, string> = {
  bozza: "bozza",
  "in-revisione": "in revisione",
  pubblicato: "pubblicato",
};

/** Classe della pastiglia in tabella, fra quelle già definite in admin.css. */
export const PILL_STATO: Record<Stato, "draft" | "wait" | "ok"> = {
  bozza: "draft",
  "in-revisione": "wait",
  pubblicato: "ok",
};

// --------------------------------------------------------------------------
// Album e fotografie
// --------------------------------------------------------------------------

/**
 * Quanto può essere lunga l'indicazione di dove sta il modulo di carta di un
 * consenso («raccoglitore in sede, 2026-27»). Poche parole: è un'etichetta, non
 * una nota in cui scrivere altro dei ragazzi.
 */
export const MODULO_MAX = 80;

/**
 * Per quanti giorni una fotografia eliminata da un album resta nel cestino,
 * prima che il lavoro notturno la cancelli dal server (audit degli accessi,
 * A-1; trenta giorni, scelti il 7 ottobre 2026).
 */
export const GIORNI_CESTINO = 30;

/** Una fotografia nel cestino di un album, come la mostra la scheda dell'album. */
export interface FotoNelCestino {
  file: string;
  larghezza: number;
  altezza: number;
  didascalia: string;
  /** quando è stata eliminata, in millisecondi */
  eliminataIl: number;
  /** chi l'ha eliminata: il nome con cui si accede, o «» se l'account non c'è più */
  eliminataDa: string;
}

export interface Fotografia {
  /** nome del file nell'archivio */
  file: string;
  tipo: string;
  larghezza: number;
  altezza: number;
  /** didascalia: mai nomi di ragazzi, come dice l'informativa */
  didascalia: string;
  /**
   * A che punto è la conversione in derivate (fase 7, §8 del piano).
   *
   * `pronta` è il caso normale, e per le pagine pubbliche è l'unico che conta:
   * una fotografia non ancora convertita si vede lo stesso, servita
   * dall'originale. Gli altri due valori li usa la schermata dell'area, che
   * deve poter dire a chi ha appena caricato «ci sto lavorando» oppure «questa
   * non ce l'ho fatta, ecco perché».
   *
   * Facoltativo perché il seme di `lib/data.ts` — quello che il sito usa in
   * compilazione, quando il database può non esistere — non ha niente da dire
   * al riguardo.
   */
  conversione?: "pronta" | "attesa" | "errore";
  /** perché la conversione è fallita, se è fallita. Già scritto per chi legge. */
  motivo?: string;
  /** il lavoro da far riprovare, se è fallito */
  lavoroId?: number;
  /**
   * Nascosta: il file resta, ma la pagina dell'album non la mostra e la rotta
   * non la serve a chi non gestisce l'album. Le pagine pubbliche non la
   * ricevono proprio (`albumPubblicati`, `albumPubblicoPerIndirizzo`); l'area
   * sì, per poterla rimettere. Dal 6 ottobre 2026.
   */
  nascosta?: boolean;
}

export interface AlbumSalvato {
  /** indirizzo della pagina: /foto/<slug> */
  slug: string;
  anno: string;
  unita: UnitaKey;
  titolo: string;
  data: string;
  sottotitolo: string;
  tag: string;
  stato: Stato;
  /** quante foto sono state escluse per mancanza di consenso */
  escluse: number;
  foto: Fotografia[];
  /** marca temporale dell'ultima modifica, per l'elenco in area riservata */
  aggiornato: number;
  /** chi l'ha toccato per ultimo, come nome utente */
  autore: string;
}

// --------------------------------------------------------------------------
// Documenti
// --------------------------------------------------------------------------

export interface DocumentoSalvato {
  /** chiave stabile: <anno>/<titolo normalizzato>, o sempre/<titolo> */
  id: string;
  /**
   * L'anno sociale in forma canonica, `2026-2027` — oppure `null`: **sempre
   * valido**.
   *
   * Aggiunto con le cartelle (migrazione 0012). Il modulo di tesseramento e la
   * scheda sanitaria del campo non cambiano da un anno all'altro, e con un anno
   * obbligatorio sarebbero finiti in archivio a ogni settembre. `null` e non una
   * stringa convenzionale perché ogni confronto con un anno lo deve considerare:
   * TypeScript lo ricorda a chi scrive `d.anno === anno`, una parola magica no.
   */
  anno: string | null;
  /**
   * L'unità di cui è la circolare, oppure `gruppo`.
   *
   * Aggiunto nella fase 14.7, con la stessa convenzione di `AlbumSalvato.unita`:
   * `gruppo` è **l'unità di nessuno**, e nel database è `unita_id IS NULL`. È il
   * valore che `copre()` nega a ogni referente di unità, e quindi ciò che tiene la
   * modulistica del gruppo fuori dalla loro portata anche se ne indovinano
   * l'identificativo.
   *
   * Fino a qui i documenti non avevano un ambito, e non serviva: la sezione
   * stava nel menù dei soli gestori. Serve da quando esistono le circolari,
   * che le scrive il referente dell'unità a cui riguardano.
   */
  unita: UnitaKey;
  /** la cartella, come `Cartella.chiave`. Il nome è rimasto quello di prima. */
  categoria: string;
  titolo: string;
  nota: string;
  /**
   * Il riquadro giallo sotto il documento, nella pagina pubblica; vuoto se non
   * ce n'è. La nota spiega che cos'è il documento, l'avviso chi **non** deve
   * usarlo o che cosa fare prima: «chi è già tesserato in un altro gruppo chiede il
   * trasferimento, non compila questo modulo». Dalla migrazione 0016.
   */
  avviso: string;
  formato: "PDF" | "DOCX";
  /** dimensione leggibile, calcolata al caricamento */
  peso: string;
  aggiornamento: string;
  stato: Stato;
  /** nome del file nell'archivio; assente finché nessuno ha caricato niente */
  file?: string;
  aggiornato: number;
  autore: string;
}

/**
 * Il valore con cui i moduli dell'area dicono «nessun anno».
 *
 * Esiste solo fra il `<select>` e l'azione: nel database è `anno_id` nullo, in
 * `DocumentoSalvato` è `anno: null`. Una stringa serve perché un'opzione di un
 * menù a tendina non può valere `null`.
 */
export const SEMPRE_VALIDO = "sempre";

/**
 * L'anno di un documento come lo scrive l'area riservata: «2026/2027», oppure
 * «sempre valido». Una funzione, perché le schermate che lo mostrano sono tre.
 */
export const validitaDocumento = (anno: string | null): string =>
  anno === null ? "sempre valido" : anno.replace("-", "/");

/**
 * Una cartella della pagina Documenti: «Tesseramenti», «Campi estivi».
 *
 * Arrivate con la migrazione 0012 al posto delle sei categorie scritte nel
 * codice, perché le decidono i gestori.
 */
export interface Cartella {
  /** l'indirizzo, `/documenti/<chiave>`: non cambia se si rinomina */
  chiave: string;
  titolo: string;
  /** la riga sotto il nome. Vuota se non serve. */
  descrizione: string;
}

/**
 * La cartella delle circolari d'unità.
 *
 * È l'unica i cui documenti hanno un'unità — lo dice
 * `documenti_circolari_hanno_unita`, che confronta la categoria proprio con
 * questa stringa. Per questo non si elimina e un gestore non ci carica
 * documenti di gruppo: le circolari le carica il referente dell'unità a cui
 * riguardano.
 */
export const CARTELLA_CIRCOLARI = "circolari";

/**
 * Quanti file per volta si caricano in una cartella.
 *
 * Il limite vero è il peso, `CARICO_MAX`, che il browser controlla prima di
 * spedire. Questo tiene corto il messaggio di esito — venti righe di scartati
 * si leggono ancora — e il tempo di un invio.
 */
export const DOC_PER_INVIO = 20;

/**
 * Quanto può essere lungo l'avviso di un documento: due o tre righe nel
 * riquadro sotto il file. Il campo dell'area e l'azione leggono questo.
 */
export const AVVISO_MAX = 300;

/**
 * Il titolo di un documento a partire dal nome del file che lo porta.
 *
 * Chi carica una cartella intera sceglie dieci file e non scrive dieci titoli:
 * `modulo_tesseramento-2026-2027.pdf` diventa «Modulo tesseramento 2026-2027». Il
 * trattino fra due cifre resta, perché è quello di un anno sociale; gli altri
 * trattini e i trattini bassi diventano spazi. Il titolo si corregge dopo, dal
 * documento.
 *
 * Pura, e non tocca il disco: la usa l'azione e la può usare un componente.
 */
export function titoloDaNomeFile(nome: string): string {
  const senzaEstensione = nome.replace(/\.[a-z0-9]{1,5}$/i, "");
  const pulito = senzaEstensione
    .replace(/_+/g, " ")
    .replace(/(?<!\d)-+|-+(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90)
    .trim();
  return pulito.charAt(0).toLocaleUpperCase("it") + pulito.slice(1);
}

// --------------------------------------------------------------------------
// Limiti dei caricamenti
// --------------------------------------------------------------------------

/**
 * Una fotografia da album.
 *
 * Venti megabyte, come dice §8 del piano. Erano otto, ed erano pochi: un
 * iPhone recente in modalità «massima compatibilità» produce JPEG da dieci o
 * dodici, e chi si vedeva rifiutare metà del rullino non aveva modo di capire
 * che il problema era il telefono nuovo. Alzarlo si può perché dalla fase 7 il
 * file caricato non è più quello servito: le derivate pesano qualche centinaio
 * di kilobyte, e l'originale resta sul disco senza mai uscire.
 */
export const FOTO_PESO_MAX = 20 * 1024 * 1024;

/**
 * Quanto può essere lunga la descrizione di una richiesta GDPR.
 *
 * Duemila caratteri bastano per riportare con le parole di chi l'ha fatta
 * qualunque richiesta arrivata a voce o per messaggio. Senza un tetto il
 * registro accettava un megabyte per riga, e ogni apertura dell'elenco lo
 * rispediva intero al browser (report QA, BUG-008).
 */
export const DESCRIZIONE_GDPR_MAX = 2000;

/**
 * Il lato massimo dell'originale, in pixel.
 *
 * Ottomila copre qualunque telefono e qualunque reflex che si trovi in un
 * gruppo sito. Serve come rete contro le immagini costruite apposta per far
 * esplodere la memoria del decodificatore: una PNG di 30000×30000 pesa pochi
 * kilobyte compressa e una novantina di gigabyte decompressa.
 */
export const FOTO_LATO_MAX = 8000;

/**
 * Quanto può pesare **tutto insieme** un invio di fotografie.
 *
 * Non è un limite nostro: è quello del trasporto. Next accetta un corpo di
 * Server Action fino a `experimental.serverActions.bodySizeLimit`, che
 * `next.config.ts` fissa a 24 MB — e un corpo più grande viene rifiutato
 * **dentro Next**, prima che l'azione parta, con una pagina «500» al posto di
 * un messaggio. Il codice non ha modo di intercettarlo là.
 *
 * Quindi il conto si fa prima, nel browser: si somma il peso dei file scelti e
 * se non ci stanno si dice di caricarli in due volte. 22 e non 24 per lasciare
 * spazio alle intestazioni del multipart, che il conto dei file non vede.
 *
 * Se un giorno si cambia `bodySizeLimit`, va cambiato anche questo numero: c'è
 * una prova che controlla che i due si somiglino.
 */
export const CARICO_MAX = 22 * 1024 * 1024;

/** Un modulo in PDF o DOCX. */
export const DOC_PESO_MAX = 20 * 1024 * 1024;

/** Tipi di documento accettati, con la firma che devono avere in testa. */
export const FIRME_DOCUMENTO: {
  formato: "PDF" | "DOCX";
  tipo: string;
  estensione: string;
  firma: number[];
}[] = [
  // %PDF
  { formato: "PDF", tipo: "application/pdf", estensione: "pdf", firma: [0x25, 0x50, 0x44, 0x46] },
  // PK.. — un DOCX è uno zip
  {
    formato: "DOCX",
    tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    estensione: "docx",
    firma: [0x50, 0x4b, 0x03, 0x04],
  },
];

// --------------------------------------------------------------------------
// Utilità comuni
// --------------------------------------------------------------------------

/** Peso di un file in forma leggibile, come lo mostrava il mockup. */
export function pesoLeggibile(byte: number): string {
  if (byte >= 1024 * 1024) {
    const mb = byte / (1024 * 1024);
    return `${mb.toFixed(1).replace(".", ",")} MB`;
  }
  return `${Math.max(1, Math.round(byte / 1024))} KB`;
}

/**
 * Indirizzo a partire da un titolo: minuscole, senza accenti, con i trattini.
 *
 * Deve dare lo stesso risultato per lo stesso titolo, perché è la chiave con cui
 * la pagina pubblica trova l'album.
 */
export function inIndirizzo(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

/** Esito di un'azione dell'area riservata, per `useActionState`. */
export interface StatoAzione {
  stato: "vuoto" | "fatto" | "errore";
  messaggio?: string;
  campo?: string;
  /**
   * Codice da riferire chiedendo aiuto, quando l'errore viene dal database.
   *
   * Aggiunto per §11 del piano: il dettaglio tecnico resta nel registro del
   * server e all'utente arriva una frase comprensibile più questo codice, che
   * è ciò che permette a chi amministra di ritrovare la riga di log giusta.
   * Facoltativo: nessun componente esistente lo legge, e le azioni che non
   * toccano il database non lo valorizzano.
   */
  codice?: string;
}

export const AZIONE_INIZIALE: StatoAzione = { stato: "vuoto" };
