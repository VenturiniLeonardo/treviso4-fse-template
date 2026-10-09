import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { cancellaCaricato, scriviCaricato } from "@/lib/archivio";
import {
  CARTELLA_CIRCOLARI,
  type DocumentoSalvato,
  FIRME_DOCUMENTO,
  inIndirizzo,
  pesoLeggibile,
  SEMPRE_VALIDO,
  type Stato,
} from "@/lib/contenuti";
import { DOCUMENTI } from "@/lib/data";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso, chiaveUnita, dbInStato, eDiGruppo, isoInMs, statoInDb } from "@/lib/db/mappa";
import { assicuraRiferimentiIn } from "@/lib/db/riferimenti";
import { anniSociali, cartelle, documenti as tabella, unita, utenti } from "@/lib/db/schema";
import type { UnitaKey } from "@/lib/data";

/**
 * Archivio dei documenti e della modulistica.
 *
 * Come per gli album, alla prima lettura si semina con l'elenco di
 * `lib/data.ts`: i referenti ritrovano i venticinque documenti che il sito già
 * annuncia, tutti **senza file**, e li completano caricandoli uno per uno. È il
 * modo onesto di partire — l'elenco diceva già che quei moduli esistono, e ora
 * si vede a colpo d'occhio quali sono davvero disponibili.
 *
 * Modulo di solo server. Prima stava in `dati/documenti.json`, ora nella tabella
 * `documenti`, con `anno_id` verso `anni_sociali`.
 *
 * **La firma pubblica non cambia**, e in particolare `DocumentoSalvato.anno`
 * resta la forma canonica `2026-2027` — la stessa di `ANNI_DOC[].chiave`, con cui
 * il filtro della pagina pubblica combacia. Per gli album è diverso (là si
 * mostra `2026 – 2027`): sono le due rappresentazioni che il repository aveva già,
 * vedi `docs/implementation/schema-decisions.md`.
 *
 * **Venticinque documenti sono pubblicati senza file, ed è corretto.** Lo schema
 * non ha un `CHECK` che leghi lo stato alla presenza del file, perché
 * rifiuterebbe proprio questi dati; la regola vive in `approvazioni/actions.ts`,
 * dove riguarda il *passaggio* a pubblicato e non lo stato.
 *
 * ## Cartelle e documenti sempre validi, dalla migrazione 0012
 *
 * `categoria` è la chiave di una cartella (`lib/cartelle-store.ts`), e l'anno
 * può mancare: `anno: null` è un documento **sempre valido**, che a settembre non
 * passa in archivio. La regola dei doppioni si è spostata di conseguenza: prima
 * era «un titolo per anno», imposta dalla chiave; adesso è «un titolo per
 * cartella e per anno», cioè quello che chi guarda la cartella vedrebbe due
 * volte. La chiave resta un identificativo stabile e basta.
 */

/**
 * Chiave stabile: non cambia se si corregge il titolo, né se il documento cambia
 * cartella. `sempre/…` per i documenti senza anno.
 */
const chiave = (anno: string | null, titolo: string) =>
  `${anno ?? SEMPRE_VALIDO}/${inIndirizzo(titolo)}`;

/**
 * Le colonne che compongono un `DocumentoSalvato`, con l'anno e l'autore uniti.
 *
 * `avviso` arriva con la migrazione 0016, e la lettura deve reggere un database
 * che non l'ha ancora: è la finestra del rilascio, in cui `rilascio.md` compila
 * il pacchetto nuovo sul database in esercizio **prima** di `db:applica`, e la
 * compilazione prerenderizza `/documenti`. Senza la colonna si legge la stringa
 * vuota, cioè nessun riquadro — che è quello che quei documenti avevano.
 */
const colonne = (conAvviso: boolean) => ({
  chiave: tabella.chiave,
  anno: anniSociali.etichetta,
  unita: unita.chiave,
  categoria: tabella.categoria,
  titolo: tabella.titolo,
  nota: tabella.nota,
  avviso: conAvviso ? sql<string>`${tabella.avviso}` : sql<string>`''`,
  formato: tabella.formato,
  peso: tabella.peso,
  aggiornamento: tabella.aggiornamento,
  stato: tabella.stato,
  file: tabella.file,
  aggiornatoIl: tabella.aggiornatoIl,
  autore: utenti.utente,
});

