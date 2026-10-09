import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { cache } from "react";
import { cancellaCaricato, scriviCaricato } from "@/lib/archivio";
import {
  type AlbumSalvato,
  FOTO_LATO_MAX,
  type FotoNelCestino,
  type Fotografia,
  GIORNI_CESTINO,
  inIndirizzo,
  type Stato,
} from "@/lib/contenuti";
import type { SerraturaAlbum } from "@/lib/album-accesso";
import { ALBUM, type UnitaKey } from "@/lib/data";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { haColonna } from "@/lib/db/colonne";
import { solleva } from "@/lib/db/errori";
import {
  adessoIso,
  chiaveUnita,
  dbInStato,
  displayInEtichetta,
  eDiGruppo,
  etichettaInDisplay,
  isoInMs,
  statoInDb,
} from "@/lib/db/mappa";
import { assicuraRiferimentiIn } from "@/lib/db/riferimenti";
import {
  album as tabella,
  anniSociali,
  foto as tabellaFoto,
  lavori,
  unita,
  utenti,
} from "@/lib/db/schema";
import { accodaIn, avvia, cancellaDerivate } from "@/lib/foto/coda";
import { ErroreDerivate, misureVere, ripulisciOriginale } from "@/lib/foto/derivate";
import { ESTENSIONI, TIPI_MIME } from "@/lib/foto/formato";

/**
 * Archivio degli album fotografici.
 *
 * Alla prima lettura si semina con i dodici album di `lib/data.ts`, già
 * pubblicati e senza fotografie: i referenti trovano l'elenco che conoscono e ci
 * lavorano sopra, invece di ripartire da una pagina vuota. Da quel momento
 * l'archivio è l'unica verità, e `lib/data.ts` resta il valore di partenza.
 *
 * Modulo di solo server. Prima stava in `dati/album.json` con le fotografie
 * annidate; adesso in `album` più la tabella figlia `foto`, con
 * `ON DELETE CASCADE`.
 *
 * **La firma pubblica non cambia**, e in particolare `AlbumSalvato.anno` resta
 * la forma **visualizzata** `2026 – 2027`, che è quella che la pagina `/foto`
 * stampa come intestazione di gruppo e che l'editor pretende. I documenti usano
 * invece la forma canonica: sono le due rappresentazioni che il repository aveva
 * già, e sotto puntano alla stessa riga di `anni_sociali`.
 *
 * `unita` resta una `UnitaKey`, `gruppo` compreso — che nel database è
 * `unita_id IS NULL` e non una settima riga in `unita`.
 */

const COLONNE = {
  id: tabella.id,
  slug: tabella.slug,
  anno: anniSociali.etichetta,
  unita: unita.chiave,
  titolo: tabella.titolo,
  dataTesto: tabella.dataTesto,
  sottotitolo: tabella.sottotitolo,
  tag: tabella.tag,
  stato: tabella.stato,
  escluse: tabella.escluse,
  aggiornatoIl: tabella.aggiornatoIl,
  autore: utenti.utente,
};

interface Riga {
  id: number;
  slug: string;
  anno: string;
  unita: string | null;
  titolo: string;
  dataTesto: string;
  sottotitolo: string;
  tag: string;
  stato: string;
  escluse: number;
  aggiornatoIl: string | null;
  autore: string | null;
}

function comeAlbum(r: Riga, foto: Fotografia[]): AlbumSalvato {
  return {
    slug: r.slug,
    anno: etichettaInDisplay(r.anno),
    unita: chiaveUnita(r.unita),
    titolo: r.titolo,
    data: r.dataTesto,
    sottotitolo: r.sottotitolo,
    tag: r.tag,
    stato: dbInStato(r.stato as Parameters<typeof dbInStato>[0]),
    escluse: r.escluse,
    foto,
    aggiornato: isoInMs(r.aggiornatoIl),
    autore: r.autore ?? "",
  };
}

/** L'elenco di partenza, nella forma che il vecchio archivio scriveva. */
function seme(): AlbumSalvato[] {
  return ALBUM.map((a) => ({
    slug: a.slug,
    anno: a.anno,
    unita: a.unita,
    titolo: a.titolo,
    data: a.data,
    sottotitolo: a.sottotitolo,
    tag: a.tag,
    stato: "pubblicato" as Stato,
    escluse: 0,
    foto: [],
    aggiornato: 0,
    autore: "",
  }));
}

/**
 * Scrive le righe del seme. Da chiamare **dentro** una transazione.
 *
 * Inserisce in ordine **inverso** rispetto ad `ALBUM`, e non è un vezzo: la
 * lettura ordina per `id` decrescente, perché nel vecchio archivio un album
 * nuovo veniva messo in testa all'elenco (`album.unshift`) e i referenti lo trovano
 * lì. Seminando al contrario, `id DESC` restituisce l'ordine originale di
 * `ALBUM` per i dodici di partenza *e* mette davanti quelli creati dopo. Le due
 * cose insieme sono il comportamento di prima.
 *
 * Prima assicura anni e unità: `anno_id` è `NOT NULL` con chiave esterna.
 */
