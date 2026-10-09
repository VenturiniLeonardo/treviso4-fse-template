import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Il secondo fattore: TOTP, RFC 6238. Scritto qui, senza dipendenze.
 *
 * Sono una sessantina di righe di algoritmo — un HMAC-SHA1 su un contatore di
 * mezzi minuti, troncato a sei cifre — e una tabella base32. Aggiungere un
 * pacchetto per farle sarebbe stato più codice da fidarsi, non meno: una
 * libreria di TOTP è comunque da leggere prima di metterci dentro il secondo
 * fattore di chi vede gli elenchi degli iscritti.
 *
 * I parametri sono quelli che le applicazioni conoscono senza doverglielo dire
 * — SHA-1, sei cifre, trenta secondi. **SHA-1 non è una svista**: RFC 6238 lo dà
 * come predefinito e Google Authenticator, Aegis e i gestori di password
 * ignorano il parametro `algorithm` nell'URI. Un segreto SHA-256 verrebbe
 * inquadrato senza errori e produrrebbe codici sbagliati per sempre, e nessuno
 * capirebbe perché. Qui l'HMAC non protegge un messaggio: è la funzione a senso
 * unico di un segreto condiviso valido trenta secondi.
 *
 * Modulo di solo server: usa `node:crypto`.
 */

/** Trenta secondi per passo, sei cifre: i valori che tutte le app assumono. */
export const PASSO_S = 30;
export const CIFRE = 6;

/**
 * Quanti passi di tolleranza in avanti e indietro.
 *
 * Uno solo: copre l'orologio del telefono sfasato di mezzo minuto e il tempo di
 * digitare. Allargarla moltiplica i codici validi in ogni istante, che è il
 * contrario di quello per cui il secondo fattore esiste.
 */
export const TOLLERANZA_PASSI = 1;

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 RFC 4648, senza riempimento: è la forma che le app si aspettano. */
export function inBase32(dati: Buffer): string {
  let bit = 0;
  let valore = 0;
  let fuori = "";
  for (const b of dati) {
    valore = (valore << 8) | b;
    bit += 8;
    while (bit >= 5) {
      fuori += ALFABETO[(valore >>> (bit - 5)) & 31];
      bit -= 5;
    }
  }
  if (bit > 0) fuori += ALFABETO[(valore << (5 - bit)) & 31];
  return fuori;
}

/**
 * Da base32 a byte. `null` se c'è un carattere che non appartiene all'alfabeto.
 *
 * Spazi e minuscole si accettano: le app mostrano il segreto a gruppi di
 * quattro, e chi lo ricopia a mano lo ricopia come lo vede.
 */
export function daBase32(testo: string): Buffer | null {
  const pulito = testo.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (pulito === "") return null;

  let bit = 0;
  let valore = 0;
  const fuori: number[] = [];
  for (const c of pulito) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) return null;
    valore = (valore << 5) | i;
    bit += 5;
    if (bit >= 8) {
      fuori.push((valore >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return Buffer.from(fuori);
}

/**
 * Un segreto nuovo: venti byte casuali, cioè 160 bit — la lunghezza che RFC
 * 4226 §4 raccomanda per HMAC-SHA1, e trentadue caratteri base32 da inquadrare.
 */
export function nuovoSegreto(): string {
  return inBase32(randomBytes(20));
}

/** Il passo in cui cade un istante: i mezzi minuti dall'epoca. */
export function passoDi(quandoMs: number): number {
  return Math.floor(quandoMs / 1000 / PASSO_S);
}

/**
 * Il codice di un passo. `null` se il segreto non è base32 valido.
 *
 * È HOTP (RFC 4226): HMAC-SHA1 del contatore su otto byte, poi il troncamento
 * dinamico — gli ultimi quattro bit dell'HMAC dicono da dove leggere le quattro
 * che diventano il numero.
 */
export function codiceAlPasso(segreto: string, passo: number): string | null {
  const chiave = daBase32(segreto);
  if (!chiave || chiave.length === 0) return null;

  const contatore = Buffer.alloc(8);
  // `writeBigUInt64BE` e non due `writeUInt32BE`: il contatore è un intero a 64
  // bit e va scritto come tale, anche se i primi quattro byte resteranno zero
  // fino all'anno 6000 circa
  contatore.writeBigUInt64BE(BigInt(passo));

  const hmac = createHmac("sha1", chiave).update(contatore).digest();
  const scarto = hmac[hmac.length - 1] & 0x0f;
  const numero =
    ((hmac[scarto] & 0x7f) << 24) |
    (hmac[scarto + 1] << 16) |
    (hmac[scarto + 2] << 8) |
    hmac[scarto + 3];

  return String(numero % 10 ** CIFRE).padStart(CIFRE, "0");
}

/** Il codice valido adesso. Serve alle prove e alla schermata di attivazione. */
export function codiceOra(segreto: string, quandoMs = Date.now()): string | null {
  return codiceAlPasso(segreto, passoDi(quandoMs));
}

/**
 * Esito di una verifica: il passo consumato, da salvare per impedire il riuso.
 *
 * Restituire il passo invece di un booleano non è un dettaglio. RFC 6238 §5.2
 * chiede che un codice già usato non sia riaccettato: senza, chi lo vede —
 * sopra una spalla, in un log, in una schermata condivisa — ha trenta secondi
 * buoni per rigiocarlo. Chi chiama salva questo numero e lo ripassa la volta
 * dopo come `ultimoPasso`.
 */
export interface EsitoTotp {
  ok: boolean;
  passo?: number;
}

/**
 * Verifica un codice, con la tolleranza e senza permettere il riuso.
 *
 * Il confronto è a tempo costante: sono sei cifre e la differenza è di
 * microsecondi, ma un confronto di stringhe che esce al primo carattere diverso
 * è la forma da non prendere l'abitudine di scrivere.
 */
export function verificaCodice(
  segreto: string,
  codice: string,
  ultimoPasso: number | null = null,
  quandoMs = Date.now(),
): EsitoTotp {
  const pulito = codice.replace(/[\s-]/g, "");
  if (!new RegExp(`^\\d{${CIFRE}}$`).test(pulito)) return { ok: false };

  const adesso = passoDi(quandoMs);
  for (let d = -TOLLERANZA_PASSI; d <= TOLLERANZA_PASSI; d++) {
    const passo = adesso + d;
    // già consumato, o più vecchio di uno consumato: rifiutato senza calcolare
    if (ultimoPasso !== null && passo <= ultimoPasso) continue;

    const atteso = codiceAlPasso(segreto, passo);
    if (!atteso) return { ok: false };
    if (timingSafeEqual(Buffer.from(atteso), Buffer.from(pulito))) return { ok: true, passo };
  }
  return { ok: false };
}

/**
 * L'indirizzo `otpauth://` da mettere nel QR.
 *
 * L'etichetta è `Emittente:utente` **e** `issuer` si ripete come parametro:
 * è la ridondanza che RFC prescrive perché le app vecchie leggono l'una e le
 * nuove l'altro, e chi ha tre account simili in rubrica deve distinguerli.
 */
export function uriOtpauth(segreto: string, utente: string, emittente = "Label"): string {
  const etichetta = `${encodeURIComponent(emittente)}:${encodeURIComponent(utente)}`;
  const parametri = new URLSearchParams({
    secret: segreto,
    issuer: emittente,
    algorithm: "SHA1",
    digits: String(CIFRE),
    period: String(PASSO_S),
  });
  return `otpauth://totp/${etichetta}?${parametri}`;
}