/**
 * Vero se `documenti` ha la colonna `avviso`. Come `tabellaPresente()` in
 * `cartelle-store.ts`: una volta vista non si guarda più, e l'assenza si dice
 * una volta sola per processo.
 */
let avvisoVisto = false;
let avvisoMancante = false;
function colonnaAvviso(d: Handle): boolean {
  if (avvisoVisto) return true;
  avvisoVisto = Boolean(
    d.$client.prepare("SELECT 1 FROM pragma_table_info('documenti') WHERE name = 'avviso'").get(),
  );
  if (!avvisoVisto && !avvisoMancante) {
    avvisoMancante = true;
    console.warn(
      "documenti: la colonna «avviso» non c'è ancora (migrazione 0016 non applicata): " +
        "leggo i documenti senza avvisi. Durante la compilazione è normale; a servizio " +
        "avviato vuol dire che manca «npm run db:applica».",
    );
  }
  return avvisoVisto;
}

interface Riga {
  chiave: string;
  /** `null` per i documenti sempre validi */
  anno: string | null;
  /** `null` per i documenti di gruppo: nel modello è l'assenza di unità */
  unita: string | null;
  categoria: string;
  titolo: string;
  nota: string;
  avviso: string;
  formato: string;
  peso: string;
  aggiornamento: string;
  stato: string;
  file: string | null;
  aggiornatoIl: string | null;
  autore: string | null;
}

function comeDocumento(r: Riga): DocumentoSalvato {
  return {
    id: r.chiave,
    anno: r.anno,
    unita: chiaveUnita(r.unita),
    categoria: r.categoria,
    titolo: r.titolo,
    nota: r.nota,
    avviso: r.avviso,
    formato: r.formato as DocumentoSalvato["formato"],
    peso: r.peso,
    aggiornamento: r.aggiornamento,
    stato: dbInStato(r.stato as Parameters<typeof dbInStato>[0]),
    // la chiave `file` non c'è finché nessuno ha caricato niente: era così anche
    // nel JSON, e `d.file` viene usato come verità/falsità in più punti
    ...(r.file ? { file: r.file } : {}),
    aggiornato: isoInMs(r.aggiornatoIl),
    autore: r.autore ?? "",
  };
}

/** L'elenco di partenza, nella forma che il vecchio archivio scriveva. */
function seme(): DocumentoSalvato[] {
  return DOCUMENTI.map((d) => ({
    id: chiave(d.anno, d.titolo),
    anno: d.anno,
    // I venticinque documenti consegnati sono modulistica di gruppo: moduli
    // d'iscrizione, quote, statuti. Nessuna circolare — quelle non esistevano.
    unita: "gruppo" as UnitaKey,
    categoria: d.categoria,
    titolo: d.titolo,
    nota: d.nota,
    avviso: "",
    formato: d.formato,
    peso: d.peso,
    aggiornamento: d.aggiornamento,
    // pubblicati come voce d'elenco, ma senza file: la pagina lo dice
    stato: "pubblicato" as Stato,
    aggiornato: 0,
    autore: "",
  }));
}

/**
 * Scrive le righe del seme. Da chiamare **dentro** una transazione.
 *
 * Prima assicura gli anni: `anno_id` è `NOT NULL` con chiave esterna, e i
 * venticinque documenti coprono quattro anni sociali. Senza il reticolo
 * l'inserimento fallirebbe con un errore di chiave esterna che non spiega niente
 * a chi lo legge.
 */
