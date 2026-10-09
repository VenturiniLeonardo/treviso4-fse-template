import { eq } from "drizzle-orm";
import { cache } from "react";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { haColonna } from "@/lib/db/colonne";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { immagini as tabella, utenti } from "@/lib/db/schema";
import { leggiUnita } from "@/lib/unita-store";
import { type Slot, SLOT, slotDi, ritrattiDei } from "@/lib/slot-immagini";

/**
 * Le immagini dei posti fissi del disegno: lettura e scrittura.
 *
 * Il catalogo dei posti sta in `lib/slot-immagini.ts`; qui c'è solo che cosa è
 * stato caricato dove. Le due cose sono separate perché hanno vite diverse: un
 * posto esiste finché una pagina ha quel buco, un'immagine esiste finché
 * qualcuno non ne carica un'altra.
 */

/** Quello che serve a una `<img>` per non far sobbalzare la pagina. */
export interface Immagine {
  chiave: string;
  file: string;
  tipo: string;
  larghezza: number;
  altezza: number;
  /** vuota quando l'immagine è decorativa, che è il caso normale */
  descrizione: string;
  /**
   * Nascosta: il file e la riga restano, ma il sito non la mostra. Le pagine
   * pubbliche non la vedono mai — leggono `immaginiCaricate`, che le toglie —;
   * l'area sì, con `tutteLeImmagini`, perché chi gestisce il posto deve poterla
   * rimettere o eliminare.
   */
  nascosta: boolean;
}

/**
 * I posti del disegno **adesso**: quelli fissi del codice, e i ritratti dei referenti
 * che ci sono davvero.
 *
 * Il catalogo statico (`SLOT`) conosce solo i nomi di `lib/data.ts`. Con la
 * sezione «Referenti» un referente si aggiunge o si sposta, e il suo ritratto ha bisogno
 * di un posto: questo è l'elenco aggiornato. Il resto del codice che non ha una
 * ragione per saperlo continua a usare `slotDi`.
 */
export const slotVivi = cache(async (): Promise<Slot[]> => {
  const unita = await leggiUnita();
  return [...SLOT.filter((s) => !s.persona), ...ritrattiDei(unita)];
});

/** Il posto con questa chiave, fra quelli di adesso. */
export async function slotViviDi(chiave: string): Promise<Slot | undefined> {
  return (await slotVivi()).find((s) => s.chiave === chiave) ?? slotDi(chiave);
}

/**
 * Tutte le immagini caricate, per chiave — anche quelle nascoste. Per l'area.
 *
 * `cache` di React: una pagina che mostra quattro riquadri interroga il
 * database una volta sola per richiesta. Senza, la home ne farebbe quattro —
 * ed è la stessa ragione per cui gli altri store la usano.
 *
 * Una mappa e non un elenco perché chi chiama cerca sempre per chiave: è il
 * riquadro che sa quale immagine vuole, non il contrario.
 */
export const tutteLeImmagini = cache(async (): Promise<Map<string, Immagine>> => {
  const d = dbSeEsiste();
  // senza database — la compilazione di una pagina prima delle migrazioni — non
  // ci sono immagini: i riquadri restano vuoti, che è uno stato previsto
  if (!d) return new Map();

  try {
    const righe = d
      .select({
        chiave: tabella.chiave,
        file: tabella.file,
        tipo: tabella.tipo,
        larghezza: tabella.larghezza,
        altezza: tabella.altezza,
        descrizione: tabella.descrizione,
        // 0021: prima della migrazione la colonna non c'è, e nessuna è nascosta
        ...(haColonna(d, "immagini", "nascosta") ? { nascosta: tabella.nascosta } : {}),
      })
      .from(tabella)
      .all() as {
      chiave: string;
      file: string;
      tipo: string;
      larghezza: number;
      altezza: number;
      descrizione: string | null;
      nascosta?: number;
    }[];

    const posti = new Set((await slotVivi()).map((s) => s.chiave));
    return new Map(
      righe
        // una riga la cui chiave non è più un posto del disegno non si mostra:
        // il riquadro non c'è più, e mostrarla vorrebbe dire indovinare dove
        .filter((r) => posti.has(r.chiave))
        .map((r) => [
          r.chiave,
          { ...r, descrizione: r.descrizione ?? "", nascosta: r.nascosta === 1 },
        ]),
    );
  } catch (errore) {
    solleva("immagini-store.tutteLeImmagini", errore);
  }
});

/**
 * Le immagini che il sito mostra, per chiave: senza le nascoste. Per le pagine
 * pubbliche, che non devono nemmeno sapere che una nascosta c'è.
 */
export const immaginiCaricate = cache(async (): Promise<Map<string, Immagine>> => {
  const tutte = await tutteLeImmagini();
  return new Map([...tutte].filter(([, i]) => !i.nascosta));
});

/** L'immagine di un posto, anche nascosta, o `undefined`. Per le azioni dell'area. */
export async function immagineDi(chiave: string): Promise<Immagine | undefined> {
  return (await tutteLeImmagini()).get(chiave);
}