function semina(d: Handle): void {
  const quanti = d.select({ n: sql<number>`count(*)` }).from(tabella).get()?.n ?? 0;
  if (quanti > 0) return;

  assicuraRiferimentiIn(d);

  const anni = new Map(
    d.select({ e: anniSociali.etichetta, id: anniSociali.id }).from(anniSociali).all().map((a) => [a.e, a.id]),
  );
  const unitaPerChiave = new Map(
    d.select({ c: unita.chiave, id: unita.id }).from(unita).all().map((u) => [u.c, u.id]),
  );

  for (const a of [...seme()].reverse()) {
    const etichetta = displayInEtichetta(a.anno);
    const annoId = etichetta ? anni.get(etichetta) : undefined;
    if (annoId === undefined) {
      console.warn(
        `album: «${a.titolo}» ha l'anno «${a.anno}», che non è fra gli anni sociali: salto la riga.`,
      );
      continue;
    }
    d.insert(tabella)
      .values({
        slug: a.slug,
        annoId,
        // «gruppo» non è un'unità: è l'assenza di unità
        unitaId: eDiGruppo(a.unita) ? null : (unitaPerChiave.get(a.unita) ?? null),
        titolo: a.titolo,
        dataTesto: a.data,
        sottotitolo: a.sottotitolo,
        tag: a.tag,
        stato: statoInDb(a.stato),
      })
      .run();
  }
}

/** Le fotografie di tutti gli album passati, raggruppate per album. */
function fotoPerAlbum(d: Handle, ids: number[]): Map<number, Fotografia[]> {
  const per = new Map<number, Fotografia[]>();
  if (ids.length === 0) return per;

  /*
   * La `LEFT JOIN` con `lavori` è la sola aggiunta della fase 7.
   *
   * Serve a dire alla schermata dell'area a che punto è la conversione. È una
   * giunzione sinistra perché una fotografia può non avere nessun lavoro — le
   * tredici del seme, per esempio — e in quel caso conta solo `derivate_il`.
   */
  const righe = d
    .select({
      albumId: tabellaFoto.albumId,
      file: tabellaFoto.file,
      tipo: tabellaFoto.tipo,
      larghezza: tabellaFoto.larghezza,
      altezza: tabellaFoto.altezza,
      didascalia: tabellaFoto.didascalia,
      derivateIl: tabellaFoto.derivateIl,
      lavoroId: lavori.id,
      statoLavoro: lavori.stato,
      motivo: lavori.motivo,
      // 0021: prima della migrazione la colonna non c'è, e nessuna è nascosta
      ...(haColonna(d, "foto", "nascosta") ? { nascosta: tabellaFoto.nascosta } : {}),
    })
    .from(tabellaFoto)
    .leftJoin(lavori, eq(lavori.fotoId, tabellaFoto.id))
    // le eliminate stanno nel cestino (`fotoNelCestino`): per tutto il resto
    // del sito non ci sono. 0022: prima della migrazione la colonna non c'è
    .where(haColonna(d, "foto", "eliminata_il") ? isNull(tabellaFoto.eliminataIl) : undefined)
    .orderBy(asc(tabellaFoto.albumId), asc(tabellaFoto.ordine), asc(tabellaFoto.id))
    .all() as {
    albumId: number;
    file: string;
    tipo: string;
    larghezza: number;
    altezza: number;
    didascalia: string;
    derivateIl: string | null;
    lavoroId: number | null;
    statoLavoro: string | null;
    motivo: string | null;
    nascosta?: number;
  }[];

  for (const f of righe) {
    if (!per.has(f.albumId)) per.set(f.albumId, []);
    const fallito = f.statoLavoro === "errore";
    per.get(f.albumId)!.push({
      file: f.file,
      tipo: f.tipo,
      larghezza: f.larghezza,
      altezza: f.altezza,
      didascalia: f.didascalia,
      conversione: f.derivateIl ? "pronta" : fallito ? "errore" : "attesa",
      ...(fallito
        ? { motivo: f.motivo ?? "Motivo non registrato.", lavoroId: f.lavoroId ?? undefined }
        : {}),
      ...(f.nascosta === 1 ? { nascosta: true } : {}),
    });
  }
  return per;
}

/**
 * Tutti gli album, pubblicati e no. `cache` lega la lettura alla richiesta.
 *
 * Due interrogazioni e non una `JOIN`: unendo le fotografie si otterrebbe una
 * riga di album ripetuta per ogni foto, e con centocinquanta scatti in un album
 * sarebbero centocinquanta copie degli stessi campi da ricomporre.
 */
export const leggiAlbum = cache(async (): Promise<AlbumSalvato[]> => {
  const d = dbSeEsiste();
  // niente database: si serve il seme. Succede in compilazione, dove /foto e
  // /foto/[album] vengono prerenderizzate.
  if (!d) return seme();

  try {
    const righe = d
      .select(COLONNE)
      .from(tabella)
      .innerJoin(anniSociali, eq(tabella.annoId, anniSociali.id))
      .leftJoin(unita, eq(tabella.unitaId, unita.id))
      .leftJoin(utenti, eq(tabella.autoreId, utenti.id))
      // anno decrescente, e dentro l'anno i più recenti per primi: vedi il
      // commento su `semina`
      .orderBy(desc(anniSociali.etichetta), desc(tabella.id))
      .all();

    if (righe.length === 0) return seme();

    const foto = fotoPerAlbum(d, righe.map((r) => r.id));
    return righe.map((r) => comeAlbum(r, foto.get(r.id) ?? []));
  } catch (errore) {
    solleva("album.leggiAlbum", errore);
  }
});

/** L'album come lo vede il pubblico: senza le fotografie nascoste. */
const perIlPubblico = (a: AlbumSalvato): AlbumSalvato =>
  a.foto.some((f) => f.nascosta) ? { ...a, foto: a.foto.filter((f) => !f.nascosta) } : a;

