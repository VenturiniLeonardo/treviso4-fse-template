import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { cancellaCaricato, scriviCaricato } from "@/lib/archivio";
import {
  type CartellaReferenti,
  type DocumentoReferenti,
  type FormatoReferenti,
  riconosciFormato,
} from "@/lib/documenti-referenti";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { cartelleReferenti, documentiReferenti as tabella, utenti } from "@/lib/db/schema";

/**
 * I documenti per i referenti: cartelle e file che gestore e sviluppatore
 * caricano e che vedono soltanto i referenti, dall'area riservata.
 *
 * Modulo di solo server. Chi può leggere e chi può scrivere non si decide qui:
 * lo decidono le righe `documenti-referenti-leggi` e `documenti-referenti-carica` della
 * matrice, nelle azioni e nella rotta che serve i file. Questo modulo legge e
 * scrive, e basta — come gli altri store.
 *
 * ## Il file prima della riga
 *
 * Come per i documenti pubblici: il file si scrive sul disco **prima** della
 * transazione, e se la riga non entra si cancella. L'ordine inverso lascerebbe,
 * per un istante o per sempre, una riga che punta a un file che non c'è — cioè
 * un pulsante «Scarica» che risponde «non trovato». Un file senza riga invece
 * non lo vede nessuno, e se resta lo trova `npm run db:orfani`.
 */

/** Esito di una scrittura che può non farsi per una ragione da dire a chi la chiede. */
export type Esito<T = object> = ({ ok: true } & T) | { ok: false; errore: string; campo?: string };

// --------------------------------------------------------------------------
// Lettura
// --------------------------------------------------------------------------

/** Vero se la migrazione 0019 c'è. Una volta vista non si richiede più. */
let tabelleViste = false;

/**
 * Il database, se c'è **e** ha le tabelle; altrimenti `null`.
 *
 * Le pagine che leggono questi dati sono dell'area riservata, quindi dinamiche:
 * la compilazione non le rende, e il caso «tabella assente» in esercizio vuol
 * dire una migrazione dimenticata. Si risponde con un elenco vuoto invece di
 * un errore — la sezione dice che non c'è niente, e il resto dell'area
 * funziona — e lo si scrive nel registro del server.
 */
function dbConTabelle(): Handle | null {
  const d = dbSeEsiste();
  if (!d) return null;
  if (tabelleViste) return d;
  tabelleViste = Boolean(
    d.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documenti_referenti'")
      .get(),
  );
  if (!tabelleViste) {
    console.warn(
      "documenti per i referenti: la tabella non c'è (migrazione 0019 non applicata): " +
        "manca «npm run db:applica».",
    );
    return null;
  }
  return d;
}

/** Le colonne di un `DocumentoReferenti`, con il nome dell'autore unito. */
const COLONNE = {
  id: tabella.id,
  cartellaId: tabella.cartellaId,
  titolo: tabella.titolo,
  nota: tabella.nota,
  formato: tabella.formato,
  byte: tabella.byte,
  file: tabella.file,
  caricatoIl: tabella.caricatoIl,
  autore: utenti.utente,
};

function comeDocumento(r: {
  id: number;
  cartellaId: number;
  titolo: string;
  nota: string;
  formato: string;
  byte: number;
  file: string;
  caricatoIl: string;
  autore: string | null;
}): DocumentoReferenti {
  return { ...r, formato: r.formato as FormatoReferenti, autore: r.autore ?? "" };
}

