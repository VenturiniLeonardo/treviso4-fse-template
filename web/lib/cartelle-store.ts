import { asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { CARTELLA_CIRCOLARI, type Cartella, inIndirizzo } from "@/lib/contenuti";
import { CATEGORIE_DOC } from "@/lib/data";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { cartelle as tabella, documenti, utenti } from "@/lib/db/schema";

/**
 * Le cartelle della pagina Documenti: «Tesseramenti», «Campi estivi», e le sei con
 * cui il sito è nato.
 *
 * Modulo di solo server. Le cartelle le decidono i gestori dall'area
 * riservata — è la richiesta del 25 settembre 2026: aprire «Tesseramenti» e
 * trovarci tutti i moduli, senza che per una cartella nuova serva un rilascio.
 *
 * ## Non segue la regola delle differenze, e va detto
 *
 * Gli altri store del CMS conservano solo ciò che i referenti hanno cambiato, e per
 * il resto leggono `lib/data.ts`. Qui non si può: `documenti.categoria` è una
 * chiave esterna su `cartelle.chiave`, quindi ogni cartella in cui sta un
 * documento **deve** essere una riga. La migrazione 0012 scrive le sei di
 * partenza; da lì la tabella è la verità, e `CATEGORIE_DOC` resta il ripiego per
 * quando il database non c'è — in compilazione.
 *
 * ## L'indirizzo non cambia
 *
 * `chiave` si ricava dal nome alla creazione e poi resta: è `/documenti/<chiave>`,
 * cioè il collegamento che un referente manda alle famiglie. Rinominare «Campi e
 * uscite» in «Campi estivi» cambia il titolo in pagina, non l'indirizzo. È la
 * stessa regola degli album.
 */

/** Le sei cartelle con cui il sito è nato: il codice rimanda a loro. */
const DI_PARTENZA = new Set(CATEGORIE_DOC.map((c) => c.chiave));

/**
 * Vero per le sei di partenza, che si rinominano ma non si eliminano.
 *
 * Il codice le nomina: il piede del sito porta a `/documenti/statuti` e a
 * `/documenti/quote`, e `documenti_circolari_hanno_unita` confronta la categoria
 * con `circolari`. Una cartella vuota non compare in pagina, quindi eliminarla
 * non servirebbe a niente di visibile — e renderebbe un collegamento del piede
 * una pagina che non esiste.
 */
export const eDiPartenza = (chiave: string): boolean => DI_PARTENZA.has(chiave);

/** Le sei di partenza, nella forma di `Cartella`. */
function dalCodice(): Cartella[] {
  return CATEGORIE_DOC.map((c) => ({ chiave: c.chiave, titolo: c.label, descrizione: "" }));
}

/**
 * Vero se la tabella c'è. Una volta vista, non si richiede più: non sparisce.
 *
 * ## Perché chiederselo
 *
 * Per il rilascio. `rilascio.md` compila il pacchetto nuovo **sul server, prima
 * delle migrazioni** — se la compilazione fallisce non si è toccato niente — e
 * la compilazione legge il database in esercizio per prerenderizzare le pagine
 * pubbliche. Al rilascio delle cartelle quel database non ha ancora `cartelle`:
 * senza questo controllo `/documenti` falliva la compilazione con «no such
 * table», e l'unica via era invertire due passi del runbook.
 *
 * Le sei di partenza sono esattamente quello che la migrazione scriverà, quindi
 * la pagina prerenderizzata in quella finestra dice il vero anche dopo. Il
 * registro lo annota, perché lo stesso ripiego a servizio avviato vorrebbe dire
 * una migrazione dimenticata.
 */
let tabellaVista = false;
let avvisato = false;

function tabellaPresente(d: Handle): boolean {
  if (tabellaVista) return true;
  tabellaVista = Boolean(
    d.$client.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cartelle'").get(),
  );
  // una riga sola per processo: la compilazione rende una decina di pagine
  if (!tabellaVista && !avvisato) {
    avvisato = true;
    console.warn(
      "cartelle: la tabella non c'è ancora (migrazione 0012 non applicata): " +
        "servo le sei cartelle di partenza. Durante la compilazione è normale; a servizio " +
        "avviato vuol dire che manca «npm run db:applica».",
    );
  }
  return tabellaVista;
}

/** Tutte le cartelle, nell'ordine deciso dai referenti. `cache` lega la lettura alla richiesta. */
export const leggiCartelle = cache(async (): Promise<Cartella[]> => {
  const d = dbSeEsiste();
  // niente database: si servono le sei di partenza. Succede in compilazione,
  // dove la pagina /documenti viene prerenderizzata.
  if (!d) return dalCodice();

  try {
    if (!tabellaPresente(d)) return dalCodice();
    return d
      .select({
        chiave: tabella.chiave,
        titolo: tabella.titolo,
        descrizione: tabella.descrizione,
      })
      .from(tabella)
      .orderBy(asc(tabella.ordine), asc(tabella.id))
      .all();
  } catch (errore) {
    solleva("cartelle-store.leggiCartelle", errore);
  }
});

export async function cartellaPerChiave(chiave: string): Promise<Cartella | undefined> {
  return (await leggiCartelle()).find((c) => c.chiave === chiave);
}

// --------------------------------------------------------------------------
// Scrittura
// --------------------------------------------------------------------------

export type EsitoCartella =
  | { ok: true; chiave: string }
  | { ok: false; errore: string; campo?: string };

/** L'id dell'utente dal nome, o `null`: come negli altri store. */
function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null;
}

/**
 * L'indirizzo di una cartella a partire dal nome.
 *
 * Più corto dei settanta caratteri di `inIndirizzo`: sta in un collegamento da
 * incollare in una chat di genitori. Tagliare può lasciare un trattino in coda,
 * e un indirizzo che finisce con un trattino si legge come un refuso.
 */