function semina(d: Handle): void {
  const quanti = d.select({ n: sql<number>`count(*)` }).from(tabella).get()?.n ?? 0;
  if (quanti > 0) return;

  assicuraRiferimentiIn(d);

  const anni = new Map(
    d
      .select({ etichetta: anniSociali.etichetta, id: anniSociali.id })
      .from(anniSociali)
      .all()
      .map((a) => [a.etichetta, a.id]),
  );

  for (const doc of seme()) {
    // il seme porta sempre un anno; `null` vorrebbe dire «sempre valido», e
    // resta ammesso per quando `DOCUMENTI` ne avrà uno
    const annoId = doc.anno === null ? null : anni.get(doc.anno);
    if (annoId === undefined) {
      // un anno che non è nel reticolo: si salta la riga e si dice, invece di
      // inventare un anno per far entrare un documento
      console.warn(
        `documenti: «${doc.titolo}» ha l'anno «${doc.anno}», che non è fra gli anni sociali: salto la riga.`,
      );
      continue;
    }
    d.insert(tabella)
      .values({
        chiave: doc.id,
        annoId,
        categoria: doc.categoria,
        titolo: doc.titolo,
        nota: doc.nota,
        formato: doc.formato,
        peso: doc.peso,
        aggiornamento: doc.aggiornamento,
        stato: statoInDb(doc.stato),
      })
      .run();
  }
}

/** Tutti i documenti. `cache` lega la lettura alla richiesta. */
export const leggiDocumenti = cache(async (): Promise<DocumentoSalvato[]> => {
  const d = dbSeEsiste();
  // niente database: si serve il seme, che è quello che il sito annuncia.
  // Succede in compilazione, dove la pagina /documenti viene prerenderizzata.
  if (!d) return seme();

  try {
    const righe = d
      .select(colonne(colonnaAvviso(d)))
      .from(tabella)
      // sinistra anche questa, dalla 0012: un documento sempre valido ha
      // `anno_id` nullo, e con la giunzione interna di prima sarebbe sparito
      .leftJoin(anniSociali, eq(tabella.annoId, anniSociali.id))
      // sinistra, non interna: un documento di gruppo ha `unita_id` nullo, e
      // con una giunzione interna sarebbero spariti tutti e venticinque
      .leftJoin(unita, eq(tabella.unitaId, unita.id))
      .leftJoin(utenti, eq(tabella.autoreId, utenti.id))
      // prima i sempre validi, poi i più recenti per anno, poi per titolo: lo
      // stesso ordine stabile che le pagine raggruppano. `IS NOT NULL` vale 0
      // per i sempre validi, che quindi vengono prima.
      .orderBy(
        sql`${anniSociali.etichetta} IS NOT NULL`,
        desc(anniSociali.etichetta),
        asc(tabella.categoria),
        asc(tabella.titolo),
      )
      .all();

    return righe.length === 0 ? seme() : righe.map(comeDocumento);
  } catch (errore) {
    solleva("documenti-store.leggiDocumenti", errore);
  }
});

export async function documentiPubblicati(): Promise<DocumentoSalvato[]> {
  return (await leggiDocumenti()).filter((d) => d.stato === "pubblicato");
}

export async function documentoPerId(id: string): Promise<DocumentoSalvato | undefined> {
  return (await leggiDocumenti()).find((d) => d.id === id);
}

// --------------------------------------------------------------------------
// Creazione e modifica
// --------------------------------------------------------------------------

export interface NuovoDocumento {
  titolo: string;
  /** l'anno sociale in forma canonica, o `null`: sempre valido */
  anno: string | null;
  /** `gruppo` per la modulistica, l'unità per una circolare */
  unita: UnitaKey;
  /** la cartella, come `Cartella.chiave` */
  categoria: string;
  nota: string;
}

type Rifiuto = { ok: false; errore: string; campo?: string };

/**
 * Le regole che un documento nuovo deve rispettare, e la chiave che prenderà.
 *
 * Una funzione sola per i due modi in cui un documento nasce — la voce senza
 * file e il file caricato in una cartella — perché due copie delle stesse
 * regole sono il modo in cui una delle due resta indietro. Va chiamata
 * **dentro** la transazione che poi scrive: fra il controllo del doppione e
 * l'inserimento nessun altro deve poter creare lo stesso documento.
 */