/** Solo quelli che il pubblico può vedere, e di ciascuno le sole fotografie visibili. */
export async function albumPubblicati(): Promise<AlbumSalvato[]> {
  return (await leggiAlbum()).filter((a) => a.stato === "pubblicato").map(perIlPubblico);
}

/**
 * Un album pubblicato, per la sua pagina pubblica: senza le fotografie nascoste.
 * `undefined` se non c'è o non è pubblicato — per il pubblico è la stessa cosa.
 */
export async function albumPubblicoPerIndirizzo(slug: string): Promise<AlbumSalvato | undefined> {
  return (await albumPubblicati()).find((a) => a.slug === slug);
}

export async function albumPerIndirizzo(slug: string): Promise<AlbumSalvato | undefined> {
  return (await leggiAlbum()).find((a) => a.slug === slug);
}

/** Gli album di un'unità: è l'ambito di un referente di unità (§05). */
export async function albumDiUnita(unitaChiave: UnitaKey): Promise<AlbumSalvato[]> {
  return (await leggiAlbum()).filter((a) => a.unita === unitaChiave);
}

// --------------------------------------------------------------------------
// Creazione e modifica
// --------------------------------------------------------------------------

export interface NuovoAlbum {
  titolo: string;
  anno: string;
  unita: UnitaKey;
  data: string;
  sottotitolo: string;
  tag: string;
}

