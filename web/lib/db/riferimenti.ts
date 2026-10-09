import { eq, sql } from "drizzle-orm";
import { ANNI_DOC, UNITA } from "@/lib/data";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { periodoDiAnno } from "@/lib/db/mappa";
import { anniSociali, unita as tabellaUnita } from "@/lib/db/schema";

/**
 * Le due anagrafiche di riferimento: gli anni sociali e le sei unità.
 *
 * Non hanno uno store, e non ne avranno uno in questa fase: non sono contenuti
 * che i referenti creano, sono il reticolo su cui gli altri contenuti si appendono.
 * Ma `album.anno_id` e `documenti.anno_id` sono `NOT NULL` con chiave esterna,
 * quindi senza righe qui dentro `creaAlbum` e `creaDocumento` non possono
 * riuscire — e i loro test non si possono nemmeno scrivere.
 *
 * **I dati non sono inventati.** Le sei unità vengono da `UNITA` in
 * `lib/data.ts`, gli anni da `ANNI_DOC`, che porta già `chiave` (la forma
 * canonica), `label` e `corrente`. È una derivazione da costanti che esistono,
 * non un dato nuovo. Le due date di inizio e fine si ricavano dall'etichetta con
 * la convenzione dell'anno sociale dichiarata dal piano §3.
 *
 * **Non è l'importatore.** Quello — fase 10 — legge i JSON, produce un rapporto,
 * rifiuta gli account incompleti, è idempotente su due esecuzioni di fila e solo
 * dopo permette di archiviare i JSON. Questa funzione assicura soltanto che due
 * tabelle di riferimento non siano vuote, che è ciò che §16 del mandato consente
 * quando serve per provare uno store.
 *
 * Idempotente: si può chiamare quante volte si vuole. Non aggiorna le righe
 * esistenti — se un gestore ha corretto il nome di un'unità
 * dall'area riservata, non gliela si sovrascrive con la costante del codice.
 */

export interface EsitoRiferimenti {
  anniCreati: number;
  anniPresenti: number;
  unitaCreate: number;
  unitaPresenti: number;
}

/**
 * Come `assicuraRiferimenti`, ma **dentro una transazione già aperta**.
 *
 * Serve agli store che devono materializzare un seme con chiavi esterne verso
 * queste due tabelle: `documenti.anno_id` è `NOT NULL`, quindi prima di scrivere
 * i venticinque documenti di partenza gli anni devono esistere. Chiamare
 * `assicuraRiferimenti` da lì aprirebbe una transazione dentro un'altra.
 */