function ammetti(
  d: Handle,
  dati: NuovoDocumento,
): Rifiuto | { ok: true; id: string; annoId: number | null; unitaId: number | null } {
  // La cartella. La chiave esterna la rifiuterebbe comunque; qui la si spiega.
  const cartella = d
    .select({ chiave: cartelle.chiave })
    .from(cartelle)
    .where(eq(cartelle.chiave, dati.categoria))
    .get();
  if (!cartella) {
    return {
      ok: false,
      campo: "categoria",
      errore: "Questa cartella non esiste più: ricaricate la pagina e sceglietene un’altra.",
    };
  }

  // L'anno, se c'è: un documento sempre valido non ne ha.
  let annoId: number | null = null;
  if (dati.anno !== null) {
    const anno = d
      .select({ id: anniSociali.id })
      .from(anniSociali)
      .where(eq(anniSociali.etichetta, dati.anno))
      .get();
    if (!anno) {
      // l'anno non è nel reticolo: è un errore di validazione, non un guasto
      return {
        ok: false,
        campo: "anno",
        errore: `L’anno «${dati.anno}» non è fra gli anni sociali registrati.`,
      };
    }
    annoId = anno.id;
  }

  /*
   * L'unità, e l'invariante che il database fa rispettare comunque.
   *
   * `documenti_circolari_hanno_unita` dice che le circolari hanno un'unità e
   * gli altri documenti no. Qui si controlla **prima**, non perché il `CHECK`
   * non basti — basta, ed è lui la garanzia — ma perché un vincolo violato
   * risale come `ErroreDatabase` con un messaggio che parla di regole di
   * sistema, e chi legge è un gestore che ha scelto la cartella sbagliata
   * in un menù a tendina.
   */
  const diGruppo = eDiGruppo(dati.unita);
  const circolare = dati.categoria === CARTELLA_CIRCOLARI;
  if (circolare && diGruppo) {
    return {
      ok: false,
      campo: "categoria",
      errore: "Una circolare è di un’unità: scegliete quale, oppure un’altra cartella.",
    };
  }
  if (!circolare && !diGruppo) {
    return {
      ok: false,
      campo: "categoria",
      errore:
        "Solo le circolari sono di un’unità. La modulistica del gruppo — iscrizioni, " +
        "quote, statuti — vale per tutti.",
    };
  }

  let unitaId: number | null = null;
  if (!diGruppo) {
    const u = d.select({ id: unita.id }).from(unita).where(eq(unita.chiave, dati.unita)).get();
    if (!u) return { ok: false, errore: `L’unità «${dati.unita}» non è registrata.` };
    unitaId = u.id;
  }

  /*
   * Il doppione: lo stesso titolo **nella stessa cartella**, per lo stesso anno
   * e della stessa unità. È quello che chi apre la cartella vedrebbe due volte.
   *
   * Prima la regola la faceva la chiave — un titolo per anno, in tutto il sito —
   * e con le cartelle era diventata sbagliata in tutti e due i sensi: vietava
   * la stessa «Scheda sanitaria» in «Tesseramenti» e in «Campi estivi», e non
   * diceva niente dei sempre validi. Il confronto è sul titolo normalizzato,
   * così «Scheda sanitaria» e «scheda  sanitaria» sono lo stesso documento.
   */
  const vicini = d
    .select({ titolo: tabella.titolo })
    .from(tabella)
    .where(
      and(
        eq(tabella.categoria, dati.categoria),
        annoId === null ? isNull(tabella.annoId) : eq(tabella.annoId, annoId),
        unitaId === null ? isNull(tabella.unitaId) : eq(tabella.unitaId, unitaId),
      ),
    )
    .all();
  const normale = inIndirizzo(dati.titolo);
  if (vicini.some((v) => inIndirizzo(v.titolo) === normale)) {
    return {
      ok: false,
      campo: "titolo",
      errore:
        `Esiste già «${dati.titolo}» in questa cartella` +
        (dati.anno === null ? ", fra i documenti sempre validi." : ` per l’anno ${dati.anno}.`),
    };
  }

  // La chiave. Dopo il controllo qui sopra può essere occupata solo da un
  // documento di un'altra cartella o di un'altra unità con lo stesso titolo: in
  // quel caso prende un numero in coda, e resta un identificativo come un altro.
  const base = chiave(dati.anno, dati.titolo);
  let id = base;
  for (
    let n = 2;
    d.select({ c: tabella.chiave }).from(tabella).where(eq(tabella.chiave, id)).get();
    n++
  ) {
    id = `${base}-${n}`;
  }

  return { ok: true, id, annoId, unitaId };
}

