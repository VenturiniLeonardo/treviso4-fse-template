import { and, asc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { cancellaCaricato, leggiCaricato, scriviCaricato } from "@/lib/archivio";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { foto as tabellaFoto, lavori as tabella } from "@/lib/db/schema";
import { ErroreDerivate, generaDerivate, LATI, nomeDerivata } from "@/lib/foto/derivate";

/**
 * La coda delle derivate. Una tabella, un esecutore, nessun servizio esterno.
 *
 * §8 del piano: «un solo esecutore, dentro il processo Next, smaltisce la coda
 * una alla volta… Un solo esecutore non è una limitazione da superare: è ciò
 * che tiene il picco di memoria dentro il tetto di 700 MB». Con `sharp`, una
 * fotografia da dodici megapixel occupa una cinquantina di megabyte mentre la
 * si decodifica; quattro in parallelo sono duecento, e su una macchina da 2 GB
 * che regge anche il sito pubblico è la differenza fra lento e morto.
 *
 * «Una alla volta» qui vuol dire davvero una: c'è una sola catena di promesse
 * (`inCorso`), e chi chiama `avvia()` mentre gira non ne apre una seconda.
 *
 * ## Che cosa succede se il processo muore a metà
 *
 * I lavori non completati sono ancora nella tabella, in stato `in_corso`.
 * `riprendiInterrotti()` li rimette in attesa all'avvio, **senza** azzerare il
 * contatore dei tentativi: se è una fotografia che fa cadere il processo — un
 * file enorme, una decodifica che va in memoria — dopo tre giri finisce in
 * errore invece di riavviare il server all'infinito. È la protezione che serve
 * più di quella contro l'errore ordinario.
 *
 * Modulo di solo server.
 */

/** Tre tentativi, come dice §8 — ed è il `CHECK` della tabella a garantirlo. */
export const TENTATIVI_MAX = 3;

const ADESSO = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`;

// --------------------------------------------------------------------------
// Mettere in coda
// --------------------------------------------------------------------------

/**
 * Mette una fotografia in coda per le derivate. Non aspetta che sia fatta.
 *
 * Chiamata dal caricamento, dentro la stessa transazione che inserisce la riga
 * `foto`: se l'inserimento si annulla, il lavoro non resta orfano.
 */
export function accodaIn(d: Parameters<Parameters<typeof transazione>[0]>[0], fotoId: number) {
  d.insert(tabella).values({ tipo: "foto", fotoId, stato: "in_attesa" }).run();
}

/**
 * Mette in coda tutte le fotografie che non hanno ancora le derivate.
 *
 * Serve due volte: all'avvio, per le fotografie caricate prima della fase 7 —
 * che sul disco ci sono, con dentro i loro metadati — e dopo un ripristino, se
 * i file delle derivate si sono persi ma le righe no.
 *
 * Non accoda quelle che hanno già un lavoro aperto o fallito: rimetterle in
 * coda a ogni avvio significherebbe riprovare all'infinito una fotografia
 * rovinata, che è esattamente ciò che il limite di tre tentativi impedisce.
 */
export function accodaMancanti(): number {
  const d = dbSeEsiste();
  if (!d) return 0;
  try {
    return transazione((dd) => {
      const gia = dd
        .select({ id: tabella.fotoId })
        .from(tabella)
        .where(notInArray(tabella.stato, ["fatto"]))
        .all()
        .map((r) => r.id)
        .filter((x): x is number => x !== null);

      const senza = dd
        .select({ id: tabellaFoto.id })
        .from(tabellaFoto)
        .where(isNull(tabellaFoto.derivateIl))
        .all()
        .map((r) => r.id)
        .filter((id) => !gia.includes(id));

      for (const id of senza) accodaIn(dd, id);
      return senza.length;
    });
  } catch (errore) {
    solleva("coda.accodaMancanti", errore);
  }
}

/** Perché un lavoro interrotto tre volte non si riprova più. */
const MOTIVO_INTERROTTO =
  "Il server si è fermato tre volte mentre convertiva questa fotografia: potrebbe essere " +
  "lei a fermarlo. Controllatela, poi riprovate dall'elenco dei lavori falliti.";

/**
 * Rimette in attesa i lavori rimasti `in_corso` da un processo morto.
 *
 * Il contatore dei tentativi **non** si azzera: vedi la nota in cima al file.
 * E un lavoro che i tentativi li ha già finiti **non** torna in attesa: va in
 * errore. Fino al 3 ottobre 2026 ci tornava, e la nota in cima al file
 * prometteva una cosa che il codice non faceva — alla presa successiva il
 * contatore passava a quattro, il `CHECK` `lavori_tentativi` rifiutava
 * l'aggiornamento, e lo smaltimento si fermava **per tutte** le fotografie,
 * non per quella. Bastavano tre riavvii a metà conversione: un rilascio, una
 * `verifica` sotto un `next dev`.
 */
export function riprendiInterrotti(): number {
  const d = dbSeEsiste();
  if (!d) return 0;
  try {
    return transazione((dd) => {
      dd.update(tabella)
        .set({ stato: "errore", motivo: MOTIVO_INTERROTTO, finitoIl: ADESSO, iniziatoIl: null })
        .where(and(eq(tabella.stato, "in_corso"), gte(tabella.tentativi, TENTATIVI_MAX)))
        .run();
      return dd
        .update(tabella)
        .set({ stato: "in_attesa", iniziatoIl: null })
        .where(eq(tabella.stato, "in_corso"))
        .run().changes;
    });
  } catch (errore) {
    solleva("coda.riprendiInterrotti", errore);
  }
}

// --------------------------------------------------------------------------
// L'esecutore
// --------------------------------------------------------------------------

/** La catena in corso, o `null` se la coda è ferma. L'unico stato del modulo. */
let inCorso: Promise<void> | null = null;

/**
 * Fa ripartire lo smaltimento, se non sta già girando.
 *
 * Non restituisce una promessa da attendere, ed è deliberato: chi carica una
 * fotografia non deve aspettare che sia stata convertita per vedere la pagina.
 * §8 dice «centocinquanta foto si smaltiscono in pochi minuti **mentre il referente
 * fa altro**». Chi vuole aspettare — le prove — usa `attendiCoda()`.
 */
export function avvia(): void {
  if (inCorso) return;
  inCorso = smaltisci().finally(() => {
    inCorso = null;
  });
  // la catena vive per conto suo: un errore qui non deve diventare un rifiuto
  // non gestito che abbatte il processo
  inCorso.catch((e) => console.error("coda foto: lo smaltimento si è fermato:", e));
}

/** Aspetta che la coda si svuoti. Per le prove e per gli script, non per le pagine. */
export async function attendiCoda(): Promise<void> {
  avvia();
  while (inCorso) await inCorso;
}

/** Prende **un** lavoro e lo marca in corso, in modo atomico. */
function prendiUnLavoro(): { id: number; fotoId: number; tentativi: number } | null {
  return transazione((d) => {
    // un lavoro in attesa con i tentativi finiti — rimesso lì da una versione
    // di `riprendiInterrotti` che non li guardava — si chiude prima di
    // sceglierne uno: preso, fermerebbe tutta la coda sul `CHECK`
    d.update(tabella)
      .set({ stato: "errore", motivo: MOTIVO_INTERROTTO, finitoIl: ADESSO })
      .where(and(eq(tabella.stato, "in_attesa"), gte(tabella.tentativi, TENTATIVI_MAX)))
      .run();

    const prossimo = d
      .select({ id: tabella.id, fotoId: tabella.fotoId })
      .from(tabella)
      .where(and(eq(tabella.stato, "in_attesa"), eq(tabella.tipo, "foto")))
      .orderBy(asc(tabella.creatoIl), asc(tabella.id))
      .limit(1)
      .get();
    if (!prossimo?.fotoId) {
      // lavoro senza fotografia: non c'è niente da fare, si chiude invece di
      // restare in coda per sempre a bloccare quelli dopo
      if (prossimo) {
        d.update(tabella)
          .set({ stato: "errore", motivo: "Lavoro senza fotografia.", finitoIl: ADESSO })
          .where(eq(tabella.id, prossimo.id))
          .run();
      }
      return null;
    }

    const riga = d
      .update(tabella)
      .set({
        stato: "in_corso",
        iniziatoIl: ADESSO,
        tentativi: sql`${tabella.tentativi} + 1`,
      })
      // il `WHERE stato = 'in_attesa'` ripetuto è ciò che rende la presa
      // atomica: se qualcuno l'avesse presa nel frattempo, `changes` è zero
      .where(and(eq(tabella.id, prossimo.id), eq(tabella.stato, "in_attesa")))
      .returning({ tentativi: tabella.tentativi })
      .get();
    if (!riga) return null;

    return { id: prossimo.id, fotoId: prossimo.fotoId, tentativi: riga.tentativi };
  });
}

/** Chiude un lavoro riuscito e aggiorna la fotografia. */
function segnaFatto(lavoroId: number, fotoId: number, larghezza: number, altezza: number) {
  transazione((d) => {
    d.update(tabellaFoto)
      .set({ larghezza, altezza, derivateIl: ADESSO })
      .where(eq(tabellaFoto.id, fotoId))
      .run();
    d.update(tabella)
      .set({ stato: "fatto", motivo: null, finitoIl: ADESSO })
      .where(eq(tabella.id, lavoroId))
      .run();
  });
}

/**
 * Chiude un lavoro fallito: in errore se ha finito i tentativi, in attesa se no.
 *
 * Il motivo si scrive **anche** quando si riprova, perché è l'unico posto in cui
 * resta scritto che cosa è andato storto la volta prima. Un lavoro che riesce
 * al terzo colpo lo azzera (`segnaFatto`).
 */
function segnaFallito(lavoroId: number, tentativi: number, motivo: string) {
  const finito = tentativi >= TENTATIVI_MAX;
  transazione((d) => {
    d.update(tabella)
      .set({
        stato: finito ? "errore" : "in_attesa",
        motivo,
        ...(finito ? { finitoIl: ADESSO } : { iniziatoIl: null }),
      })
      .where(eq(tabella.id, lavoroId))
      .run();
  });
}

/**
 * Il ciclo: prende un lavoro, lo fa, ne prende un altro. Uno alla volta.
 *
 * Non è `export` per sbaglio: si entra da `avvia()`, che è ciò che garantisce
 * l'esecutore unico. Chiamare questa direttamente ne farebbe partire due.
 */
async function smaltisci(): Promise<void> {
  if (!dbSeEsiste()) return;

  for (;;) {
    const lavoro = prendiUnLavoro();
    if (!lavoro) return;

    let misure: { larghezza: number; altezza: number };
    try {
      misure = await eseguiUno(lavoro.fotoId);
    } catch (e) {
      const motivo =
        e instanceof ErroreDerivate
          ? e.message
          : `Errore imprevisto durante la conversione: ${e instanceof Error ? e.name : "sconosciuto"}.`;
      segnaFallito(lavoro.id, lavoro.tentativi, motivo);
      console.warn(
        `coda foto: lavoro ${lavoro.id} fallito (tentativo ${lavoro.tentativi}/${TENTATIVI_MAX}):`,
        motivo,
      );
      continue;
    }
    segnaFatto(lavoro.id, lavoro.fotoId, misure.larghezza, misure.altezza);
  }
}

/**
 * Converte una fotografia e restituisce le sue misure vere. Solleva se non si può.
 *
 * Le scritture su disco stanno **fuori** da qualunque transazione, come vuole
 * §18: tenere aperta una scrittura SQLite mentre si aspetta il filesystem
 * blocca ogni altra scrittura del processo, e qui il filesystem lo si aspetta
 * per tre file.
 *
 * Se scrivere una derivata fallisce a metà, quelle già scritte restano lì. Non
 * si ripuliscono: al tentativo dopo vengono sovrascritte con lo stesso nome, e
 * un file di troppo in archivio è un problema molto minore di un file
 * cancellato mentre qualcuno lo stava servendo.
 */
async function eseguiUno(fotoId: number): Promise<{ larghezza: number; altezza: number }> {
  const d = dbSeEsiste();
  if (!d) throw new ErroreDerivate("Il database non è raggiungibile.");

  const riga = d
    .select({ file: tabellaFoto.file })
    .from(tabellaFoto)
    .where(eq(tabellaFoto.id, fotoId))
    .get();
  if (!riga) throw new ErroreDerivate("La fotografia non esiste più.");

  const originale = await leggiCaricato(riga.file);
  if (!originale) {
    throw new ErroreDerivate(`Il file «${riga.file}» non si trova nell’archivio.`);
  }

  const esito = await generaDerivate(originale, riga.file);
  for (const derivata of esito.derivate) {
    await scriviCaricato(derivata.nome, derivata.dati);
  }

  return { larghezza: esito.larghezza, altezza: esito.altezza };
}

// --------------------------------------------------------------------------
// Lettura, per l'interfaccia
// --------------------------------------------------------------------------

export interface StatoCoda {
  inAttesa: number;
  inCorso: number;
  errore: number;
}

/** Quanti lavori ci sono, per stato. L'avanzamento che §8 vuole a schermo. */
export function statoCoda(): StatoCoda {
  const d = dbSeEsiste();
  if (!d) return { inAttesa: 0, inCorso: 0, errore: 0 };
  try {
    const righe = d
      .select({ stato: tabella.stato, n: sql<number>`count(*)` })
      .from(tabella)
      .groupBy(tabella.stato)
      .all();
    const per = (s: string) => righe.find((r) => r.stato === s)?.n ?? 0;
    return { inAttesa: per("in_attesa"), inCorso: per("in_corso"), errore: per("errore") };
  } catch {
    // l'avanzamento è un'informazione in più: se il database non risponde, la
    // schermata deve mostrare il resto, non un errore
    return { inAttesa: 0, inCorso: 0, errore: 0 };
  }
}

export interface LavoroFallito {
  id: number;
  file: string;
  motivo: string;
  tentativi: number;
}

/** I lavori che hanno esaurito i tentativi, con il perché. */
export function lavoriFalliti(): LavoroFallito[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return d
      .select({
        id: tabella.id,
        file: tabellaFoto.file,
        motivo: tabella.motivo,
        tentativi: tabella.tentativi,
      })
      .from(tabella)
      .innerJoin(tabellaFoto, eq(tabella.fotoId, tabellaFoto.id))
      .where(eq(tabella.stato, "errore"))
      .orderBy(asc(tabella.id))
      .all()
      .map((r) => ({ ...r, motivo: r.motivo ?? "Motivo non registrato." }));
  } catch {
    return [];
  }
}

/**
 * Rimette in coda un lavoro fallito, azzerando i tentativi.
 *
 * Qui l'azzeramento è giusto, al contrario di `riprendiInterrotti`: è una
 * persona che ha guardato il motivo e ha deciso di riprovare, magari dopo aver
 * rimesso a posto il file. Un ciclo infinito richiede qualcuno che prema un
 * pulsante all'infinito.
 */
export function riprova(lavoroId: number, albumId?: number): boolean {
  try {
    const fatto = transazione(
      (d) =>
        d
          .update(tabella)
          .set({ stato: "in_attesa", tentativi: 0, motivo: null, finitoIl: null })
          .where(
            and(
              eq(tabella.id, lavoroId),
              eq(tabella.stato, "errore"),
              // Con l'album, il lavoro deve essere di una sua fotografia: l'id
              // arriva dal modulo, e il permesso chi chiama l'ha verificato
              // sull'album, non sul lavoro (audit di sicurezza, AUTHZ-03).
              albumId === undefined
                ? undefined
                : inArray(
                    tabella.fotoId,
                    d
                      .select({ id: tabellaFoto.id })
                      .from(tabellaFoto)
                      .where(eq(tabellaFoto.albumId, albumId)),
                  ),
            ),
          )
          .run().changes > 0,
    );
    if (fatto) avvia();
    return fatto;
  } catch (errore) {
    solleva("coda.riprova", errore);
  }
}

/** Toglie le derivate di una fotografia cancellata. */
export async function cancellaDerivate(file: string): Promise<void> {
  for (const lato of LATI) await cancellaCaricato(nomeDerivata(file, lato));
}
