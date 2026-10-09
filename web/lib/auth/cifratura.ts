import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Cifratura a riposo per i segreti che il database deve conservare **interi**.
 *
 * Il token di sessione e quello d'invito nel database sono impronte SHA-256:
 * irreversibili, perché per verificarli basta riconfrontare l'impronta. Il
 * segreto TOTP no — per calcolare il codice di ora serve il segreto vero — e
 * quindi non si può ridurre a un'impronta. Finora stava in chiaro nella colonna
 * `utenti.totp_secret`: chi leggeva il database (o una copia di sicurezza) si
 * portava via secondi fattori funzionanti, e la premessa scritta in
 * `sessioni.ts` («chi legge il database non ottiene credenziali valide») non
 * valeva per lui.
 *
 * Qui il segreto si cifra prima di scriverlo, con una chiave che sta
 * nell'ambiente (`SITO_TOTP_SEGRETO`, l'unità systemd di §06) e **non** nel
 * database: una copia trafugata, senza quella chiave, non contiene più niente di
 * usabile. È lo stesso ragionamento del backup fuori sede.
 *
 * ## Opt-in, per non rompere chi c'è già
 *
 * Se `SITO_TOTP_SEGRETO` non è impostata, `cifra` restituisce il testo com'è:
 * il comportamento storico. Così un aggiornamento non blocca fuori chi ha già i
 * segreti in chiaro, e chi vuole la protezione la accende con una variabile.
 * `decifra` distingue i due casi dal **prefisso**: un valore che comincia per
 * `g1:` è cifrato (e senza chiave è un errore, non un segreto da leggere alla
 * cieca); tutto il resto è un segreto storico in chiaro, e torna com'è. La
 * conseguenza pratica è che i segreti esistenti continuano a funzionare, e si
 * cifrano da soli la prima volta che vengono rigenerati.
 *
 * Modulo di solo server: usa `node:crypto`.
 */

/** Marca un valore cifrato con questo modulo (AES-256-GCM, versione 1). */
const PREFISSO = "g1:";

/**
 * Il «sale» della derivazione: separa questa chiave da altri usi dello stesso
 * segreto d'ambiente, se un domani ce ne fossero. Non è un segreto, è un'etichetta
 * di dominio, e deve restare stabile o i valori già cifrati non si aprono più.
 */
const DOMINIO = "sito/totp/v1";

/** Il segreto grezzo dell'ambiente, o `null` se non è configurato. */
function segretoGrezzo(): string | null {
  const v = process.env.SITO_TOTP_SEGRETO;
  return v && v.length > 0 ? v : null;
}

/** La chiave a 32 byte derivata dal segreto d'ambiente, o `null` se non c'è. */
function chiave(): Buffer | null {
  const grezzo = segretoGrezzo();
  if (!grezzo) return null;
  return scryptSync(grezzo, DOMINIO, 32);
}

/** Vero se la cifratura a riposo è attiva (cioè se la chiave è configurata). */
export function cifraturaAttiva(): boolean {
  return segretoGrezzo() !== null;
}

/**
 * Cifra un testo per il riposo.
 *
 * Senza chiave configurata restituisce il testo invariato: è il comportamento
 * storico, e lo si sceglie di proposito per non bloccare un aggiornamento su chi
 * non ha ancora impostato la variabile. Con la chiave, produce
 * `g1:` + base64(iv ‖ tag ‖ testo cifrato): l'IV è casuale a ogni chiamata,
 * quindi lo stesso segreto non si cifra mai due volte allo stesso modo, e il tag
 * GCM garantisce che una manomissione venga rilevata in fase di lettura.
 */
export function cifra(testo: string): string {
  const k = chiave();
  if (!k) return testo;

  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const corpo = Buffer.concat([c.update(testo, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFISSO + Buffer.concat([iv, tag, corpo]).toString("base64");
}

/**
 * Decifra un valore letto dal database.
 *
 * Un valore senza il prefisso `g1:` è un segreto **storico in chiaro** e torna
 * com'è: è ciò che tiene funzionanti i secondi fattori già attivati prima della
 * cifratura. Un valore con il prefisso va decifrato, e se la chiave non c'è è un
 * errore — leggerlo alla cieca darebbe un segreto sbagliato, cioè un referente chiuso
 * fuori senza che nessuno capisca perché.
 */
export function decifra(memorizzato: string): string {
  if (!memorizzato.startsWith(PREFISSO)) return memorizzato;

  const k = chiave();
  if (!k) {
    throw new Error(
      "cifratura: trovato un segreto cifrato ma SITO_TOTP_SEGRETO non è impostata — " +
        "la chiave che lo ha cifrato dev'essere la stessa che lo apre.",
    );
  }

  const blob = Buffer.from(memorizzato.slice(PREFISSO.length), "base64");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const corpo = blob.subarray(28);

  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(corpo), d.final()]).toString("utf8");
}