export async function creaDocumento(
  dati: NuovoDocumento,
  adesso: number,
  autore: string,
): Promise<{ ok: true; id: string } | Rifiuto> {
  try {
    return transazione((d) => {
      semina(d);

      const ammesso = ammetti(d, dati);
      if (!ammesso.ok) return ammesso;

      d.insert(tabella)
        .values({
          chiave: ammesso.id,
          annoId: ammesso.annoId,
          unitaId: ammesso.unitaId,
          categoria: dati.categoria,
          titolo: dati.titolo,
          nota: dati.nota,
          formato: "PDF",
          peso: "—",
          aggiornamento: "",
          // nasce in bozza: si pubblica quando il file c'è
          stato: statoInDb("bozza"),
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .run();
      return { ok: true as const, id: ammesso.id };
    });
  } catch (errore) {
    solleva("documenti-store.creaDocumento", errore);
  }
}

/**
 * Un documento nuovo **con il suo file**, in un passo solo: è ciò che fa il
 * caricamento di una cartella intera.
 *
 * La voce senza file resta per chi vuole annunciare un modulo prima di averlo;
 * chi ha già i PDF non deve creare dieci voci, caricare dieci file e premere
 * dieci volte «Pubblica». Le regole sono quelle di `creaDocumento`, lette dallo
 * stesso `ammetti`.
 *
 * Il file si scrive **prima** della transazione, come in `caricaFileDocumento` —
 * §18 vieta di tenerne una aperta durante un'operazione su disco — e si porta
 * via se la riga non entra, per qualunque motivo.
 *
 * Pubblicare subito è ammesso perché qui il file c'è: la regola «niente
 * pubblicazione senza file» è rispettata per costruzione.
 */
export async function aggiungiDocumentoConFile(
  dati: NuovoDocumento,
  contenuto: Buffer,
  opzioni: { adesso: number; autore: string; mese: string; pubblica: boolean },
): Promise<{ ok: true; id: string } | Rifiuto> {
  const riconosciuto = riconosciDocumento(contenuto);
  if (!riconosciuto) return { ok: false, errore: "Il file non è un PDF né un DOCX." };

  /*
   * Il nome lo generiamo noi, con la marca temporale e **sei cifre a caso**.
   *
   * In `caricaFileDocumento` bastano la chiave e l'istante, perché la chiave è
   * già unica. Qui no: la chiave definitiva si sa solo dentro la transazione, e
   * il file va scritto prima. Due documenti con lo stesso titolo in due cartelle
   * diverse, caricati nello stesso millisecondo, avrebbero avuto lo stesso nome —
   * e il secondo avrebbe **sovrascritto sul disco** il file del primo prima di
   * scoprire, nella transazione, che il nome era occupato. Il caso è remoto; il
   * danno sarebbe un modulo pubblicato che scarica quello di un altro.
   */
  const file =
    `doc-${inIndirizzo(chiave(dati.anno, dati.titolo))}-${opzioni.adesso}-` +
    `${randomBytes(3).toString("hex")}.${riconosciuto.estensione}`;
  await scriviCaricato(file, contenuto);

  let esito: { ok: true; id: string } | Rifiuto;
  try {
    esito = transazione((d) => {
      semina(d);

      const ammesso = ammetti(d, dati);
      if (!ammesso.ok) return ammesso;

      d.insert(tabella)
        .values({
          chiave: ammesso.id,
          annoId: ammesso.annoId,
          unitaId: ammesso.unitaId,
          categoria: dati.categoria,
          titolo: dati.titolo,
          nota: dati.nota,
          formato: riconosciuto.formato,
          peso: pesoLeggibile(contenuto.length),
          aggiornamento: opzioni.mese,
          stato: statoInDb(opzioni.pubblica ? "pubblicato" : "bozza"),
          file,
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, opzioni.autore),
        })
        .run();
      return { ok: true as const, id: ammesso.id };
    });
  } catch (errore) {
    // la riga non c'è: si porta via il file appena scritto
    await cancellaCaricato(file);
    solleva("documenti-store.aggiungiDocumentoConFile", errore);
  }

  if (!esito.ok) await cancellaCaricato(file);
  return esito;
}

/**
 * L'id dell'utente dal nome, o `null`.
 *
 * Resta `null` finché la tabella `utenti` non è popolata (fase 6): il nome in
 * chiaro non si perde, perché `autore` è quello che i componenti mostrano e lo
 * si ricava dal join. Quando gli account saranno nel database il collegamento
 * si stringe da sé, senza toccare questa firma.
 */
function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null;
}