/** Indirizzo libero a partire dal titolo: se è già preso si aggiunge un numero. */
export async function indirizzoLibero(titolo: string): Promise<string> {
  const base = inIndirizzo(titolo) || "album";
  const presi = new Set((await leggiAlbum()).map((a) => a.slug));
  if (!presi.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!presi.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return (
    d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null
  );
}

export async function creaAlbum(
  dati: NuovoAlbum,
  _adesso: number,
  autore: string,
): Promise<string> {
  const slug = await indirizzoLibero(dati.titolo);
  try {
    return transazione((d) => {
      semina(d);

      const etichetta = displayInEtichetta(dati.anno);
      const anno = etichetta
        ? d.select({ id: anniSociali.id }).from(anniSociali).where(eq(anniSociali.etichetta, etichetta)).get()
        : undefined;
      if (!anno) {
        // l'azione valida già la forma dell'anno; qui manca la riga, ed è un
        // errore di configurazione del reticolo, non un dato da inventare
        throw new Error(`anno sociale non registrato: ${dati.anno}`);
      }

      const unitaId = eDiGruppo(dati.unita)
        ? null
        : (d.select({ id: unita.id }).from(unita).where(eq(unita.chiave, dati.unita)).get()?.id ??
          null);

      d.insert(tabella)
        .values({
          slug,
          annoId: anno.id,
          unitaId,
          titolo: dati.titolo,
          dataTesto: dati.data,
          sottotitolo: dati.sottotitolo,
          tag: dati.tag,
          // nasce in bozza: la pubblicazione la decide un gestore
          stato: statoInDb("bozza"),
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
          // chi l'ha creato, e non cambia più (0014): prima della migrazione la
          // colonna non c'è, e l'album nasce «di nessuno» come quelli vecchi
          ...(haColonna(d, "album", "creato_da") ? { creatoDa: idAutore(d, autore) } : {}),
        })
        .run();
      return slug;
    });
  } catch (errore) {
    solleva("album.creaAlbum", errore);
  }
}

/** Applica una modifica e aggiorna autore e data. `false` se non esiste. */
function modifica(
  d: Handle,
  slug: string,
  valori: Partial<{
    titolo: string;
    annoId: number;
    unitaId: number | null;
    dataTesto: string;
    sottotitolo: string;
    tag: string;
    escluse: number;
    stato: Stato;
  }>,
  autore: string,
): boolean {
  const esiste = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
  if (!esiste) return false;

  d.update(tabella)
    .set({
      ...(valori.titolo !== undefined ? { titolo: valori.titolo } : {}),
      ...(valori.annoId !== undefined ? { annoId: valori.annoId } : {}),
      ...(valori.unitaId !== undefined ? { unitaId: valori.unitaId } : {}),
      ...(valori.dataTesto !== undefined ? { dataTesto: valori.dataTesto } : {}),
      ...(valori.sottotitolo !== undefined ? { sottotitolo: valori.sottotitolo } : {}),
      ...(valori.tag !== undefined ? { tag: valori.tag } : {}),
      ...(valori.escluse !== undefined ? { escluse: valori.escluse } : {}),
      ...(valori.stato !== undefined ? { stato: statoInDb(valori.stato) } : {}),
      aggiornatoIl: adessoIso(),
      autoreId: idAutore(d, autore),
    })
    .where(eq(tabella.slug, slug))
    .run();
  return true;
}

export async function aggiornaAlbum(
  slug: string,
  dati: Partial<NuovoAlbum> & { escluse?: number },
  _adesso: number,
  autore: string,
): Promise<boolean> {
  try {
    return transazione((d) => {
      semina(d);

      // anno e unità arrivano come stringhe dell'applicazione: si risolvono in
      // chiavi esterne, e se non si risolvono si lasciano stare invece di
      // scrivere un riferimento inventato
      let annoId: number | undefined;
      if (dati.anno !== undefined) {
        const etichetta = displayInEtichetta(dati.anno);
        annoId = etichetta
          ? d.select({ id: anniSociali.id }).from(anniSociali).where(eq(anniSociali.etichetta, etichetta)).get()?.id
          : undefined;
      }

      let unitaId: number | null | undefined;
      if (dati.unita !== undefined) {
        unitaId = eDiGruppo(dati.unita)
          ? null
          : (d.select({ id: unita.id }).from(unita).where(eq(unita.chiave, dati.unita)).get()?.id ??
            null);
      }

      return modifica(
        d,
        slug,
        {
          titolo: dati.titolo,
          annoId,
          unitaId,
          dataTesto: dati.data,
          sottotitolo: dati.sottotitolo,
          tag: dati.tag,
          escluse: dati.escluse,
        },
        autore,
      );
    });
  } catch (errore) {
    solleva("album.aggiornaAlbum", errore);
  }
}

/**
 * `seUguale`, se c'è, guarda l'album com'è **dentro** la transazione e può
 * fermare il cambio restituendo `false`. È il confronto con l'impronta di
 * quello che chi approva ha visto (BIZ-02): fatto prima, su una copia letta
 * prima delle attese del cancello, una modifica arrivata nel mezzo andava
 * online lo stesso (report QA, BUG-011). Con `BEGIN IMMEDIATE` nessuno scrive
 * fra il confronto e l'`UPDATE`.
 */
export async function cambiaStatoAlbum(
  slug: string,
  stato: Stato,
  _adesso: number,
  autore: string,
  seUguale?: (attuale: AlbumSalvato) => boolean,
): Promise<boolean> {
  try {
    return transazione((d) => {
      semina(d);
      if (seUguale) {
        const riga = d
          .select(COLONNE)
          .from(tabella)
          .innerJoin(anniSociali, eq(tabella.annoId, anniSociali.id))
          .leftJoin(unita, eq(tabella.unitaId, unita.id))
          .leftJoin(utenti, eq(tabella.autoreId, utenti.id))
          .where(eq(tabella.slug, slug))
          .get();
        if (!riga) return false;
        const attuale = comeAlbum(riga, fotoPerAlbum(d, [riga.id]).get(riga.id) ?? []);
        if (!seUguale(attuale)) return false;
      }
      return modifica(d, slug, { stato }, autore);
    });
  } catch (errore) {
    solleva("album.cambiaStatoAlbum", errore);
  }
}

export async function eliminaAlbum(slug: string): Promise<boolean> {
  let file: string[] = [];
  try {
    const fatto = transazione((d) => {
      semina(d);
      const trovato = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
      if (!trovato) return false;

      // i nomi dei file prima di cancellare: dopo il CASCADE non ci sono più
      file = d
        .select({ file: tabellaFoto.file })
        .from(tabellaFoto)
        .where(eq(tabellaFoto.albumId, trovato.id))
        .all()
        .map((f) => f.file);

      // le fotografie cadono da sole: ON DELETE CASCADE
      d.delete(tabella).where(eq(tabella.slug, slug)).run();
      return true;
    });

    // i file **dopo** il commit: se la transazione fallisse, cancellarli prima
    // vorrebbe dire aver perso le immagini e riavuto le righe che le indicizzano
    if (fatto)
      for (const f of file) {
        await cancellaCaricato(f);
        await cancellaDerivate(f);
      }
    return fatto;
  } catch (errore) {
    solleva("album.eliminaAlbum", errore);
  }
}

// --------------------------------------------------------------------------
// Fotografie
// --------------------------------------------------------------------------

/**
 * Aggiunge una fotografia a un album.
 *
 * Il file viene salvato con un nome generato qui — mai quello scelto da chi
 * carica: un nome che arriva da fuori è un percorso che arriva da fuori.
 */
export async function aggiungiFoto(
  slug: string,
  dati: Buffer,
  didascalia: string,
  adesso: number,
  autore: string,
): Promise<{ ok: true; foto: Fotografia } | { ok: false; errore: string }> {
  /*
   * Le misure le legge `sharp` e non più l'annusatore di intestazioni.
   *
   * Tre motivi. Riconosce anche i formati che l'annusatore non sa leggere;
   * applica l'orientamento EXIF, quindi una foto verticale scattata col telefono
   * di traverso risulta verticale invece che orizzontale; e rifiuta subito ciò
   * che non riuscirebbe a convertire, mentre chi ha caricato è ancora davanti
   * allo schermo — invece di accettare e fallire tre minuti dopo in coda.
   */
  let misure;
  try {
    misure = await misureVere(dati);
  } catch (e) {
    return { ok: false, errore: e instanceof ErroreDerivate ? e.message : "File non leggibile." };
  }

  /*
   * Il lato massimo si controlla **qui**, prima di scrivere qualunque cosa.
   *
   * Lo controllava chi chiama, dopo: `caricaFoto` guardava le misure nell'esito
   * e, se erano fuori, richiamava `togliFoto`. Sembra equivalente e non lo è,
   * perché nel frattempo questa funzione ha già scritto l'originale, inserito
   * la riga **e messo in coda la conversione** — e la coda parte subito.
   * `togliFoto` portava via riga e originale, ma le tre derivate erano già
   * state prodotte da un lavoro che nessuno fermava: restavano sul disco senza
   * nessuna riga che le nominasse.
   *
   * Provato dal vivo con un'immagine 9000×7000: rifiutata correttamente, e
   * tre `.webp` rimasti in archivio. Sono fotografie di minori senza una riga
   * di database: nessun cancello dei consensi le governa, nessuna schermata le
   * elenca, e `npm run db:orfani` le vede solo dopo i sette giorni di grazia.
   * Un referente che riprova tre volte con lo stesso scatto ne lascia nove.
   *
   * Controllandolo prima non si scrive niente da disfare, che è la sola forma
   * di pulizia che non può fallire a metà.
   */
  if (misure.larghezza > FOTO_LATO_MAX || misure.altezza > FOTO_LATO_MAX) {
    return {
      ok: false,
      errore: `${misure.larghezza}×${misure.altezza}: il lato massimo è ${FOTO_LATO_MAX} px.`,
    };
  }

  /*
   * L'originale si scrive **ripulito dei metadati**, non come è arrivato.
   *
   * `/foto-file/[file]` serve l'originale come ripiego quando una derivata
   * manca, e queste sono fotografie di minori: senza questa riga, in quella
   * finestra uscivano con dentro le coordinate GPS del campo. Il perché per
   * esteso è su `ripulisciOriginale`.
   *
   * Il contenitore può **cambiare** — un HEIC diventa un JPEG — quindi
   * estensione, tipo MIME e peso si prendono da quello che è stato scritto e
   * non da quello che è stato caricato. Registrare `image/heic` su un file che
   * sul disco è un JPEG vorrebbe dire un `Content-Type` sbagliato, cioè
   * un'immagine che il browser non apre.
   */
  /*
   * Anche questa decodifica può fallire, e va raccolta come l'altra.
   *
   * `misureVere` legge l'intestazione: un JPEG troncato a metà ha
   * l'intestazione intatta, dichiara le sue misure e passa. È qui — alla prima
   * decodifica vera dei pixel — che salta fuori «VipsJpeg: premature end of
   * JPEG image», e senza questo `try` l'eccezione usciva dalla Server Action:
   * il referente che aveva caricato un file rovinato — una copia interrotta, una
   * scheda SD che se ne va — riceveva una pagina «500: Internal Server Error»
   * invece di sapere quale fotografia rifare.
   *
   * Il messaggio dice che il file è rovinato e non che cosa ha detto libvips:
   * il testo della libreria non aiuta chi legge e nomina il nostro stack.
   */
  let pulito;
  try {
    pulito = await ripulisciOriginale(dati, misure.contenitore);
  } catch {
    return {
      ok: false,
      errore: "Il file è incompleto o rovinato: non si riesce ad aprirlo.",
    };
  }

  const est = ESTENSIONI[pulito.contenitore];
  /*
   * Il suffisso casuale perché due caricamenti nello stesso album con lo stesso
   * `adesso` (un doppio invio, gli offset `t+i` di due lotti che si
   * sovrappongono) avevano lo stesso nome: il secondo sovrascriveva il file del
   * primo e poi, fallita la transazione sul nome unico, lo cancellava — la riga
   * del primo restava senza originale (report QA, BUG-006). La scrittura
   * esclusiva è la rete: un nome già preso fa fallire questo caricamento prima
   * di toccare il file dell'altro, e il `catch` qui sotto non c'è ancora.
   */
  const file = `foto-${slug}-${adesso}-${randomBytes(4).toString("hex")}.${est}`;

  // Il file **prima** della transazione: §18 vieta di tenerla aperta durante
  // un'operazione su filesystem.
  try {
    await scriviCaricato(file, pulito.dati, { esclusivo: true });
  } catch {
    return { ok: false, errore: "Non si è riusciti a salvare la fotografia: riprova." };
  }

  const foto: Fotografia = {
    file,
    tipo: TIPI_MIME[pulito.contenitore],
    larghezza: misure.larghezza,
    altezza: misure.altezza,
    didascalia: didascalia.trim(),
  };

  let esito: { ok: true; foto: Fotografia } | { ok: false; errore: string };
  try {
    esito = transazione((d) => {
      semina(d);
      const album = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
      if (!album) return { ok: false as const, errore: "L’album non esiste più." };

      const massimo =
        d
          .select({ m: sql<number | null>`max(${tabellaFoto.ordine})` })
          .from(tabellaFoto)
          .where(eq(tabellaFoto.albumId, album.id))
          .get()?.m ?? -1;

      const inserita = d
        .insert(tabellaFoto)
        .values({
          albumId: album.id,
          file,
          tipo: foto.tipo,
          larghezza: foto.larghezza,
          altezza: foto.altezza,
          peso: pulito.dati.length,
          didascalia: foto.didascalia,
          ordine: massimo + 1,
        })
        .returning({ id: tabellaFoto.id })
        .get();

      /*
       * Il lavoro nasce **dentro** la stessa transazione della fotografia.
       *
       * Se l'inserimento si annullasse, un lavoro creato prima resterebbe in
       * coda a cercare una riga che non c'è; creato dopo, una transazione
       * riuscita e un processo che muore un istante dopo lascerebbero una
       * fotografia senza derivate e senza niente che se ne ricordi. Insieme, o
       * ci sono tutt'e due o nessuno dei due.
       */
      accodaIn(d, inserita.id);

      // l'album risulta toccato: è quello che l'elenco dell'area mostra
      modifica(d, slug, {}, autore);
      return { ok: true as const, foto };
    });
  } catch (errore) {
    await cancellaCaricato(file);
    solleva("album.aggiungiFoto", errore);
  }

  if (!esito.ok) await cancellaCaricato(file);
  // dopo il commit, se no si smaltirebbe un lavoro che la transazione può
  // ancora annullare. Non si aspetta: §8 dice «mentre il referente fa altro».
  else avvia();
  return esito;
}

/**
 * Elimina una fotografia dall'album: la mette nel cestino. Vero se c'era.
 *
 * Fino al 7 ottobre 2026 cancellava riga e file subito, e una fotografia tolta
 * per sbaglio non tornava più (audit degli accessi, A-1). Adesso la riga
 * resta, con quando e chi; l'album non la mostra più, la rotta non la serve, e
 * per trenta giorni un gestore la può rimettere dal cestino o cancellare
 * per sempre. Dopo la porta via il lavoro notturno (`svuotaCestino`).
 *
 * Su un database senza la 0022 — la finestra fra compilazione e migrazione del
 * rilascio — fa quello che faceva prima: cancella.
 */
export async function togliFoto(
  slug: string,
  file: string,
  adesso: number,
  autore: string,
): Promise<boolean> {
  try {
    let subito = false;
    const fatto = transazione((d) => {
      semina(d);
      const album = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
      if (!album) return false;

      const cestino = haColonna(d, "foto", "eliminata_il");
      const trovata = d
        .select({ id: tabellaFoto.id })
        .from(tabellaFoto)
        .where(
          and(
            eq(tabellaFoto.albumId, album.id),
            eq(tabellaFoto.file, file),
            cestino ? isNull(tabellaFoto.eliminataIl) : undefined,
          ),
        )
        .get();
      if (!trovata) return false;

      if (cestino) {
        const da = d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, autore)).get();
        d.update(tabellaFoto)
          .set({ eliminataIl: new Date(adesso).toISOString(), eliminataDa: da?.id ?? null })
          .where(eq(tabellaFoto.id, trovata.id))
          .run();
      } else {
        d.delete(tabellaFoto).where(eq(tabellaFoto.id, trovata.id)).run();
        subito = true;
      }
      modifica(d, slug, {}, autore);
      return true;
    });

    if (fatto && subito) {
      await cancellaCaricato(file);
      await cancellaDerivate(file);
    }
    return fatto;
  } catch (errore) {
    solleva("album.togliFoto", errore);
  }
}

