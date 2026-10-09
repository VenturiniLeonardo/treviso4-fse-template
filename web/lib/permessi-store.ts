import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { permessi as tabella } from "@/lib/db/schema";
import {
  type Funzione,
  FUNZIONI_INIZIALI,
  type Livello,
  livelloEffettivo,
  RUOLI_MATRICE,
} from "@/lib/permessi";

/**
 * Lettura e scrittura della matrice dei permessi. Modulo di solo server.
 *
 * Prima stava in `dati/permessi.json`, riscritto per intero a ogni modifica. Ora
 * sta nella tabella `permessi`, una riga per coppia (funzione, ruolo): è la forma
 * che serve al cancello autorizzativo, che interroga
 * `WHERE funzione = ? AND ruolo = ?`.
 *
 * **La firma pubblica non è cambiata.** `leggiMatrice` restituisce le stesse
 * `Funzione[]` di prima, con lo stesso ordine e gli stessi `livelli`; le quattro
 * scritture restituiscono lo stesso `boolean`. I tre consumer — la pagina di
 * sezione, le azioni, l'esportazione CSV — non sono stati toccati.
 *
 * Due comportamenti del vecchio archivio conservati di proposito:
 *
 *  - **il seme non si scrive finché nessuno modifica niente.** Con il JSON, un
 *    sito appena installato non aveva il file e leggeva `FUNZIONI_INIZIALI`. Qui
 *    è lo stesso: se la tabella è vuota, la lettura restituisce il seme senza
 *    scrivere. Una lettura che scrive non sarebbe possibile in compilazione, dove
 *    il database può non esistere affatto.
 *  - **l'ordine è quello di `FUNZIONI_INIZIALI`**, che segue una logica di
 *    lettura e non l'alfabeto. Per questo la tabella ha la colonna `ordine`
 *    (migrazione 0001): senza `ORDER BY` la griglia si rimescolerebbe fra due
 *    letture.
 */

/** Le tre colonne della matrice, nell'ordine in cui la schermata le disegna. */
const RUOLI = RUOLI_MATRICE.map((r) => r.chiave);

/** Livelli di una funzione appena creata: nessuno, finché non si decide chi. */
const NIENTE: Record<string, Livello> = Object.fromEntries(
  RUOLI.map((r) => [r, "nessuno" as Livello]),
);

interface Riga {
  funzione: string;
  nome: string;
  ruolo: string;
  livello: string;
  ordine: number;
}

/**
 * Raggruppa le righe in `Funzione[]`.
 *
 * Trenta righe diventano dieci funzioni. `nome` è ripetuto sulle tre righe della
 * stessa funzione — è la denormalizzazione accettata in fase 2A per non
 * aggiungere una ventiduesima tabella — e qui si prende quello della prima riga
 * incontrata.
 */
function raggruppa(righe: Riga[]): Funzione[] {
  const per = new Map<string, Funzione>();
  for (const r of righe) {
    let f = per.get(r.funzione);
    if (!f) {
      f = { id: r.funzione, nome: r.nome, livelli: {} };
      per.set(r.funzione, f);
    }
    f.livelli[r.ruolo] = r.livello as Livello;
  }
  // i ruolo mancanti valgono «nessuno»: una riga assente non deve diventare un
  // permesso aperto per distrazione
  for (const f of per.values()) {
    for (const r of RUOLI) if (!(r in f.livelli)) f.livelli[r] = "nessuno";
  }
  return sottoITetti([...per.values()]);
}

/**
 * La matrice con i tetti applicati (`tetto()` in `lib/permessi.ts`).
 *
 * La schermata mostra il livello che **vale**, non quello rimasto scritto: su
 * un'installazione nata prima dei tetti la tabella può dire «completo» per il
 * gestore alla riga `iscritti`, e una griglia che lo mostrasse direbbe una
 * cosa che il cancello non applica.
 */
function sottoITetti(funzioni: Funzione[]): Funzione[] {
  return funzioni.map((f) => ({
    ...f,
    nome: FUNZIONI_INIZIALI.find((nota) => nota.id === f.id)?.nome ?? f.nome,
    livelli: Object.fromEntries(
      Object.entries(f.livelli).map(([r, l]) => [r, livelloEffettivo(f.id, r, l)]),
    ),
  }));
}

/** Le righe che rappresentano il seme, con l'ordine di `FUNZIONI_INIZIALI`. */
function righeDelSeme(): Riga[] {
  return FUNZIONI_INIZIALI.flatMap((f, indice) =>
    RUOLI.map((ruolo) => ({
      funzione: f.id,
      nome: f.nome,
      ruolo,
      livello: f.livelli[ruolo] ?? "nessuno",
      ordine: indice,
    })),
  );
}

/**
 * La matrice. `cache` lega la lettura alla richiesta: la pagina di sezione la
 * chiede una volta, l'esportazione CSV un'altra, e nella stessa richiesta si
 * interroga il database una volta sola.
 */
export const leggiMatrice = cache(async (): Promise<Funzione[]> => {
  const d = dbSeEsiste();
  // niente database: è il caso legittimo della compilazione. Si restituisce il
  // seme, che è quello che il codice applica davvero.
  if (!d) return sottoITetti(FUNZIONI_INIZIALI);

  try {
    const righe = d
      .select({
        funzione: tabella.funzione,
        nome: tabella.nome,
        ruolo: tabella.ruolo,
        livello: tabella.livello,
        ordine: tabella.ordine,
      })
      .from(tabella)
      .orderBy(asc(tabella.ordine), asc(tabella.funzione))
      .all();

    // tabella vuota: come il file assente di prima
    return righe.length === 0 ? sottoITetti(FUNZIONI_INIZIALI) : raggruppa(righe);
  } catch (errore) {
    solleva("permessi-store.leggiMatrice", errore);
  }
});