/** Applica una modifica e aggiorna autore e data. `false` se non esiste. */
function modifica(
  d: Handle,
  id: string,
  valori: Partial<{
    titolo: string;
    categoria: string;
    nota: string;
    avviso: string;
    /** `null` è un valore: sempre valido */
    annoId: number | null;
    stato: Stato;
    formato: DocumentoSalvato["formato"];
    peso: string;
    aggiornamento: string;
    file: string;
  }>,
  autore: string,
): boolean {
  const esiste = d
    .select({ chiave: tabella.chiave })
    .from(tabella)
    .where(eq(tabella.chiave, id))
    .get();
  if (!esiste) return false;

  d.update(tabella)
    .set({
      ...(valori.titolo !== undefined ? { titolo: valori.titolo } : {}),
      ...(valori.categoria !== undefined ? { categoria: valori.categoria } : {}),
      ...(valori.nota !== undefined ? { nota: valori.nota } : {}),
      ...(valori.avviso !== undefined ? { avviso: valori.avviso } : {}),
      ...(valori.annoId !== undefined ? { annoId: valori.annoId } : {}),
      ...(valori.stato !== undefined ? { stato: statoInDb(valori.stato) } : {}),
      ...(valori.formato !== undefined ? { formato: valori.formato } : {}),
      ...(valori.peso !== undefined ? { peso: valori.peso } : {}),
      ...(valori.aggiornamento !== undefined ? { aggiornamento: valori.aggiornamento } : {}),
      ...(valori.file !== undefined ? { file: valori.file } : {}),
      aggiornatoIl: adessoIso(),
      autoreId: idAutore(d, autore),
    })
    .where(eq(tabella.chiave, id))
    .run();
  return true;
}

/**
 * Titolo, nota, avviso, cartella e anno di un documento esistente.
 *
 * Restituisce un esito e non più un vero/falso: da quando si può cambiare
 * cartella e anno, «non esiste» non è più l'unico modo di non riuscire. Una
 * cartella sparita, un anno fuori reticolo o una circolare spostata fra la
 * modulistica del gruppo si spiegano qui, invece di risalire come vincolo
 * violato.
 *
 * L'unità del documento **non** si cambia: è il suo ambito, e spostarlo è una
 * cosa che nessuna schermata offre e nessuna azione deve poter fare.
 */
export async function aggiornaDocumento(
  id: string,
  dati: Partial<Pick<NuovoDocumento, "titolo" | "categoria" | "nota" | "anno"> & { avviso: string }>,
  _adesso: number,
  autore: string,
): Promise<{ ok: true } | Rifiuto> {
  try {
    return transazione((d): { ok: true } | Rifiuto => {
      semina(d);

      const doc = d
        .select({ unitaId: tabella.unitaId })
        .from(tabella)
        .where(eq(tabella.chiave, id))
        .get();
      if (!doc) return { ok: false, errore: "Questo documento non esiste più." };

      if (dati.categoria !== undefined) {
        const cartella = d
          .select({ chiave: cartelle.chiave })
          .from(cartelle)
          .where(eq(cartelle.chiave, dati.categoria))
          .get();
        if (!cartella) {
          return {
            ok: false,
            campo: "categoria",
            errore: "Questa cartella non esiste più: ricaricate la pagina e sceglietene un’altra.",
          };
        }
        // lo stesso invariante di `ammetti`, visto da un documento che c'è già
        const diUnita = doc.unitaId !== null;
        if ((dati.categoria === CARTELLA_CIRCOLARI) !== diUnita) {
          return {
            ok: false,
            campo: "categoria",
            errore: diUnita
              ? "Una circolare resta fra le circolari: è della sua unità."
              : "Fra le circolari stanno solo i documenti di un’unità.",
          };
        }
      }

      let annoId: number | null | undefined;
      if (dati.anno === null) {
        annoId = null;
      } else if (dati.anno !== undefined) {
        const anno = d
          .select({ id: anniSociali.id })
          .from(anniSociali)
          .where(eq(anniSociali.etichetta, dati.anno))
          .get();
        if (!anno) {
          return {
            ok: false,
            campo: "anno",
            errore: `L’anno «${dati.anno}» non è fra gli anni sociali registrati.`,
          };
        }
        annoId = anno.id;
      }

      modifica(
        d,
        id,
        {
          titolo: dati.titolo,
          categoria: dati.categoria,
          nota: dati.nota,
          avviso: dati.avviso,
          annoId,
        },
        autore,
      );
      return { ok: true };
    });
  } catch (errore) {
    solleva("documenti-store.aggiornaDocumento", errore);
  }
}