/** Le fotografie eliminate di un album, le più recenti prima. */
export async function fotoNelCestino(slug: string): Promise<FotoNelCestino[]> {
  const d = dbSeEsiste();
  if (!d || !haColonna(d, "foto", "eliminata_il")) return [];
  try {
    return d
      .select({
        file: tabellaFoto.file,
        larghezza: tabellaFoto.larghezza,
        altezza: tabellaFoto.altezza,
        didascalia: tabellaFoto.didascalia,
        eliminataIl: tabellaFoto.eliminataIl,
        eliminataDa: utenti.utente,
      })
      .from(tabellaFoto)
      .innerJoin(tabella, eq(tabellaFoto.albumId, tabella.id))
      .leftJoin(utenti, eq(tabellaFoto.eliminataDa, utenti.id))
      .where(and(eq(tabella.slug, slug), isNotNull(tabellaFoto.eliminataIl)))
      .orderBy(desc(tabellaFoto.eliminataIl), desc(tabellaFoto.id))
      .all()
      .map((r) => ({
        file: r.file,
        larghezza: r.larghezza,
        altezza: r.altezza,
        didascalia: r.didascalia,
        eliminataIl: isoInMs(r.eliminataIl!),
        eliminataDa: r.eliminataDa ?? "",
      }));
  } catch (errore) {
    solleva("album.fotoNelCestino", errore);
  }
}

