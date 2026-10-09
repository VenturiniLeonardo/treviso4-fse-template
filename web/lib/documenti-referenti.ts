/**
 * I documenti per i referenti: tipi, formati e il riconoscimento di un file.
 *
 * Qui ci sono **solo tipi e funzioni pure**: li usa anche il componente client
 * della sezione (il campo file, l'etichetta del formato), e un client non può
 * stare nella stessa catena di import di `node:fs`. Lettura e scrittura stanno
 * in `lib/documenti-referenti-store.ts`.
 *
 * ## Perché non solo PDF, come i documenti pubblici
 *
 * Decisione del 3 ottobre 2026: per i documenti interni serve spesso il file
 * modificabile — il verbale da completare, il foglio delle quote, la
 * presentazione della riunione — e non solo la sua stampa. Quindi PDF, Word,
 * Excel, PowerPoint e i loro equivalenti OpenDocument. Niente immagini, niente
 * archivi, niente formati con le macro (`.docm`, `.xlsm`): l'estensione li
 * esclude, e un `.docx` con delle macro dentro Word non le esegue.
 */

export type FormatoReferenti =
  | "PDF"
  | "DOCX"
  | "XLSX"
  | "PPTX"
  | "ODT"
  | "ODS"
  | "ODP"
  | "DOC"
  | "XLS"
  | "PPT";

/**
 * Come si riconosce un formato dai suoi primi byte.
 *
 *  - `pdf`: comincia con `%PDF-`;
 *  - `ooxml`: uno zip con `[Content_Types].xml` e la cartella del suo programma
 *    (`word/`, `xl/`, `ppt/`), i cui nomi stanno in chiaro nelle intestazioni
 *    dello zip;
 *  - `odf`: uno zip il cui primo elemento è `mimetype`, non compresso, con il
 *    tipo scritto subito dopo — è la regola del formato, non un'abitudine;
 *  - `ole`: il contenitore dei vecchi Office, che è lo stesso per i tre.
 */
type Famiglia =
  | { tipo: "pdf" }
  | { tipo: "ooxml"; cartella: string }
  | { tipo: "odf"; mimetype: string }
  | { tipo: "ole" };

export interface DefinizioneFormato {
  formato: FormatoReferenti;
  estensione: string;
  /** il tipo con cui si serve il file: lo decidiamo noi, non chi carica */
  mime: string;
  /** il nome per chi legge l'elenco: «Word», «Excel» */
  nome: string;
  famiglia: Famiglia;
}

/** Gli stessi valori del `CHECK` `documenti_referenti_formato`: una prova li confronta. */
export const FORMATI_REFERENTI: DefinizioneFormato[] = [
  { formato: "PDF", estensione: "pdf", mime: "application/pdf", nome: "PDF", famiglia: { tipo: "pdf" } },
  {
    formato: "DOCX",
    estensione: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    nome: "Word",
    famiglia: { tipo: "ooxml", cartella: "word/" },
  },
  {
    formato: "XLSX",
    estensione: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    nome: "Excel",
    famiglia: { tipo: "ooxml", cartella: "xl/" },
  },
  {
    formato: "PPTX",
    estensione: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    nome: "PowerPoint",
    famiglia: { tipo: "ooxml", cartella: "ppt/" },
  },
  {
    formato: "ODT",
    estensione: "odt",
    mime: "application/vnd.oasis.opendocument.text",
    nome: "Testo OpenDocument",
    famiglia: { tipo: "odf", mimetype: "application/vnd.oasis.opendocument.text" },
  },
  {
    formato: "ODS",
    estensione: "ods",
    mime: "application/vnd.oasis.opendocument.spreadsheet",
    nome: "Foglio OpenDocument",
    famiglia: { tipo: "odf", mimetype: "application/vnd.oasis.opendocument.spreadsheet" },
  },
  {
    formato: "ODP",
    estensione: "odp",
    mime: "application/vnd.oasis.opendocument.presentation",
    nome: "Presentazione OpenDocument",
    famiglia: { tipo: "odf", mimetype: "application/vnd.oasis.opendocument.presentation" },
  },
  { formato: "DOC", estensione: "doc", mime: "application/msword", nome: "Word", famiglia: { tipo: "ole" } },
  {
    formato: "XLS",
    estensione: "xls",
    mime: "application/vnd.ms-excel",
    nome: "Excel",
    famiglia: { tipo: "ole" },
  },
  {
    formato: "PPT",
    estensione: "ppt",
    mime: "application/vnd.ms-powerpoint",
    nome: "PowerPoint",
    famiglia: { tipo: "ole" },
  },
];

/** Il valore di `accept` del campo file: le estensioni, che ogni browser capisce. */
export const ACCETTA_REFERENTI = FORMATI_REFERENTI.map((f) => `.${f.estensione}`).join(",");