/**
 * `seUguale`: lo stesso controllo dentro la transazione di `cambiaStatoAlbum`
 * (report QA, BUG-011).
 */
export async function cambiaStatoDocumento(
  id: string,
  stato: Stato,
  _adesso: number,
  autore: string,
  seUguale?: (attuale: DocumentoSalvato) => boolean,
): Promise<boolean> {
  try {
    return transazione((d) => {
      semina(d);
      if (seUguale) {
        const riga = d
          .select(colonne(colonnaAvviso(d)))
          .from(tabella)
          .leftJoin(anniSociali, eq(tabella.annoId, anniSociali.id))
          .leftJoin(unita, eq(tabella.unitaId, unita.id))
          .leftJoin(utenti, eq(tabella.autoreId, utenti.id))
          .where(eq(tabella.chiave, id))
          .get();
        if (!riga || !seUguale(comeDocumento(riga))) return false;
      }
      return modifica(d, id, { stato }, autore);
    });
  } catch (errore) {
    solleva("documenti-store.cambiaStatoDocumento", errore);
  }
}

export async function eliminaDocumento(id: string): Promise<boolean> {
  let daCancellare: string | null = null;
  try {
    const fatto = transazione((d) => {
      semina(d);
      const trovato = d
        .select({ file: tabella.file })
        .from(tabella)
        .where(eq(tabella.chiave, id))
        .get();
      if (!trovato) return false;

      daCancellare = trovato.file;
      d.delete(tabella).where(eq(tabella.chiave, id)).run();
      return true;
    });
    // il file **dopo** il commit: cancellarlo dentro la transazione
    // significherebbe, in caso di annullamento, aver perso il file e riavuto la
    // riga che lo indicizza
    if (fatto && daCancellare) await cancellaCaricato(daCancellare);
    return fatto;
  } catch (errore) {
    solleva("documenti-store.eliminaDocumento", errore);
  }
}

// --------------------------------------------------------------------------
// File
// --------------------------------------------------------------------------

/**
 * Riconosce PDF e DOCX dalla firma in testa al file.
 *
 * L'estensione e il tipo dichiarato dal browser non contano: li sceglie chi
 * carica. Contano i primi byte.
 */
export function riconosciDocumento(b: Buffer) {
  return FIRME_DOCUMENTO.find((f) => f.firma.every((byte, i) => b[i] === byte)) ?? null;
}