export const chiaveDaTitolo = (titolo: string): string =>
  inIndirizzo(titolo).slice(0, 50).replace(/-+$/, "");

export async function creaCartella(
  dati: { titolo: string; descrizione: string },
  autore: string,
): Promise<EsitoCartella> {
  const chiave = chiaveDaTitolo(dati.titolo);
  if (!chiave) {
    return {
      ok: false,
      campo: "titolo",
      errore: "Il nome deve contenere almeno una lettera o una cifra.",
    };
  }

  try {
    return transazione((d) => {
      /*
       * Due nomi diversi possono dare lo stesso indirizzo: «Campi» è
       * `/documenti/campi`, che è già l'indirizzo della cartella di partenza
       * «Campi e uscite». Il messaggio nomina la cartella che c'è già, perché
       * «esiste già» detto di un nome che nessuno ha ancora usato non si
       * capisce.
       */
      const esiste = d
        .select({ titolo: tabella.titolo })
        .from(tabella)
        .where(eq(tabella.chiave, chiave))
        .get();
      if (esiste) {
        return {
          ok: false as const,
          campo: "titolo",
          errore: `C’è già la cartella «${esiste.titolo}», con lo stesso indirizzo: scegliete un nome diverso.`,
        };
      }

      const ultimo =
        d
          .select({ n: sql<number>`coalesce(max(${tabella.ordine}), 0)` })
          .from(tabella)
          .get()?.n ?? 0;

      d.insert(tabella)
        .values({
          chiave,
          titolo: dati.titolo,
          descrizione: dati.descrizione,
          // in fondo: chi la crea la sposta dove vuole
          ordine: ultimo + 1,
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .run();
      return { ok: true as const, chiave };
    });
  } catch (errore) {
    solleva("cartelle-store.creaCartella", errore);
  }
}

/** Nome e descrizione. L'indirizzo resta quello di prima. `false` se non esiste. */
export async function modificaCartella(
  chiave: string,
  dati: { titolo: string; descrizione: string },
  autore: string,
): Promise<boolean> {
  try {
    return transazione((d) => {
      const trovata = d
        .select({ id: tabella.id })
        .from(tabella)
        .where(eq(tabella.chiave, chiave))
        .get();
      if (!trovata) return false;

      d.update(tabella)
        .set({
          titolo: dati.titolo,
          descrizione: dati.descrizione,
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .where(eq(tabella.id, trovata.id))
        .run();
      return true;
    });
  } catch (errore) {
    solleva("cartelle-store.modificaCartella", errore);
  }
}

/**
 * Sposta una cartella di un posto, verso l'alto o verso il basso.
 *
 * Non scambia due numeri: **rinumera tutto** da uno. Due cartelle con lo stesso
 * `ordine` — basta una riga scritta a mano — renderebbero lo scambio un'azione
 * che non sposta niente, e il pulsante sembrerebbe rotto. Sono poche righe, e
 * la rinumerazione le rimette in fila a ogni clic.
 */
export async function spostaCartella(chiave: string, verso: "su" | "giu"): Promise<boolean> {
  try {
    return transazione((d) => {
      const elenco = d
        .select({ id: tabella.id, chiave: tabella.chiave })
        .from(tabella)
        .orderBy(asc(tabella.ordine), asc(tabella.id))
        .all();
      const i = elenco.findIndex((c) => c.chiave === chiave);
      if (i === -1) return false;

      const j = verso === "su" ? i - 1 : i + 1;
      // già in cima o già in fondo: non è un errore, non c'è niente da fare
      if (j >= 0 && j < elenco.length) [elenco[i], elenco[j]] = [elenco[j], elenco[i]];

      elenco.forEach((c, posto) => {
        d.update(tabella)
          .set({ ordine: posto + 1 })
          .where(eq(tabella.id, c.id))
          .run();
      });
      return true;
    });
  } catch (errore) {
    solleva("cartelle-store.spostaCartella", errore);
  }
}

/**
 * Elimina una cartella **vuota**.
 *
 * Una cartella con dentro dei documenti non si elimina, e non per prudenza di
 * facciata: i documenti puntano alla cartella con una chiave esterna, e
 * cancellarli insieme vorrebbe dire cancellare dei file con un clic dato per
 * togliere un nome da un elenco. Prima si spostano o si eliminano i documenti,
 * uno per uno, sapendo che cosa si sta togliendo.
 */
export async function eliminaCartella(
  chiave: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  if (chiave === CARTELLA_CIRCOLARI || eDiPartenza(chiave)) {
    return {
      ok: false,
      errore:
        "È una delle cartelle con cui il sito è nato: il sito vi rimanda, quindi si " +
        "può rinominare ma non eliminare. Finché è vuota, in pagina non compare.",
    };
  }

  try {
    return transazione((d) => {
      const trovata = d
        .select({ id: tabella.id })
        .from(tabella)
        .where(eq(tabella.chiave, chiave))
        .get();
      if (!trovata) return { ok: false as const, errore: "Questa cartella non esiste più." };

      const dentro =
        d
          .select({ n: sql<number>`count(*)` })
          .from(documenti)
          .where(eq(documenti.categoria, chiave))
          .get()?.n ?? 0;
      if (dentro > 0) {
        return {
          ok: false as const,
          errore:
            `Contiene ${dentro} ${dentro === 1 ? "documento" : "documenti"}: spostateli in ` +
            "un’altra cartella o eliminateli, poi eliminate la cartella.",
        };
      }

      d.delete(tabella).where(eq(tabella.id, trovata.id)).run();
      return { ok: true as const };
    });
  } catch (errore) {
    solleva("cartelle-store.eliminaCartella", errore);
  }
}