/** Le cartelle, nell'ordine deciso da chi le gestisce, con quanti documenti hanno. */
export const leggiCartelleReferenti = cache(async (): Promise<CartellaReferenti[]> => {
  const d = dbConTabelle();
  if (!d) return [];
  try {
    /*
     * Il conteggio in una query a parte, e non in una sottoquery correlata.
     * Drizzle scrive le colonne senza il nome della tabella, e dentro
     * `(SELECT count(*) FROM documenti_referenti WHERE "cartella_id" = "id")` quel
     * `"id"` è del documento, non della cartella: contava i documenti il cui
     * numero coincideva con quello della propria cartella. Trovato provando.
     */
    const quanti = new Map(
      d
        .select({ cartellaId: tabella.cartellaId, n: sql<number>`count(*)` })
        .from(tabella)
        .groupBy(tabella.cartellaId)
        .all()
        .map((r) => [r.cartellaId, r.n]),
    );
    return d
      .select({
        id: cartelleReferenti.id,
        titolo: cartelleReferenti.titolo,
        descrizione: cartelleReferenti.descrizione,
      })
      .from(cartelleReferenti)
      .orderBy(asc(cartelleReferenti.ordine), asc(cartelleReferenti.id))
      .all()
      .map((c) => ({ ...c, documenti: quanti.get(c.id) ?? 0 }));
  } catch (errore) {
    solleva("documenti-referenti-store.leggiCartelleReferenti", errore);
  }
});

export async function cartellaReferentiPerId(id: number): Promise<CartellaReferenti | undefined> {
  return (await leggiCartelleReferenti()).find((c) => c.id === id);
}

/** I documenti di una cartella, dal più recente. */
export async function documentiDellaCartella(cartellaId: number): Promise<DocumentoReferenti[]> {
  const d = dbConTabelle();
  if (!d) return [];
  try {
    return d
      .select(COLONNE)
      .from(tabella)
      .leftJoin(utenti, eq(utenti.id, tabella.autoreId))
      .where(eq(tabella.cartellaId, cartellaId))
      .orderBy(desc(tabella.caricatoIl), desc(tabella.id))
      .all()
      .map(comeDocumento);
  } catch (errore) {
    solleva("documenti-referenti-store.documentiDellaCartella", errore);
  }
}

/** Tutti i documenti, dal più recente: la sezione li mostra divisi per cartella in una pagina sola. */
export async function tuttiDocumentiReferenti(): Promise<DocumentoReferenti[]> {
  const d = dbConTabelle();
  if (!d) return [];
  try {
    return d
      .select(COLONNE)
      .from(tabella)
      .leftJoin(utenti, eq(utenti.id, tabella.autoreId))
      .orderBy(desc(tabella.caricatoIl), desc(tabella.id))
      .all()
      .map(comeDocumento);
  } catch (errore) {
    solleva("documenti-referenti-store.tuttiDocumentiReferenti", errore);
  }
}

/** Gli ultimi documenti caricati, in tutte le cartelle: la prima cosa che un referente cerca. */
export async function ultimiDocumentiReferenti(quanti: number): Promise<DocumentoReferenti[]> {
  const d = dbConTabelle();
  if (!d) return [];
  try {
    return d
      .select(COLONNE)
      .from(tabella)
      .leftJoin(utenti, eq(utenti.id, tabella.autoreId))
      .orderBy(desc(tabella.caricatoIl), desc(tabella.id))
      .limit(quanti)
      .all()
      .map(comeDocumento);
  } catch (errore) {
    solleva("documenti-referenti-store.ultimiDocumentiReferenti", errore);
  }
}

export async function documentoReferentiPerId(id: number): Promise<DocumentoReferenti | undefined> {
  const d = dbConTabelle();
  if (!d) return undefined;
  try {
    const r = d
      .select(COLONNE)
      .from(tabella)
      .leftJoin(utenti, eq(utenti.id, tabella.autoreId))
      .where(eq(tabella.id, id))
      .get();
    return r ? comeDocumento(r) : undefined;
  } catch (errore) {
    solleva("documenti-referenti-store.documentoReferentiPerId", errore);
  }
}