export async function caricaFileDocumento(
  id: string,
  dati: Buffer,
  adesso: number,
  autore: string,
  mese: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const riconosciuto = riconosciDocumento(dati);
  if (!riconosciuto) {
    return { ok: false, errore: "Il file non è un PDF né un DOCX." };
  }

  // il nome lo generiamo noi, e porta la marca temporale: sostituire un file
  // non lascia in cache la versione precedente. Il suffisso casuale e la
  // scrittura esclusiva come in `aggiungiFoto` (report QA, BUG-006): due
  // sostituzioni nello stesso millisecondo non si sovrascrivono il file.
  const file =
    `doc-${inIndirizzo(id)}-${adesso}-` +
    `${randomBytes(3).toString("hex")}.${riconosciuto.estensione}`;

  // Il file **prima** della transazione: §18 vieta di tenere aperta una
  // transazione durante un'operazione su filesystem.
  await scriviCaricato(file, dati, { esclusivo: true });

  let vecchio: string | null = null;
  let esito: { ok: true } | { ok: false; errore: string };
  try {
    esito = transazione((d) => {
      semina(d);
      const trovato = d
        .select({ file: tabella.file })
        .from(tabella)
        .where(eq(tabella.chiave, id))
        .get();
      if (!trovato) return { ok: false as const, errore: "Questo documento non esiste più." };

      vecchio = trovato.file;
      modifica(
        d,
        id,
        {
          file,
          formato: riconosciuto.formato,
          peso: pesoLeggibile(dati.length),
          aggiornamento: mese,
        },
        autore,
      );
      return { ok: true as const };
    });
  } catch (errore) {
    // la riga non è stata aggiornata: si porta via il file appena scritto
    await cancellaCaricato(file);
    solleva("documenti-store.caricaFileDocumento", errore);
  }

  if (!esito.ok) {
    await cancellaCaricato(file);
    return esito;
  }
  if (vecchio && vecchio !== file) await cancellaCaricato(vecchio);
  return { ok: true };
}

/** Il file è servibile solo se il documento è pubblicato. */
export async function filePubblico(
  nome: string,
): Promise<{ tipo: string; titolo: string; formato: string; unita: UnitaKey } | null> {
  return perFile(nome, true);
}

/** Come sopra, ma per chi è entrato: vede anche le bozze. */
export async function fileInterno(
  nome: string,
): Promise<{ tipo: string; titolo: string; formato: string; unita: UnitaKey } | null> {
  return perFile(nome, false);
}

/**
 * Il documento che possiede questo file.
 *
 * Una interrogazione su `file`, che ha un indice univoco, invece di scorrere
 * l'elenco intero: è una rotta che serve un allegato, e viene chiamata una volta
 * per download.
 */
async function perFile(
  nome: string,
  soloPubblicati: boolean,
): Promise<{ tipo: string; titolo: string; formato: string; unita: UnitaKey } | null> {
  const d = dbSeEsiste();
  if (!d) return null;

  try {
    const trovato = d
      .select({
        titolo: tabella.titolo,
        formato: tabella.formato,
        stato: tabella.stato,
        // l'ambito del documento: serve alla rotta interna per confinare un
        // referente di unità alle circolari della propria unità, come la rotta delle
        // fotografie confina alle foto della propria. Sinistra, non interna: un
        // documento di gruppo ha `unita_id` nullo.
        unita: unita.chiave,
      })
      .from(tabella)
      .leftJoin(unita, eq(tabella.unitaId, unita.id))
      .where(
        soloPubblicati
          ? and(eq(tabella.file, nome), eq(tabella.stato, statoInDb("pubblicato")))
          : eq(tabella.file, nome),
      )
      .get();
    if (!trovato) return null;

    const f = FIRME_DOCUMENTO.find((x) => x.formato === trovato.formato);
    return {
      tipo: f?.tipo ?? "application/octet-stream",
      titolo: trovato.titolo,
      formato: trovato.formato,
      unita: chiaveUnita(trovato.unita),
    };
  } catch (errore) {
    solleva("documenti-store.perFile", errore);
  }
}

/**
 * I documenti di un'unità: le sue circolari.
 *
 * Filtra sull'unità e non sulla categoria, benché oggi le due cose coincidano —
 * il `CHECK` `documenti_circolari_hanno_unita` garantisce che un documento con
 * un'unità sia una circolare. Filtrare sull'ambito è però la domanda giusta: se
 * un domani nascesse una seconda categoria d'unità, questa funzione continuerebbe
 * a restituire quello che quel referente può toccare, mentre un filtro su
 * `categoria = 'circolari'` avrebbe cominciato a nasconderne una metà.
 */
export async function documentiDiUnita(chiave: UnitaKey): Promise<DocumentoSalvato[]> {
  return (await leggiDocumenti()).filter((d) => d.unita === chiave);
}