/**
 * Rimette nell'album una fotografia del cestino. Vero se c'era.
 *
 * Torna in fondo all'album? No: al posto che aveva, perché `ordine` non è mai
 * cambiato. Chi la rimette è un gestore — lo controlla l'azione —, quindi
 * l'album pubblicato resta pubblicato.
 */
export async function ripristinaFoto(slug: string, file: string, autore: string): Promise<boolean> {
  try {
    return transazione((d) => {
      if (!haColonna(d, "foto", "eliminata_il")) return false;
      const album = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
      if (!album) return false;
      const n = d
        .update(tabellaFoto)
        .set({ eliminataIl: null, eliminataDa: null })
        .where(
          and(
            eq(tabellaFoto.albumId, album.id),
            eq(tabellaFoto.file, file),
            isNotNull(tabellaFoto.eliminataIl),
          ),
        )
        .run().changes;
      if (n === 0) return false;
      modifica(d, slug, {}, autore);
      return true;
    });
  } catch (errore) {
    solleva("album.ripristinaFoto", errore);
  }
}

/**
 * Cancella per sempre una fotografia del cestino: riga, originale e derivate.
 * Solo una che è già nel cestino — una fotografia dell'album si elimina prima.
 *
 * Serve a non aspettare trenta giorni quando il motivo è serio: un genitore che
 * ritira il consenso, un volto che non doveva esserci.
 */
export async function cancellaDalCestino(slug: string, file: string): Promise<boolean> {
  try {
    const fatto = transazione((d) => {
      if (!haColonna(d, "foto", "eliminata_il")) return false;
      const album = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
      if (!album) return false;
      return (
        d
          .delete(tabellaFoto)
          .where(
            and(
              eq(tabellaFoto.albumId, album.id),
              eq(tabellaFoto.file, file),
              isNotNull(tabellaFoto.eliminataIl),
            ),
          )
          .run().changes > 0
      );
    });
    // i file dopo il commit, come in `eliminaAlbum`
    if (fatto) {
      await cancellaCaricato(file);
      await cancellaDerivate(file);
    }
    return fatto;
  } catch (errore) {
    solleva("album.cancellaDalCestino", errore);
  }
}