/** I formati in una riga, per le note dei moduli. */
export const FORMATI_REFERENTI_IN_BREVE = "PDF, Word, Excel, PowerPoint e OpenDocument";

export const definizioneDi = (formato: string): DefinizioneFormato | undefined =>
  FORMATI_REFERENTI.find((f) => f.formato === formato);

/** Un documento per i referenti, come lo vedono schermata e rotta. */
export interface DocumentoReferenti {
  id: number;
  cartellaId: number;
  titolo: string;
  nota: string;
  formato: FormatoReferenti;
  byte: number;
  file: string;
  /** ISO-8601 UTC */
  caricatoIl: string;
  /** il nome utente di chi l'ha caricato, o `""` se l'account non c'è più */
  autore: string;
}

export interface CartellaReferenti {
  id: number;
  titolo: string;
  descrizione: string;
  /** quanti documenti contiene */
  documenti: number;
}

const ascii = (testo: string) => [...testo].map((c) => c.charCodeAt(0));

const PDF = ascii("%PDF-");
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const iniziaCon = (b: Uint8Array, firma: number[], da = 0) =>
  b.length >= da + firma.length && firma.every((x, i) => b[da + i] === x);

/** Vero se la sequenza compare nei byte. Sono al più venti megabyte: va bene così. */
function contiene(b: Uint8Array, cercato: number[]): boolean {
  const primo = cercato[0];
  const fine = b.length - cercato.length;
  for (let i = b.indexOf(primo); i !== -1 && i <= fine; i = b.indexOf(primo, i + 1)) {
    if (iniziaCon(b, cercato, i)) return true;
  }
  return false;
}

function corrisponde(b: Uint8Array, famiglia: Famiglia): boolean {
  switch (famiglia.tipo) {
    case "pdf":
      return iniziaCon(b, PDF);
    case "ole":
      return iniziaCon(b, OLE);
    case "ooxml":
      return (
        iniziaCon(b, ZIP) &&
        contiene(b, ascii("[Content_Types].xml")) &&
        contiene(b, ascii(famiglia.cartella))
      );
    case "odf":
      // intestazione locale dello zip: 30 byte, poi il nome «mimetype» (8), poi
      // il contenuto non compresso del primo elemento, che è il tipo
      return (
        iniziaCon(b, ZIP) &&
        iniziaCon(b, ascii("mimetype"), 30) &&
        iniziaCon(b, ascii(famiglia.mimetype), 38)
      );
  }
}

/**
 * Il formato di un file caricato, dal nome **e** dal contenuto; oppure il
 * motivo per cui non lo si accetta, già in forma di frase.
 *
 * Servono tutti e due. Il nome da solo lo sceglie chi carica: un `.pdf` che è
 * una pagina HTML, servito come PDF, non fa danni nel browser — ma arriva sul
 * computer di un referente come «verbale.pdf». Il contenuto da solo non basta per i
 * vecchi Office, dove Word, Excel e PowerPoint hanno lo stesso contenitore, né
 * per dire a chi carica *che cosa* non va.
 */
export function riconosciFormato(
  nome: string,
  contenuto: Uint8Array,
): { ok: true; definizione: DefinizioneFormato } | { ok: false; errore: string } {
  const estensione = nome.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";
  const definizione = FORMATI_REFERENTI.find((f) => f.estensione === estensione);
  if (!definizione) {
    return {
      ok: false,
      errore: `formato non accettato: si caricano ${FORMATI_REFERENTI_IN_BREVE}`,
    };
  }
  if (!corrisponde(contenuto, definizione.famiglia)) {
    return {
      ok: false,
      errore: `non è un file ${definizione.nome} valido, anche se il nome finisce in .${estensione}`,
    };
  }
  return { ok: true, definizione };
}

/**
 * Il nome con cui il file arriva nella cartella dei download di chi lo scarica:
 * il titolo del documento, non il nome interno `referenti-1791…-a3f9c1.docx`.
 *
 * Solo caratteri sicuri, come nella rotta dei documenti pubblici: virgolette e
 * ritorni a capo dentro un `Content-Disposition` sono il modo classico di
 * iniettare intestazioni.
 */
export function nomeDaScaricare(titolo: string, formato: string): string {
  const estensione = definizioneDi(formato)?.estensione ?? "bin";
  const pulito = titolo
    .replace(/[^\p{L}\p{N} .,_-]/gu, "-")
    .replace(/-{2,}/g, "-")
    // un titolo fatto solo di simboli diventerebbe «-.pdf»
    .replace(/^[-\s.]+|[-\s.]+$/g, "");
  return `${pulito || "documento"}.${estensione}`;
}