export function assicuraRiferimentiIn(d: Handle): EsitoRiferimenti {
  {
    let anniCreati = 0;
    let unitaCreate = 0;

    // ---------------------------------------------------------------- unità
    //
    // Sei righe, non sette: `gruppo` in `UnitaKey` non è un'unità ma la voce
    // delle attività comuni, e nel modello è `unita_id IS NULL`. Crearla come
    // riga romperebbe il trigger dei consensi, che si regge su quel NULL.
    // Vedi il commento su CHIAVE_GRUPPO in lib/db/mappa.ts.
    //
    // ## Le colonne di contenuto della 0007 NON si seminano, ed è deliberato
    //
    // La migrazione ha aggiunto sedici colonne — motto, occhiello, ritrovo,
    // storia, referente… — e la tentazione è riempirle qui da `UNITA`, «per non
    // partire da una pagina vuota». Sarebbe sbagliato per due motivi.
    //
    // Il primo è il modello: nullo significa «nessuno ha personalizzato questo
    // campo, usa il predefinito di lib/data.ts». Scrivere il predefinito nella
    // colonna lo trasforma in una **copia**, e da quel momento correggere un
    // testo nel codice non cambia più niente sul sito. È la proprietà che regge
    // `lib/gruppo.ts` da tre fasi, ed è quella che si perderebbe.
    //
    // Il secondo è più concreto: quei testi sono in gran parte i segnaposto del
    // mockup — «Lorem ipsum», «Nome Cognome». Seminarli li promuoverebbe da
    // «segnaposto che si vede che è un segnaposto» a «contenuto salvato da
    // qualcuno», e nessuna schermata potrebbe più distinguerli da un testo
    // vero. Lo stesso vale per `unita_persone`: quaranta righe di «Nome
    // Cognome» con un autore e una data non sono un punto di partenza, sono
    // rumore che qualcuno dovrà cancellare a mano.
    //
    // Quello che si semina resta quello di prima: le nove colonne d'identità,
    // che servono da àncora alle chiavi esterne e sono `NOT NULL`.
    UNITA.forEach((u, indice) => {
      const esiste = d
        .select({ id: tabellaUnita.id })
        .from(tabellaUnita)
        .where(eq(tabellaUnita.chiave, u.chiave))
        .get();
      if (esiste) return;

      d.insert(tabellaUnita)
        .values({
          chiave: u.chiave,
          slug: u.slug,
          nome: u.nome,
          fascia: u.fascia,
          eta: u.eta,
          logo: u.logo,
          telefono: u.telefono,
          // l'ordine di `UNITA`, che è quello in cui il sito le presenta
          ordine: indice + 1,
        })
        .run();
      unitaCreate++;
    });

    // ----------------------------------------------------------------- anni
    //
    // `ANNI_DOC[].chiave` è già la forma canonica `2026-2027`, e `corrente` è
    // già il flag. L'indice parziale garantisce che di corrente ce ne sia uno
    // solo: se per qualunque motivo ce ne fosse già uno diverso da quello di
    // ANNI_DOC, l'inserimento del secondo fallirebbe. Per questo il flag si
    // mette solo se non c'è già un anno corrente.
    const correntePresente = d
      .select({ id: anniSociali.id })
      .from(anniSociali)
      .where(eq(anniSociali.corrente, 1))
      .get();
    let correnteAssegnato = Boolean(correntePresente);

    for (const a of ANNI_DOC) {
      const esiste = d
        .select({ id: anniSociali.id })
        .from(anniSociali)
        .where(eq(anniSociali.etichetta, a.chiave))
        .get();
      if (esiste) continue;

      const periodo = periodoDiAnno(a.chiave);
      if (!periodo) {
        // un'etichetta che non è un anno sociale: si salta e si dice, invece di
        // inventare due date
        console.warn(
          `riferimenti: «${a.chiave}» non è un'etichetta di anno sociale valida, salto la riga.`,
        );
        continue;
      }

      const corrente = a.corrente && !correnteAssegnato ? 1 : 0;
      d.insert(anniSociali)
        .values({
          etichetta: a.chiave,
          inizio: periodo.inizio,
          fine: periodo.fine,
          corrente,
        })
        .run();
      if (corrente === 1) correnteAssegnato = true;
      anniCreati++;
    }

    const anniPresenti = d.select({ n: sql<number>`count(*)` }).from(anniSociali).get()?.n ?? 0;
    const unitaPresenti =
      d.select({ n: sql<number>`count(*)` }).from(tabellaUnita).get()?.n ?? 0;

    return { anniCreati, anniPresenti, unitaCreate, unitaPresenti };
  }
}

export function assicuraRiferimenti(): EsitoRiferimenti {
  return transazione(assicuraRiferimentiIn);
}

/**
 * L'id dell'anno a partire dall'etichetta canonica, o `undefined`.
 *
 * Non crea l'anno se manca, di proposito: gli anni si creano con
 * `assicuraRiferimenti` all'installazione e con `archiviaAnno` a settembre —
 * due operazioni deliberate. Un album salvato con un anno scritto a mano non
 * deve poter far comparire un anno nuovo nel modello.
 */
export function idAnno(etichetta: string): number | undefined {
  return dbSeEsiste()
    ?.select({ id: anniSociali.id })
    .from(anniSociali)
    .where(eq(anniSociali.etichetta, etichetta))
    .get()?.id;
}

/** L'id di un'unità dalla sua chiave. `gruppo` non è un'unità: restituisce `undefined`. */
export function idUnita(chiave: string): number | undefined {
  return dbSeEsiste()
    ?.select({ id: tabellaUnita.id })
    .from(tabellaUnita)
    .where(eq(tabellaUnita.chiave, chiave))
    .get()?.id;
}