/** Per la rotta che serve i file: la riga che porta questo nome, se c'è. */
export async function documentoReferentiPerFile(file: string): Promise<DocumentoReferenti | undefined> {
  const d = dbConTabelle();
  if (!d) return undefined;
  try {
    const r = d
      .select(COLONNE)
      .from(tabella)
      .leftJoin(utenti, eq(utenti.id, tabella.autoreId))
      .where(eq(tabella.file, file))
      .get();
    return r ? comeDocumento(r) : undefined;
  } catch (errore) {
    solleva("documenti-referenti-store.documentoReferentiPerFile", errore);
  }
}

// --------------------------------------------------------------------------
// Cartelle
// --------------------------------------------------------------------------

/** L'id dell'utente dal nome, o `null`: come negli altri store. */
function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null;
}

/** Un'altra cartella con lo stesso nome, maiuscole a parte. */
function omonima(d: Handle, titolo: string, tranne?: number) {
  const stesso = sql`lower(${cartelleReferenti.titolo}) = lower(${titolo})`;
  return d
    .select({ titolo: cartelleReferenti.titolo })
    .from(cartelleReferenti)
    .where(tranne === undefined ? stesso : and(stesso, ne(cartelleReferenti.id, tranne)))
    .get();
}

const OMONIMA = (titolo: string) => ({
  ok: false as const,
  campo: "titolo",
  errore: `C’è già la cartella «${titolo}»: scegliete un nome diverso.`,
});