export { GIORNI_CESTINO, type FotoNelCestino };

/**
 * Il lavoro notturno: cancella per sempre le fotografie eliminate da più di
 * `GIORNI_CESTINO` giorni. Restituisce i file portati via.
 *
 * Righe prima, file dopo, come ovunque: un file senza riga lo trova
 * `orfani.mjs`, una riga senza file sarebbe un riquadro rotto.
 */
export async function svuotaCestino(adesso = Date.now()): Promise<string[]> {
  const d = dbSeEsiste();
  if (!d) return [];
  const limite = new Date(adesso - GIORNI_CESTINO * 24 * 60 * 60 * 1000).toISOString();
  let file: string[] = [];
  try {
    transazione((t) => {
      if (!haColonna(t, "foto", "eliminata_il")) return;
      const scadute = and(isNotNull(tabellaFoto.eliminataIl), lt(tabellaFoto.eliminataIl, limite));
      file = t
        .select({ file: tabellaFoto.file })
        .from(tabellaFoto)
        .where(scadute)
        .all()
        .map((r) => r.file);
      if (file.length > 0) t.delete(tabellaFoto).where(scadute).run();
    });
  } catch (errore) {
    solleva("album.svuotaCestino", errore);
  }
  for (const f of file) {
    await cancellaCaricato(f);
    await cancellaDerivate(f);
  }
  return file;
}

/**
 * Nasconde una fotografia dell'album, o la rimette. Vero se c'era.
 *
 * Il file non si tocca: l'album non la mostra più e la rotta non la serve al
 * pubblico, ma chi gestisce l'album la ritrova dov'era. È il «togliere» del
 * social media manager, che le fotografie non le elimina (6 ottobre 2026).
 * L'album risulta toccato, come per ogni altra modifica: lo dice l'elenco
 * dell'area, e l'impronta che la coda d'approvazione confronta cambia.
 */
export async function nascondiFoto(
  slug: string,
  file: string,
  nascosta: boolean,
  autore: string,
): Promise<boolean> {
  try {
    return transazione((d) => {
      if (!haColonna(d, "foto", "nascosta")) return false;
      semina(d);
      const album = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get();
      if (!album) return false;
      const n = d
        .update(tabellaFoto)
        .set({ nascosta: nascosta ? 1 : 0 })
        .where(
          and(
            eq(tabellaFoto.albumId, album.id),
            eq(tabellaFoto.file, file),
            // una fotografia nel cestino non si nasconde né si rimette da qui
            haColonna(d, "foto", "eliminata_il") ? isNull(tabellaFoto.eliminataIl) : undefined,
          ),
        )
        .run().changes;
      if (n === 0) return false;
      modifica(d, slug, {}, autore);
      return true;
    });
  } catch (errore) {
    solleva("album.nascondiFoto", errore);
  }
}

/**
 * La fotografia è servibile solo se appartiene a un album **pubblicato**.
 *
 * È il punto in cui si evita che un indirizzo indovinato mostri le foto di un
 * album ancora in revisione: la pagina non le linka, ma il file esiste, e senza
 * questo controllo basterebbe conoscerne il nome.
 */
export async function fotoPubblica(
  file: string,
): Promise<{
  tipo: string;
  derivate: boolean;
  serratura: SerraturaAlbum;
  unita: UnitaKey;
  copertina: boolean;
} | null> {
  const t = await perFile(file, true);
  return t
    ? {
        tipo: t.tipo,
        derivate: t.derivate,
        serratura: t.serratura,
        unita: t.unita,
        copertina: t.copertina,
      }
    : null;
}

/**
 * Come sopra, ma per chi è entrato: vede anche bozze e revisioni.
 *
 * Restituisce anche `unita` e `stato` perché la rotta che serve il file deve
 * poter decidere l'ambito: `puoScrivereSu(sessione, interna.unita)`. Un referente
 * unità non deve poter scaricare la bozza di un'altra unità conoscendo il nome
 * del file, e la rotta risponde 404 in entrambi i casi — «non esiste» e «non è
 * tua» danno la stessa risposta, altrimenti si direbbe a chi tira a indovinare
 * che il file c'è.
 *
 * `unita` è la chiave dell'applicazione, quindi `gruppo` quando `unita_id` è
 * nullo: è ciò che `puoScrivereSu` confronta.
 */
export async function fotoInterna(
  file: string,
): Promise<{
  tipo: string;
  unita: UnitaKey;
  stato: string;
  derivate: boolean;
  /** l'album, per chiedere chi l'ha creato (`puoSuAlbumId`) */
  albumId: number;
  /** nel cestino: la rotta la serve solo a chi può pubblicare l'album */
  eliminata: boolean;
} | null> {
  const t = await perFile(file, false);
  return t
    ? {
        tipo: t.tipo,
        unita: t.unita,
        stato: t.stato,
        derivate: t.derivate,
        albumId: t.serratura.id,
        eliminata: t.eliminata,
      }
    : null;
}

/**
 * `unita` è una `UnitaKey`, non una `string` qualunque.
 *
 * Il tipo era dichiarato largo mentre il valore era già stretto —
 * `chiaveUnita()` restituisce una `UnitaKey` e mai altro. Stretto nella fase 14,
 * quando la rotta delle fotografie ha cominciato a passare quell'unità al
 * cancello come ambito: con `string` non compilava, e la risposta giusta era
 * dichiarare quello che la funzione fa davvero, non forzare il tipo al
 * chiamante.
 */