/**
 * Materializza il seme se la tabella è vuota.
 *
 * Va chiamata **dentro** la transazione della scrittura: la prima modifica su un
 * database vuoto deve scrivere le trenta righe del seme e poi applicare il
 * cambiamento, tutto o niente. Era esattamente il comportamento del JSON, dove
 * la prima `scriviArchivio` materializzava l'elenco intero.
 */
function semina(d: Handle): void {
  const quante = d.select({ n: sql<number>`count(*)` }).from(tabella).get()?.n ?? 0;
  if (quante > 0) return;
  d.insert(tabella).values(righeDelSeme()).run();
}

/**
 * Aggiunge le righe del seme che nella tabella non ci sono. **Su richiesta.**
 *
 * Il problema che risolve: una versione nuova aggiunge una funzione — in fase 5
 * `pagine` e `archivio-anno`, in fase 8 `messaggi` — e su un'installazione dove
 * la tabella è già popolata quella riga non compare. `livelloNellaMatrice`
 * tratta una riga assente come «nessuno», quindi la funzione nuova resta chiusa
 * a tutti, in silenzio.
 *
 * **Perché non succede da sola.** Farla scattare a ogni scrittura, o a ogni
 * lettura, sarebbe comodo e sbagliato: `togliFunzione` esiste, e una funzione
 * che un amministratore ha tolto dalla matrice tornerebbe da sé alla prima
 * occasione, con i livelli del seme. Cioè un permesso chiuso apposta che si
 * riapre da solo — l'esatto contrario di quello che la fase 5 è servita a
 * garantire. Le prove lo verificano, e infatti sono state loro ad accorgersene
 * quando ci avevo provato.
 *
 * Quindi è un comando: `npm run db:permessi`, da eseguire dopo un
 * aggiornamento che porta funzioni nuove. Sta scritto nella documentazione
 * della fase, insieme alle migrazioni.
 *
 * **Non tocca le righe che ci sono.** Un livello cambiato dalla schermata resta
 * come l'hanno lasciato.
 */
export function allineaSeme(): { aggiunte: number; funzioni: string[] } {
  try {
    return transazione((d) => allineaIn(d));
  } catch (errore) {
    solleva("permessi-store.allineaSeme", errore);
  }
}

function allineaIn(d: Handle): { aggiunte: number; funzioni: string[] } {
  const presenti = new Set(
    d
      .select({ funzione: tabella.funzione, ruolo: tabella.ruolo })
      .from(tabella)
      .all()
      .map((r) => `${r.funzione}|${r.ruolo}`),
  );

  const mancanti = righeDelSeme().filter((r) => !presenti.has(`${r.funzione}|${r.ruolo}`));
  if (mancanti.length === 0) return { aggiunte: 0, funzioni: [] };

  d.insert(tabella).values(mancanti).run();
  return {
    aggiunte: mancanti.length,
    funzioni: [...new Set(mancanti.map((r) => r.funzione))],
  };
}

export async function impostaLivello(
  id: string,
  ruolo: string,
  livello: Livello,
): Promise<boolean> {
  try {
    return transazione((d) => {
      semina(d);
      const esiste = d
        .select({ funzione: tabella.funzione })
        .from(tabella)
        .where(and(eq(tabella.funzione, id), eq(tabella.ruolo, ruolo)))
        .get();
      if (!esiste) return false;

      d.update(tabella)
        .set({ livello })
        .where(and(eq(tabella.funzione, id), eq(tabella.ruolo, ruolo)))
        .run();
      return true;
    });
  } catch (errore) {
    solleva("permessi-store.impostaLivello", errore);
  }
}

export async function aggiungiFunzione(nome: string, id: string): Promise<boolean> {
  try {
    return transazione((d) => {
      semina(d);
      const esiste = d
        .select({ funzione: tabella.funzione })
        .from(tabella)
        .where(eq(tabella.funzione, id))
        .get();
      if (esiste) return false;

      // in coda: l'ordine più alto più uno
      const massimo =
        d.select({ m: sql<number | null>`max(${tabella.ordine})` }).from(tabella).get()?.m ?? -1;

      d.insert(tabella)
        .values(
          RUOLI.map((ruolo) => ({
            funzione: id,
            nome,
            ruolo,
            // prudente: una funzione nuova non la può fare nessuno finché non si
            // decide chi. Il contrario aprirebbe permessi per distrazione.
            livello: NIENTE[ruolo],
            ordine: massimo + 1,
          })),
        )
        .run();
      return true;
    });
  } catch (errore) {
    solleva("permessi-store.aggiungiFunzione", errore);
  }
}

export async function togliFunzione(id: string): Promise<boolean> {
  try {
    return transazione((d) => {
      semina(d);
      const esiste = d
        .select({ funzione: tabella.funzione })
        .from(tabella)
        .where(eq(tabella.funzione, id))
        .get();
      if (!esiste) return false;

      d.delete(tabella).where(eq(tabella.funzione, id)).run();
      return true;
    });
  } catch (errore) {
    solleva("permessi-store.togliFunzione", errore);
  }
}

/** Rimette la matrice come sta nel codice: si cancella e si riscrive. */
export async function ripristinaMatrice(): Promise<void> {
  try {
    transazione((d) => {
      d.delete(tabella).run();
      d.insert(tabella).values(righeDelSeme()).run();
    });
  } catch (errore) {
    solleva("permessi-store.ripristinaMatrice", errore);
  }
}