export async function creaCartellaReferenti(
  dati: { titolo: string; descrizione: string },
  autore: string,
): Promise<Esito<{ id: number }>> {
  try {
    return transazione((d) => {
      const gia = omonima(d, dati.titolo);
      if (gia) return OMONIMA(gia.titolo);

      const ultimo =
        d
          .select({ n: sql<number>`coalesce(max(${cartelleReferenti.ordine}), 0)` })
          .from(cartelleReferenti)
          .get()?.n ?? 0;

      const { id } = d
        .insert(cartelleReferenti)
        .values({
          titolo: dati.titolo,
          descrizione: dati.descrizione,
          // in fondo: chi la crea la sposta dove vuole
          ordine: ultimo + 1,
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .returning({ id: cartelleReferenti.id })
        .get();
      return { ok: true as const, id };
    });
  } catch (errore) {
    solleva("documenti-referenti-store.creaCartellaReferenti", errore);
  }
}

export async function modificaCartellaReferenti(
  id: number,
  dati: { titolo: string; descrizione: string },
  autore: string,
): Promise<Esito> {
  try {
    return transazione((d) => {
      const trovata = d.select({ id: cartelleReferenti.id }).from(cartelleReferenti).where(eq(cartelleReferenti.id, id)).get();
      if (!trovata) return { ok: false as const, errore: "Questa cartella non esiste più." };

      const gia = omonima(d, dati.titolo, id);
      if (gia) return OMONIMA(gia.titolo);

      d.update(cartelleReferenti)
        .set({
          titolo: dati.titolo,
          descrizione: dati.descrizione,
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .where(eq(cartelleReferenti.id, id))
        .run();
      return { ok: true as const };
    });
  } catch (errore) {
    solleva("documenti-referenti-store.modificaCartellaReferenti", errore);
  }
}

/**
 * Sposta una cartella di un posto. Come in `cartelle-store.ts`, **rinumera
 * tutto** da uno invece di scambiare due numeri: due righe con lo stesso
 * `ordine` renderebbero lo scambio un clic che non sposta niente.
 */
export async function spostaCartellaReferenti(id: number, verso: "su" | "giu"): Promise<boolean> {
  try {
    return transazione((d) => {
      const elenco = d
        .select({ id: cartelleReferenti.id })
        .from(cartelleReferenti)
        .orderBy(asc(cartelleReferenti.ordine), asc(cartelleReferenti.id))
        .all();
      const i = elenco.findIndex((c) => c.id === id);
      if (i === -1) return false;

      const j = verso === "su" ? i - 1 : i + 1;
      if (j >= 0 && j < elenco.length) [elenco[i], elenco[j]] = [elenco[j], elenco[i]];

      elenco.forEach((c, posto) => {
        d.update(cartelleReferenti).set({ ordine: posto + 1 }).where(eq(cartelleReferenti.id, c.id)).run();
      });
      return true;
    });
  } catch (errore) {
    solleva("documenti-referenti-store.spostaCartellaReferenti", errore);
  }
}

/**
 * Elimina una cartella **vuota**. Con dei documenti dentro non si elimina:
 * cancellarli insieme vorrebbe dire cancellare dei file con un clic dato per
 * togliere un nome da un elenco. Lo impedisce anche la chiave esterna.
 */
export async function eliminaCartellaReferenti(id: number): Promise<Esito> {
  try {
    return transazione((d) => {
      const trovata = d.select({ id: cartelleReferenti.id }).from(cartelleReferenti).where(eq(cartelleReferenti.id, id)).get();
      if (!trovata) return { ok: false as const, errore: "Questa cartella non esiste più." };

      const dentro =
        d
          .select({ n: sql<number>`count(*)` })
          .from(tabella)
          .where(eq(tabella.cartellaId, id))
          .get()?.n ?? 0;
      if (dentro > 0) {
        return {
          ok: false as const,
          errore:
            `Contiene ${dentro} ${dentro === 1 ? "documento" : "documenti"}: spostateli in ` +
            "un’altra cartella o eliminateli, poi eliminate la cartella.",
        };
      }

      d.delete(cartelleReferenti).where(eq(cartelleReferenti.id, id)).run();
      return { ok: true as const };
    });
  } catch (errore) {
    solleva("documenti-referenti-store.eliminaCartellaReferenti", errore);
  }
}

// --------------------------------------------------------------------------
// Documenti
// --------------------------------------------------------------------------

/**
 * Il nome del file sul disco: il prefisso, l'istante e **otto cifre a caso**.
 *
 * Il titolo non c'entra, al contrario dei documenti pubblici: il nome finisce
 * nell'indirizzo da cui il file si scarica, e un titolo come «Verbale CoCa —
 * caso del ragazzo X» non deve comparire nei log del proxy. Le cifre a caso
 * evitano che due file dello stesso invio si sovrascrivano sul disco prima che
 * la transazione scopra il doppione.
 */
function nomeFile(adesso: number, estensione: string): string {
  return `referenti-${adesso}-${randomBytes(4).toString("hex")}.${estensione}`;
}

/**
 * Aggiunge un documento con il suo file. Rifiuta, con la frase da mostrare, un
 * formato che non è fra quelli ammessi o un file che non è quello che dice.
 */
export async function aggiungiDocumentoReferenti(
  dati: { cartellaId: number; titolo: string; nota: string },
  contenuto: Buffer,
  nomeOriginale: string,
  opzioni: { adesso: number; autore: string },
): Promise<Esito<{ id: number }>> {
  const riconosciuto = riconosciFormato(nomeOriginale, contenuto);
  if (!riconosciuto.ok) return { ok: false, campo: "file", errore: riconosciuto.errore };

  const file = nomeFile(opzioni.adesso, riconosciuto.definizione.estensione);
  await scriviCaricato(file, contenuto);

  let esito: Esito<{ id: number }>;
  try {
    esito = transazione((d) => {
      const cartella = d
        .select({ id: cartelleReferenti.id })
        .from(cartelleReferenti)
        .where(eq(cartelleReferenti.id, dati.cartellaId))
        .get();
      if (!cartella) return { ok: false as const, errore: "Questa cartella non esiste più." };

      const adesso = adessoIso();
      const { id } = d
        .insert(tabella)
        .values({
          cartellaId: dati.cartellaId,
          titolo: dati.titolo,
          nota: dati.nota,
          formato: riconosciuto.definizione.formato,
          byte: contenuto.length,
          file,
          caricatoIl: adesso,
          aggiornatoIl: adesso,
          autoreId: idAutore(d, opzioni.autore),
        })
        .returning({ id: tabella.id })
        .get();
      return { ok: true as const, id };
    });
  } catch (errore) {
    // la riga non c'è: si porta via il file appena scritto
    await cancellaCaricato(file);
    solleva("documenti-referenti-store.aggiungiDocumentoReferenti", errore);
  }

  if (!esito.ok) await cancellaCaricato(file);
  return esito;
}

/** Titolo, nota e cartella. Il file resta quello che è. */
export async function modificaDocumentoReferenti(
  id: number,
  dati: { titolo: string; nota: string; cartellaId: number },
  autore: string,
): Promise<Esito> {
  try {
    return transazione((d) => {
      const trovato = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.id, id)).get();
      if (!trovato) return { ok: false as const, errore: "Questo documento non esiste più." };

      const cartella = d
        .select({ id: cartelleReferenti.id })
        .from(cartelleReferenti)
        .where(eq(cartelleReferenti.id, dati.cartellaId))
        .get();
      if (!cartella) {
        return { ok: false as const, campo: "cartella", errore: "Quella cartella non esiste più." };
      }

      d.update(tabella)
        .set({
          titolo: dati.titolo,
          nota: dati.nota,
          cartellaId: dati.cartellaId,
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .where(eq(tabella.id, id))
        .run();
      return { ok: true as const };
    });
  } catch (errore) {
    solleva("documenti-referenti-store.modificaDocumentoReferenti", errore);
  }
}

/**
 * Sostituisce il file di un documento con una versione nuova: il verbale
 * corretto, il foglio aggiornato. Titolo, nota e cartella restano; la data di
 * caricamento diventa quella di oggi, perché è la data della versione che si
 * scarica. Il file vecchio si cancella **dopo** che la riga punta al nuovo.
 */
export async function sostituisciFileReferenti(
  id: number,
  contenuto: Buffer,
  nomeOriginale: string,
  opzioni: { adesso: number; autore: string },
): Promise<Esito> {
  const riconosciuto = riconosciFormato(nomeOriginale, contenuto);
  if (!riconosciuto.ok) return { ok: false, campo: "file", errore: riconosciuto.errore };

  const file = nomeFile(opzioni.adesso, riconosciuto.definizione.estensione);
  await scriviCaricato(file, contenuto);

  let esito: Esito<{ vecchio: string }>;
  try {
    esito = transazione((d) => {
      const trovato = d.select({ file: tabella.file }).from(tabella).where(eq(tabella.id, id)).get();
      if (!trovato) return { ok: false as const, errore: "Questo documento non esiste più." };

      const adesso = adessoIso();
      d.update(tabella)
        .set({
          formato: riconosciuto.definizione.formato,
          byte: contenuto.length,
          file,
          caricatoIl: adesso,
          aggiornatoIl: adesso,
          autoreId: idAutore(d, opzioni.autore),
        })
        .where(eq(tabella.id, id))
        .run();
      return { ok: true as const, vecchio: trovato.file };
    });
  } catch (errore) {
    await cancellaCaricato(file);
    solleva("documenti-referenti-store.sostituisciFileReferenti", errore);
  }

  if (!esito.ok) {
    await cancellaCaricato(file);
    return esito;
  }
  await cancellaCaricato(esito.vecchio);
  return { ok: true };
}

/** Elimina un documento e il suo file. `null` se non c'era; altrimenti il titolo. */
export async function eliminaDocumentoReferenti(id: number): Promise<string | null> {
  let tolto: { file: string; titolo: string } | undefined;
  try {
    tolto = transazione((d) =>
      d.delete(tabella).where(eq(tabella.id, id)).returning({ file: tabella.file, titolo: tabella.titolo }).get(),
    );
  } catch (errore) {
    solleva("documenti-referenti-store.eliminaDocumentoReferenti", errore);
  }
  if (!tolto) return null;
  // la riga è andata: il file, se restasse, non lo servirebbe più nessuno
  await cancellaCaricato(tolto.file);
  return tolto.titolo;
}