async function perFile(
  file: string,
  soloPubblicati: boolean,
): Promise<{
  tipo: string;
  unita: UnitaKey;
  stato: string;
  derivate: boolean;
  serratura: SerraturaAlbum;
  /** è la prima fotografia dell'album, quella che fa da copertina */
  copertina: boolean;
  /** è nel cestino: esce solo per chi la può rimettere */
  eliminata: boolean;
} | null> {
  const d = dbSeEsiste();
  if (!d) return null;

  try {
    // una fotografia nascosta, per il pubblico, non c'è: né in pagina né qui
    const conNascoste = haColonna(d, "foto", "nascosta");
    // e una eliminata non c'è per nessuno, nemmeno come copertina: il cestino
    // la mostra solo a chi la può rimettere (`eliminata`, qui sotto)
    const conCestino = haColonna(d, "foto", "eliminata_il");
    const nelSito = conCestino ? isNull(tabellaFoto.eliminataIl) : undefined;
    const visibile = and(conNascoste ? eq(tabellaFoto.nascosta, 0) : undefined, nelSito);
    const trovata = d
      .select({
        ...(conCestino ? { eliminataIl: tabellaFoto.eliminataIl } : {}),
        tipo: tabellaFoto.tipo,
        unita: unita.chiave,
        stato: tabella.stato,
        derivateIl: tabellaFoto.derivateIl,
        albumId: tabella.id,
        fotoId: tabellaFoto.id,
        password: tabella.passwordAccesso,
        versione: tabella.accessoVersione,
      })
      .from(tabellaFoto)
      .innerJoin(tabella, eq(tabellaFoto.albumId, tabella.id))
      .leftJoin(unita, eq(tabella.unitaId, unita.id))
      .where(
        soloPubblicati
          ? and(eq(tabellaFoto.file, file), eq(tabella.stato, statoInDb("pubblicato")), visibile)
          : eq(tabellaFoto.file, file),
      )
      .get() as
      | {
          eliminataIl?: string | null;
          tipo: string;
          unita: string | null;
          stato: string;
          derivateIl: string | null;
          albumId: number;
          fotoId: number;
          password: string | null;
          versione: string | null;
        }
      | undefined;
    if (!trovata) return null;
    // la copertina è la prima nell'ordine con cui l'album si legge
    // (`fotoPerAlbum`: `ordine`, poi `id`), la stessa che le pagine mettono in
    // testa — fra le visibili: una nascosta non fa da copertina a nessuno
    const prima = d
      .select({ id: tabellaFoto.id })
      .from(tabellaFoto)
      .where(and(eq(tabellaFoto.albumId, trovata.albumId), visibile))
      .orderBy(asc(tabellaFoto.ordine), asc(tabellaFoto.id))
      .limit(1)
      .get();
    return {
      tipo: trovata.tipo,
      unita: chiaveUnita(trovata.unita),
      stato: dbInStato(trovata.stato as Parameters<typeof dbInStato>[0]),
      derivate: trovata.derivateIl !== null,
      // senza password la versione non vale niente: l'album resta chiuso
      serratura: { id: trovata.albumId, versione: trovata.password ? trovata.versione : null },
      copertina: prima?.id === trovata.fotoId,
      eliminata: Boolean(trovata.eliminataIl),
    };
  } catch (errore) {
    solleva("album.perFile", errore);
  }
}

/**
 * L'identificativo numerico di un album dal suo indirizzo.
 *
 * L'indirizzo pubblico è lo `slug` e gli id non finiscono mai in un URL (§2 del
 * piano); ma `album_assenze` punta all'album per identificativo, e chi dichiara
 * un'assenza parte da uno slug. La traduzione sta qui, in una funzione sola.
 */
export async function idAlbumPerIndirizzo(slug: string): Promise<number | null> {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    return d.select({ id: tabella.id }).from(tabella).where(eq(tabella.slug, slug)).get()?.id ?? null;
  } catch (errore) {
    solleva("album.idAlbumPerIndirizzo", errore);
  }
}

/**
 * Chi ha creato l'album, come identificativo d'account; `null` se non si sa.
 *
 * Non `autore`, che è chi l'ha toccato per ultimo: questa è la domanda «di chi
 * è», ed è quella con cui il social media manager agisce solo sui propri album
 * (`soloIPropri` in `lib/auth/decisione.ts`). Su un database fermo a prima
 * della 0014 risponde `null` — cioè «di nessuno», il valore prudente.
 */
export function creatoreAlbumPerId(id: number): number | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    if (!haColonna(d, "album", "creato_da")) return null;
    return d.select({ c: tabella.creatoDa }).from(tabella).where(eq(tabella.id, id)).get()?.c ?? null;
  } catch (errore) {
    solleva("album.creatoreAlbumPerId", errore);
  }
}

/** Come `creatoreAlbumPerId`, a partire dall'indirizzo. */
export function creatoreAlbum(slug: string): number | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    if (!haColonna(d, "album", "creato_da")) return null;
    return (
      d.select({ c: tabella.creatoDa }).from(tabella).where(eq(tabella.slug, slug)).get()?.c ?? null
    );
  } catch (errore) {
    solleva("album.creatoreAlbum", errore);
  }
}