function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return (
    d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null
  );
}

/**
 * Registra l'immagine di un posto, sostituendo quella che c'era.
 *
 * Restituisce il nome del file **precedente**, se ce n'era uno: chi chiama lo
 * porta via dall'archivio dopo che la riga è stata scritta. Nell'ordine
 * inverso — cancellare prima, scrivere dopo — un errore in mezzo lascerebbe una
 * riga che nomina un file che non c'è, cioè un riquadro rotto invece che vuoto.
 */
export async function registraImmagine(
  chiave: string,
  file: string,
  tipo: string,
  misure: { larghezza: number; altezza: number },
  descrizione: string,
  autore: string,
): Promise<string | null> {
  // un posto inventato non entra: la chiave arriva da un modulo, e un modulo si
  // può riscrivere. È lo stesso controllo che `unitaDelModulo` fa sull'unità.
  if (!(await slotViviDi(chiave))) return null;

  try {
    return transazione((d) => {
      const precedente =
        d.select({ file: tabella.file }).from(tabella).where(eq(tabella.chiave, chiave)).get()
          ?.file ?? null;

      d.insert(tabella)
        .values({
          chiave,
          file,
          tipo,
          larghezza: misure.larghezza,
          altezza: misure.altezza,
          descrizione: descrizione.trim() || null,
          caricataIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .onConflictDoUpdate({
          target: tabella.chiave,
          set: {
            file,
            tipo,
            larghezza: misure.larghezza,
            altezza: misure.altezza,
            descrizione: descrizione.trim() || null,
            caricataIl: adessoIso(),
            autoreId: idAutore(d, autore),
            // un'immagine nuova nel posto si vede: nascosta era quella di prima
            ...(haColonna(d, "immagini", "nascosta") ? { nascosta: 0 } : {}),
          },
        })
        .run();

      return precedente === file ? null : precedente;
    });
  } catch (errore) {
    solleva("immagini-store.registraImmagine", errore);
  }
}

/**
 * Toglie l'immagine da un posto. Restituisce il file da portare via.
 *
 * Il riquadro torna vuoto, che è uno stato che le pagine sanno mostrare — non
 * un'immagine mancante.
 */
export async function togliImmagine(chiave: string): Promise<string | null> {
  try {
    return transazione((d) => {
      const riga = d
        .select({ file: tabella.file })
        .from(tabella)
        .where(eq(tabella.chiave, chiave))
        .get();
      if (!riga) return null;
      d.delete(tabella).where(eq(tabella.chiave, chiave)).run();
      return riga.file;
    });
  } catch (errore) {
    solleva("immagini-store.togliImmagine", errore);
  }
}

/**
 * Nasconde l'immagine di un posto, o la rimette. Vero se il posto ne aveva una.
 *
 * Nascondere non tocca il file: il riquadro torna vuoto sul sito, e chi gestisce
 * il posto la ritrova nell'area com'era. È il modo in cui il social media
 * manager toglie una fotografia, perché eliminarle non è suo (6 ottobre 2026).
 * Chi decide chi può fare che cosa sono le azioni; qui si scrive e basta.
 */
export async function nascondiImmagine(chiave: string, nascosta: boolean): Promise<boolean> {
  try {
    return transazione((d) => {
      if (!haColonna(d, "immagini", "nascosta")) return false;
      return (
        d
          .update(tabella)
          .set({ nascosta: nascosta ? 1 : 0 })
          .where(eq(tabella.chiave, chiave))
          .run().changes > 0
      );
    });
  } catch (errore) {
    solleva("immagini-store.nascondiImmagine", errore);
  }
}

/**
 * Le misure di un file, se una riga lo nomina.
 *
 * È la sola porta della rotta che le serve: nessun altro file dell'archivio
 * esce da lì, nemmeno indovinandone il nome. Stessa regola di
 * `copertinaRegistrata`.
 */
export async function immagineRegistrata(
  nome: string,
): Promise<{ tipo: string; larghezza: number; altezza: number; chiave: string; nascosta: boolean } | null> {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const riga = d
      .select({
        tipo: tabella.tipo,
        larghezza: tabella.larghezza,
        altezza: tabella.altezza,
        chiave: tabella.chiave,
        ...(haColonna(d, "immagini", "nascosta") ? { nascosta: tabella.nascosta } : {}),
      })
      .from(tabella)
      .where(eq(tabella.file, nome))
      .get() as
      | { tipo: string; larghezza: number; altezza: number; chiave: string; nascosta?: number }
      | undefined;
    return riga ? { ...riga, nascosta: riga.nascosta === 1 } : null;
  } catch (errore) {
    solleva("immagini-store.immagineRegistrata", errore);
  }
}

/** I nomi che il database si aspetta in archivio. Serve a `db:orfani`. */
export function fileImmaginiRegistrati(): string[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return d
      .select({ file: tabella.file })
      .from(tabella)
      .all()
      .map((r) => r.file);
  } catch {
    return [];
  }
}
