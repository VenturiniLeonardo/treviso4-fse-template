import { and, asc, eq, isNotNull, like } from "drizzle-orm";
import { cache } from "react";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { haColonna } from "@/lib/db/colonne";
import { solleva } from "@/lib/db/errori";
import { adessoIso, isoInMs, statoInDb } from "@/lib/db/mappa";
import {
  pagineTesti,
  unita as tabellaUnita,
  unitaPersone,
  unitaProposte,
  utenti,
} from "@/lib/db/schema";
import { type Unita, UNITA, type UnitaKey } from "@/lib/data";
import {
  campoUnita,
  type CampoUnita,
  type CampoTestoLungo,
  chiaveTesto,
  daParagrafi,
  eCampoTestoLungo,
  inParagrafi,
  type Persona,
  type Proposta,
  type TipoPersona,
} from "@/lib/unita-contenuti";

/**
 * Contenuti delle unità: quello che i referenti cambiano, sopra quello che il codice
 * consegna.
 *
 * Modulo di solo server. È il gemello di `lib/gruppo.ts` per le sei unità, e ne
 * ripete la proprietà che conta: **si conservano solo le differenze.** Una
 * colonna nulla, una riga assente in `pagine_testi`, nessuna persona in
 * `unita_persone` — tutte e tre significano la stessa cosa, «nessuno ha
 * personalizzato questo, usa il predefinito di `lib/data.ts`».
 *
 * Non è una comodità: è quello che tiene vivo `lib/data.ts` come sorgente. I
 * testi consegnati sono in gran parte i segnaposto del mockup, e verranno
 * corretti nel codice mano a mano che il gruppo scrive quelli veri. Se lo store
 * ne facesse una copia al primo salvataggio, quelle correzioni non arriverebbero
 * più sul sito e nessuno capirebbe perché.
 *
 * ## La firma pubblica è la stessa che le pagine già usavano
 *
 * `leggiUnita()` restituisce `Unita[]`, `unitaSalvataPerSlug()` restituisce
 * `Unita | undefined`: le stesse forme di `UNITA` e `unitaPerSlug` in
 * `lib/data.ts`. Le quattro pagine pubbliche cambiano una riga d'import e un
 * `await`, non il loro corpo — che è il modo di non spostare un disegno
 * approvato mentre si cambia da dove arrivano i dati.
 *
 * ## Che cosa NON è modificabile, e dove sta scritto
 *
 * `ramo`, `ramoPlurale`, `fascia` e `logo` restano di `lib/data.ts`. I primi tre
 * sono la tassonomia dell'organizzazione — «Label 1», «Label 2» — e non sono
 * contenuto di questo sito; il logo è un'immagine che il gestore
 * sostituisce dall'anagrafica (fase 6), non un campo di testo. Vedi il commento
 * su `unita` in `lib/db/schema.ts`.
 */

/** Le colonne di contenuto che si leggono dalla tabella `unita`. */
const COLONNE = {
  chiave: tabellaUnita.chiave,
  slug: tabellaUnita.slug,
  nome: tabellaUnita.nome,
  eta: tabellaUnita.eta,
  telefono: tabellaUnita.telefono,
  occhiello: tabellaUnita.occhiello,
  motto: tabellaUnita.motto,
  ritrovo: tabellaUnita.ritrovo,
  fondazione: tabellaUnita.fondazione,
  referente: tabellaUnita.referente,
  ruoloReferente: tabellaUnita.ruoloReferente,
  sigla: tabellaUnita.sigla,
  iscritti: tabellaUnita.iscritti,
  storiaTitolo: tabellaUnita.storiaTitolo,
  notaStorico: tabellaUnita.notaStorico,
  copertina: tabellaUnita.copertina,
  copertinaLarghezza: tabellaUnita.copertinaLarghezza,
  copertinaAltezza: tabellaUnita.copertinaAltezza,
};

type Riga = { [K in keyof typeof COLONNE]: string | number | null } & {
  /** 0021: prima della migrazione la colonna non c'è, e la copertina si vede */
  copertinaNascosta?: number;
};

/** Le colonne, più quella della copertina nascosta se il database l'ha già. */
const colonne = (d: Handle) =>
  haColonna(d, "unita", "copertina_nascosta")
    ? { ...COLONNE, copertinaNascosta: tabellaUnita.copertinaNascosta }
    : COLONNE;

/**
 * Il valore salvato, o il predefinito.
 *
 * La stringa vuota conta come «non personalizzato» quanto il nullo: un referente che
 * svuota una casella e salva non vuole una riga vuota in pagina, vuole tornare
 * a come era. È lo stesso `?.trim() || predefinito` di `lib/gruppo.ts`.
 */
const oppure = (salvato: string | number | null, predefinito: string): string =>
  typeof salvato === "string" && salvato.trim() !== "" ? salvato.trim() : predefinito;

/**
 * L'etichetta degli iscritti, con il numero salvato e le parole del codice.
 *
 * Serve perché l'etichetta è **declinata**: «44 iscritti» per un'unità, «41
 * iscritte» per un'altra. Il genere non è un dato che un referente immette — è la
 * lingua — quindi si tiene il suffisso del predefinito e si sostituisce il solo
 * numero. Derivarla come `${n} iscritti` avrebbe messo il maschile su tre unità
 * su sei; aggiungere una colonna «femminile» avrebbe chiesto a qualcuno di
 * dichiarare in un modulo una cosa che `lib/data.ts` già sa.
 */
function etichettaIscritti(iscritti: number, predefinita: string): string {
  const suffisso = predefinita.replace(/^\s*\d+\s*/, "");
  return suffisso ? `${iscritti} ${suffisso}` : String(iscritti);
}

/** Le persone di un'unità, per tipo, già ordinate. */
type PersonePerTipo = Record<TipoPersona, Persona[]>;

const vuote = (): PersonePerTipo => ({ responsabile: [], staff: [], storico: [] });

/**
 * Le persone pubblicate, raggruppate per unità e per tipo.
 *
 * Una interrogazione per tutte e sei le unità: sono poche decine di righe, e sei
 * `SELECT` per disegnare una pagina che le mostra tutte sarebbero sei viaggi per
 * niente. Lo stesso motivo per cui `lib/gruppo.ts` legge i nove valori insieme.
 */
function leggiPersone(d: Handle): Map<string, PersonePerTipo> {
  const righe = d
    .select({
      id: unitaPersone.id,
      unita: tabellaUnita.chiave,
      tipo: unitaPersone.tipo,
      nome: unitaPersone.nome,
      ruolo: unitaPersone.ruolo,
      periodo: unitaPersone.periodo,
      nota: unitaPersone.nota,
      ordine: unitaPersone.ordine,
    })
    .from(unitaPersone)
    .innerJoin(tabellaUnita, eq(unitaPersone.unitaId, tabellaUnita.id))
    .where(eq(unitaPersone.stato, statoInDb("pubblicato")))
    .orderBy(asc(unitaPersone.tipo), asc(unitaPersone.ordine), asc(unitaPersone.id))
    .all();

  const per = new Map<string, PersonePerTipo>();
  for (const r of righe) {
    if (!per.has(r.unita)) per.set(r.unita, vuote());
    per.get(r.unita)![r.tipo as TipoPersona].push({
      id: r.id,
      tipo: r.tipo as TipoPersona,
      nome: r.nome,
      ruolo: r.ruolo,
      periodo: r.periodo,
      nota: r.nota,
      ordine: r.ordine,
      stato: "pubblicato",
    });
  }
  return per;
}

/**
 * Sovrappone quello che è salvato al predefinito di `lib/data.ts`.
 *
 * Le tuple tornano tuple: `responsabili`, `staff` e `storico` in `Unita` sono
 * array di array di stringhe, e le pagine li destrutturano posizionalmente. Lo
 * store non cambia quella forma — cambia solo da dove arrivano i valori.
 *
 * ## L'elenco vuoto conta come «non personalizzato», e va saputo
 *
 * Se per un'unità non c'è **nessuna** persona pubblicata di un tipo, si usa
 * l'elenco del codice. Il caso ambiguo esiste: un referente che cancella tutti i
 * responsabili si ritrova i segnaposto invece di una sezione vuota. È accettato
 * di proposito — una pagina d'unità senza nessun responsabile sembra rotta, e i
 * segnaposto dicono almeno che c'è un dato da mettere. Distinguere «vuoto
 * apposta» da «mai compilato» chiederebbe una colonna in più il cui unico scopo
 * è registrare un'azione che nessuno ha ragione di fare.
 */
function sovrapponi(
  predefinito: Unita,
  riga: Riga | undefined,
  storia: string | undefined,
  presentazione: string | undefined,
  persone: PersonePerTipo | undefined,
): Unita {
  if (!riga && storia === undefined && presentazione === undefined && !persone) {
    return predefinito;
  }

  const iscritti =
    typeof riga?.iscritti === "number" ? riga.iscritti : predefinito.iscritti;

  const inTerna = (p: Persona): [string, string, string] => [p.nome, p.ruolo, p.periodo];

  const responsabili = persone?.responsabile.length
    ? persone.responsabile.map(inTerna)
    : predefinito.responsabili;
  const staff = persone?.staff.length
    ? persone.staff.map((p): [string, string] => [p.nome, p.ruolo])
    : predefinito.staff;
  // Lo storico ha le colonne in un altro ordine — anni, nome, nota — perché è
  // così che la tabella della pagina le stampa.
  const storico = persone?.storico.length
    ? persone.storico.map((p): [string, string, string] => [p.periodo, p.nome, p.nota])
    : predefinito.storico;

  const paragrafi = storia !== undefined ? inParagrafi(storia) : [];
  // la presentazione resta una stringa, come in `lib/data.ts`: i paragrafi li
  // separa la pagina con `inParagrafi`, e qui si normalizzano solo gli a capo
  const presentata =
    presentazione !== undefined ? daParagrafi(inParagrafi(presentazione)) : "";

  return {
    ...predefinito,
    // l'anagrafica: nome ed età sono `NOT NULL` in tabella e seminati da
    // `lib/data.ts`, quindi qui il predefinito serve solo se il database non c'è
    nome: oppure(riga?.nome ?? null, predefinito.nome),
    eta: oppure(riga?.eta ?? null, predefinito.eta),
    telefono: oppure(riga?.telefono ?? null, predefinito.telefono),
    iscritti,
    iscrittiLabel: etichettaIscritti(iscritti, predefinito.iscrittiLabel),
    // i testi
    occhiello: oppure(riga?.occhiello ?? null, predefinito.occhiello),
    motto: oppure(riga?.motto ?? null, predefinito.motto),
    ritrovo: oppure(riga?.ritrovo ?? null, predefinito.ritrovo),
    fondazione: oppure(riga?.fondazione ?? null, predefinito.fondazione),
    referente: oppure(riga?.referente ?? null, predefinito.referente),
    ruoloReferente: oppure(riga?.ruoloReferente ?? null, predefinito.ruoloReferente),
    // I tre facoltativi restano facoltativi: `undefined` è ciò che la pagina
    // controlla per decidere se mostrare il proprio segnaposto, e una stringa
    // vuota non è la stessa cosa.
    ...(oppure(riga?.sigla ?? null, "") ? { sigla: oppure(riga?.sigla ?? null, "") } : {}),
    ...(oppure(riga?.storiaTitolo ?? null, "")
      ? { storiaTitolo: oppure(riga?.storiaTitolo ?? null, "") }
      : {}),
    ...(oppure(riga?.notaStorico ?? null, "")
      ? { notaStorico: oppure(riga?.notaStorico ?? null, "") }
      : {}),
    /*
     * La copertina conta solo se le tre informazioni ci sono tutte.
     *
     * Il `CHECK` `unita_copertina_completa` lo garantisce già nel database, e
     * questo controllo è la stessa prudenza che `lib/gruppo.ts` usa per il
     * marchio: un record incompleto produrrebbe un'immagine senza misure, cioè
     * il salto di layout che le misure servono a evitare. Due controlli sulla
     * stessa cosa, in due strati, e nessuno dei due è di troppo — il primo
     * impedisce che la riga esista, il secondo che una riga arrivata da altrove
     * arrivi in pagina.
     */
    ...(riga?.copertina &&
    typeof riga.copertinaLarghezza === "number" &&
    typeof riga.copertinaAltezza === "number"
      ? riga.copertinaNascosta === 1
        ? {
            // nascosta: il sito non la vede, l'area sì, da dietro il cancello
            copertinaNascosta: {
              src: `/in-attesa/${encodeURIComponent(String(riga.copertina))}`,
              larghezza: riga.copertinaLarghezza,
              altezza: riga.copertinaAltezza,
            },
          }
        : {
            copertina: {
              // la marca temporale nel nome fa da impronta: la cache dei browser
              // non tiene la copertina vecchia
              src: `/copertina/${riga.copertina}`,
              larghezza: riga.copertinaLarghezza,
              altezza: riga.copertinaAltezza,
            },
          }
      : {}),
    ...(presentata || predefinito.presentazione
      ? { presentazione: presentata || predefinito.presentazione }
      : {}),
    storia: paragrafi.length ? paragrafi : predefinito.storia,
    responsabili,
    staff,
    storico,
  };
}

/**
 * Le sei unità, con i contenuti correnti.
 *
 * `cache` lega la lettura alla richiesta: la pagina di un'unità la chiede per sé
 * e poi per la barra «altre unità», e il database si interroga una volta sola.
 *
 * Senza database si restituisce `UNITA`. È il caso legittimo della
 * compilazione, e le sei pagine unità sono prerenderizzate: devono uscire
 * comunque, con i testi del codice.
 */
export const leggiUnita = cache(async (): Promise<Unita[]> => {
  const d = dbSeEsiste();
  if (!d) return UNITA;

  try {
    const righe = new Map(
      d.select(colonne(d)).from(tabellaUnita).all().map((r) => [r.chiave, r as Riga]),
    );
    const testi = new Map(
      d
        .select({ chiave: pagineTesti.chiave, valore: pagineTesti.valore })
        .from(pagineTesti)
        .where(like(pagineTesti.chiave, "unita.%"))
        .all()
        .map((r) => [r.chiave, r.valore]),
    );
    const persone = leggiPersone(d);

    // L'ordine è quello di `UNITA`, non quello del database: `unita.ordine`
    // esiste e coincide, ma è l'ordine in cui il sito presenta le unità e sta
    // già in `lib/data.ts`. Prenderlo da due posti è il modo di farli divergere.
    return UNITA.map((predefinito) =>
      sovrapponi(
        predefinito,
        righe.get(predefinito.chiave),
        testi.get(chiaveTesto(predefinito.chiave, "storia")),
        testi.get(chiaveTesto(predefinito.chiave, "presentazione")),
        persone.get(predefinito.chiave),
      ),
    );
  } catch (errore) {
    solleva("unita-store.leggiUnita", errore);
  }
});

/** Un'unità dal suo indirizzo pubblico. Il gemello di `unitaPerSlug`. */
export async function unitaSalvataPerSlug(slug: string): Promise<Unita | undefined> {
  return (await leggiUnita()).find((u) => u.slug === slug);
}

/** Un'unità dalla sua chiave. Il gemello di `unitaPerChiave`. */
export async function unitaSalvataPerChiave(chiave: UnitaKey): Promise<Unita | undefined> {
  return (await leggiUnita()).find((u) => u.chiave === chiave);
}

/**
 * Il nome del file della copertina di un'unità, visibile o nascosta; `null` se
 * non ne ha. Serve a chi la sostituisce, che porta via quella di prima: una
 * nascosta è un file in archivio come l'altra, e dimenticarla lo lascerebbe lì.
 */
export async function fileCopertina(chiave: UnitaKey): Promise<string | null> {
  const u = await unitaSalvataPerChiave(chiave);
  const src = u?.copertina?.src ?? u?.copertinaNascosta?.src;
  // `/copertina/<file>` o `/in-attesa/<file codificato>`: il nome è l'ultimo segmento
  return src ? decodeURIComponent(src.split("/").pop() ?? "") || null : null;
}

/**
 * L'identificativo numerico di un'unità dalla sua chiave.
 *
 * Gli id non finiscono mai in un URL (§2 del piano), ma `unita_persone` e
 * `unita_proposte` puntano all'unità per identificativo, e chi scrive parte da
 * una `UnitaKey`. La traduzione sta qui, in un posto solo — come
 * `idAlbumPerIndirizzo` in `lib/album.ts`.
 */
export function idUnita(d: Handle, chiave: UnitaKey): number | null {
  const riga = d
    .select({ id: tabellaUnita.id })
    .from(tabellaUnita)
    .where(eq(tabellaUnita.chiave, chiave))
    .get();
  return riga?.id ?? null;
}

// ==========================================================================
// Scritture
// ==========================================================================

/**
 * Da nome di campo a colonna della tabella.
 *
 * Serve perché i campi arrivano dai moduli come stringhe, e una scrittura
 * costruita interpolando il nome dentro l'SQL sarebbe un'iniezione. Questa mappa
 * è anche il **filtro**: un nome che non è qui non è scrivibile, e non serve un
 * secondo elenco di campi ammessi da tenere allineato.
 *
 * `storia` non c'è di proposito: non è una colonna, sta in `pagine_testi`.
 */
const COLONNA_DI = {
  occhiello: tabellaUnita.occhiello,
  motto: tabellaUnita.motto,
  ritrovo: tabellaUnita.ritrovo,
  fondazione: tabellaUnita.fondazione,
  storiaTitolo: tabellaUnita.storiaTitolo,
  notaStorico: tabellaUnita.notaStorico,
  referente: tabellaUnita.referente,
  ruoloReferente: tabellaUnita.ruoloReferente,
  telefono: tabellaUnita.telefono,
} as const;

/** Le chiavi di `COLONNA_DI`, come tipo: i campi che vivono in una colonna. */
type CampoColonna = keyof typeof COLONNA_DI;

const eCampoColonna = (campo: string): campo is CampoColonna => campo in COLONNA_DI;

/**
 * I campi che si possono **proporre**: le colonne, e la storia.
 *
 * La storia non è una colonna e fino al 3 ottobre 2026 non si proponeva:
 * `serveApprovazione` la teneva fra i testi liberi, quindi nessuno doveva
 * metterla in coda. Il social media manager propone tutto, storia compresa, e
 * una storia che il suo salvataggio scartava in silenzio sarebbe stata il
 * difetto peggiore — «inviato ai gestori», e in coda niente.
 */
const eCampoProponibile = (campo: string): campo is CampoColonna | CampoTestoLungo =>
  eCampoColonna(campo) || eCampoTestoLungo(campo);

/** Il valore in linea di un campo proponibile, come lo scrive una casella. */
const inLineaDi = (u: Unita | undefined, campo: string): string =>
  campo === "storia"
    ? daParagrafi(u?.storia ?? [])
    : String((u as unknown as Record<string, unknown> | undefined)?.[campo] ?? "");

/**
 * L'identificativo dell'utente che sta scrivendo, o `null`.
 *
 * `null` non è un errore: gli account dimostrativi non hanno una riga in
 * `utenti`, e una modifica senza autore è meglio di una modifica rifiutata —
 * chi ha agito sta comunque nel registro, che è la fonte per «chi ha fatto che
 * cosa». È la stessa scelta di `lib/documenti-store.ts`.
 */
function idAutore(d: Handle, utente: string): number | null {
  if (!utente) return null;
  return (
    d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null
  );
}

/** L'id di un'unità, o solleva: chi scrive ha già verificato l'ambito. */
function idRichiesto(d: Handle, chiave: UnitaKey): number {
  const id = idUnita(d, chiave);
  if (id === null) throw new Error(`unità «${chiave}» non in tabella: manca db:riferimenti?`);
  return id;
}

/**
 * Scrive i testi lunghi in `pagine_testi`, come fa `lib/gruppo.ts`.
 *
 * Un valore vuoto **cancella la riga** invece di scrivere una stringa vuota:
 * l'assenza significa «usa il predefinito», e una riga vuota significherebbe
 * «il testo è vuoto» — cioè una pagina d'unità senza storia, che non è quello
 * che chi svuota una casella sta chiedendo.
 */
function scriviTesto(
  d: Handle,
  unitaChiave: UnitaKey,
  campo: CampoTestoLungo,
  valore: string,
  autore: number | null,
) {
  const chiave = chiaveTesto(unitaChiave, campo);
  if (valore.trim() === "") {
    d.delete(pagineTesti).where(eq(pagineTesti.chiave, chiave)).run();
    return;
  }
  d.insert(pagineTesti)
    .values({ chiave, valore, aggiornatoIl: adessoIso(), autoreId: autore })
    .onConflictDoUpdate({
      target: pagineTesti.chiave,
      set: { valore, aggiornatoIl: adessoIso(), autoreId: autore },
    })
    .run();
}

/**
 * Scrive i campi indicati **subito**, in una transazione sola.
 *
 * Chi la chiama ha già deciso che questi campi si pubblicano: sono i testi
 * liberi, oppure chiunque abbia `completo` sulla riga di matrice. La divisione
 * la fa `serveApprovazione` in `lib/unita-contenuti.ts`, e sta lì e non qui
 * perché la legge anche l'interfaccia.
 *
 * Tutto o niente: un guasto a metà lascerebbe la pagina dell'unità con il
 * ritrovo nuovo e il motto vecchio, ed è la stessa ragione per cui
 * `salvaRecapiti` in `lib/gruppo.ts` apre una transazione per sette valori.
 */
export async function salvaCampiUnita(
  unitaChiave: UnitaKey,
  valori: Partial<Record<CampoUnita, string>>,
  autore: string,
): Promise<void> {
  try {
    transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const autoreId = idAutore(d, autore);

      const set: Record<string, string | null> = {};
      for (const [campo, valore] of Object.entries(valori)) {
        if (eCampoTestoLungo(campo)) {
          scriviTesto(d, unitaChiave, campo, valore ?? "", autoreId);
          continue;
        }
        if (!eCampoColonna(campo)) continue;
        // vuoto ⇒ NULL, cioè «torna al predefinito». Vedi `oppure`.
        // La chiave è quella TypeScript della tabella (`storiaTitolo`), non il
        // nome SQL (`storia_titolo`): `.set()` di Drizzle scarta in silenzio le
        // chiavi che non conosce, e l'UPDATE passava lo stesso per i metadati.
        const pulito = (valore ?? "").trim();
        set[campo] = pulito === "" ? null : pulito;
      }

      if (Object.keys(set).length > 0) {
        d.update(tabellaUnita)
          .set({ ...set, aggiornatoIl: adessoIso(), autoreId })
          .where(eq(tabellaUnita.id, id))
          .run();
      }
    });
  } catch (errore) {
    solleva("unita-store.salvaCampiUnita", errore);
  }
}

/**
 * Salva i campi indicati come **proposte**, in attesa del gestore.
 *
 * Il valore nuovo aspetta in `unita_proposte` e quello in linea non si muove: è
 * la ragione per cui quella tabella esiste, e la differenza fra «mandare in
 * revisione» e «pubblicare senza dirlo a nessuno».
 *
 * `onConflictDoUpdate` sull'indice unico `(unita_id, campo)`: la seconda
 * proposta sostituisce la prima. Senza, un referente che si corregge tre volte
 * lascerebbe tre righe in coda e chi approva dovrebbe indovinare quale conta.
 *
 * Una proposta **uguale al valore in linea** non si scrive: sarebbe una voce in
 * coda che chiede di approvare un cambiamento che non c'è, e chi approva
 * imparerebbe a premere «approva» senza guardare.
 */
export async function proponiCampiUnita(
  unitaChiave: UnitaKey,
  valori: Partial<Record<CampoUnita, string>>,
  autore: string,
): Promise<number> {
  const corrente = await unitaSalvataPerChiave(unitaChiave);
  let scritte = 0;

  try {
    transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const autoreId = idAutore(d, autore);

      for (const [campo, grezzo] of Object.entries(valori)) {
        if (!eCampoProponibile(campo)) continue;
        const valore = (grezzo ?? "").trim();
        const inLinea = inLineaDi(corrente, campo).trim();
        // storia e presentazione si confrontano per paragrafi: un a capo di
        // Windows o una riga vuota in più non sono una modifica da far approvare
        const uguale =
          eCampoTestoLungo(campo)
            ? daParagrafi(inParagrafi(valore)) === inLinea
            : valore === inLinea;

        if (uguale) {
          // niente da proporre: si toglie anche una proposta precedente, perché
          // chi rimette il valore di prima sta annullando la sua richiesta
          d.delete(unitaProposte)
            .where(and(eq(unitaProposte.unitaId, id), eq(unitaProposte.campo, campo)))
            .run();
          continue;
        }

        d.insert(unitaProposte)
          .values({ unitaId: id, campo, valore, autoreId, creatoIl: adessoIso() })
          .onConflictDoUpdate({
            target: [unitaProposte.unitaId, unitaProposte.campo],
            set: { valore, autoreId, creatoIl: adessoIso() },
          })
          .run();
        scritte++;
      }
    });
  } catch (errore) {
    solleva("unita-store.proponiCampiUnita", errore);
  }
  return scritte;
}

/** Le proposte in attesa, con accanto il valore che è online adesso. */
export async function leggiProposte(): Promise<Proposta[]> {
  const d = dbSeEsiste();
  if (!d) return [];

  try {
    const righe = d
      .select({
        unita: tabellaUnita.chiave,
        campo: unitaProposte.campo,
        valore: unitaProposte.valore,
        autore: utenti.utente,
        creatoIl: unitaProposte.creatoIl,
      })
      .from(unitaProposte)
      .innerJoin(tabellaUnita, eq(unitaProposte.unitaId, tabellaUnita.id))
      .leftJoin(utenti, eq(unitaProposte.autoreId, utenti.id))
      .orderBy(asc(unitaProposte.creatoIl), asc(unitaProposte.id))
      .all();

    if (righe.length === 0) return [];

    // il valore in linea si legge dallo store, non dalla colonna: per i campi
    // non personalizzati è quello di `lib/data.ts`, ed è quello che chi approva
    // vede in pagina
    const unita = await leggiUnita();
    return righe.map((r) => {
      const u = unita.find((x) => x.chiave === r.unita);
      return {
        unita: r.unita as UnitaKey,
        campo: r.campo as CampoUnita,
        attuale: inLineaDi(u, r.campo),
        proposto: r.valore,
        autore: r.autore ?? "",
        quando: isoInMs(r.creatoIl),
      };
    });
  } catch (errore) {
    solleva("unita-store.leggiProposte", errore);
  }
}

/**
 * Approva una proposta: il valore passa nella colonna e la riga sparisce.
 *
 * In una transazione sola, perché le due metà non hanno senso separate — una
 * proposta applicata che resta in coda si riapproverebbe, una proposta
 * cancellata che non si è applicata è lavoro perso senza traccia.
 *
 * `false` se la proposta non c'è più: due gestori che approvano la stessa
 * voce non devono vedere un errore, il secondo deve vedere «non c'è più».
 */
export async function approvaProposta(
  unitaChiave: UnitaKey,
  campo: string,
  autore: string,
): Promise<boolean> {
  if (!eCampoProponibile(campo)) return false;

  try {
    return transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const riga = d
        .select({ valore: unitaProposte.valore })
        .from(unitaProposte)
        .where(and(eq(unitaProposte.unitaId, id), eq(unitaProposte.campo, campo)))
        .get();
      if (!riga) return false;

      const pulito = riga.valore.trim();
      if (eCampoTestoLungo(campo)) {
        // storia e presentazione stanno in `pagine_testi`: stessa scrittura del
        // salvataggio diretto, vuoto compreso — che cancella la riga e rimette
        // il testo del progetto
        scriviTesto(d, unitaChiave, campo, riga.valore, idAutore(d, autore));
      } else {
        d.update(tabellaUnita)
          .set({
            // chiave TypeScript, non nome SQL: vedi `salvaCampiUnita`
            [campo]: pulito === "" ? null : pulito,
            aggiornatoIl: adessoIso(),
            autoreId: idAutore(d, autore),
          })
          .where(eq(tabellaUnita.id, id))
          .run();
      }
      d.delete(unitaProposte)
        .where(and(eq(unitaProposte.unitaId, id), eq(unitaProposte.campo, campo)))
        .run();
      return true;
    });
  } catch (errore) {
    solleva("unita-store.approvaProposta", errore);
  }
}

/**
 * Rifiuta una proposta: la riga sparisce e la colonna non si muove.
 *
 * Non si conserva il valore rifiutato. È una scelta: la traccia di che cosa era
 * stato proposto e da chi sta nel registro, che è il posto delle tracce, e
 * tenerne una copia in una tabella di lavoro vorrebbe dire che «rifiutato»
 * diventa un terzo stato da mostrare da qualche parte.
 */
export async function rifiutaProposta(unitaChiave: UnitaKey, campo: string): Promise<boolean> {
  try {
    return transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const n = d
        .delete(unitaProposte)
        .where(and(eq(unitaProposte.unitaId, id), eq(unitaProposte.campo, campo)))
        .run().changes;
      return n > 0;
    });
  } catch (errore) {
    solleva("unita-store.rifiutaProposta", errore);
  }
}

// --------------------------------------------------------------------------
// Persone
// --------------------------------------------------------------------------

/**
 * Un elenco di persone come arriva dal modulo: senza id, senza stato.
 * L'ordine dell'array **è** l'ordine in pagina.
 */
export interface PersonaImmessa {
  nome: string;
  ruolo: string;
  periodo: string;
  nota: string;
}

/**
 * Scrive l'elenco di un tipo di persone, in uno stato dato.
 *
 * ## Perché si stagia l'elenco intero e non la singola persona
 *
 * Un referente di unità che aggiorna i responsabili fa tre cose insieme: aggiunge chi è
 * arrivato, corregge un ruolo, e toglie chi è uscito. Se ognuna fosse una
 * modifica a sé, la coda mostrerebbe tre voci da approvare in un ordine che
 * conta — e approvare la cancellazione senza l'aggiunta lascerebbe la pagina
 * dell'unità con un responsabile solo. Peggio: una **cancellazione** non ha una
 * riga in cui aspettare, perché la riga è proprio quella che si vuole togliere.
 *
 * Quindi l'unità di lavoro è l'elenco: si scrivono le righe nuove nello stato
 * chiesto e si lasciano stare quelle in altri stati. Aggiunte, correzioni,
 * cancellazioni e riordini diventano lo stesso gesto, e la coda ha una voce
 * sola: «i responsabili dell'unità 1, come li propone Ref1».
 */
function scriviElenco(
  d: Handle,
  unitaId: number,
  tipo: TipoPersona,
  persone: readonly PersonaImmessa[],
  stato: "bozza" | "in-revisione" | "pubblicato",
  autoreId: number | null,
) {
  const inDb = statoInDb(stato);
  d.delete(unitaPersone)
    .where(
      and(
        eq(unitaPersone.unitaId, unitaId),
        eq(unitaPersone.tipo, tipo),
        eq(unitaPersone.stato, inDb),
      ),
    )
    .run();

  const quando = adessoIso();
  persone.forEach((p, indice) => {
    // una riga senza nome non è una persona: si scarta invece di scrivere una
    // scheda vuota in pagina
    if (p.nome.trim() === "") return;
    d.insert(unitaPersone)
      .values({
        unitaId,
        tipo,
        nome: p.nome.trim(),
        ruolo: p.ruolo.trim(),
        periodo: p.periodo.trim(),
        nota: p.nota.trim(),
        ordine: indice + 1,
        stato: inDb,
        aggiornatoIl: quando,
        autoreId,
      })
      .run();
  });
}

/** Pubblica subito l'elenco: per chi ha `completo` sulla riga `referenti`. */
export async function pubblicaPersone(
  unitaChiave: UnitaKey,
  tipo: TipoPersona,
  persone: readonly PersonaImmessa[],
  autore: string,
): Promise<void> {
  try {
    transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const autoreId = idAutore(d, autore);
      scriviElenco(d, id, tipo, persone, "pubblicato", autoreId);
      // una proposta pendente sullo stesso elenco non ha più senso: il referente
      // gruppo ha appena deciso lui, e lasciarla in coda farebbe riapparire
      // domani una versione più vecchia di quella che è online
      d.delete(unitaPersone)
        .where(
          and(
            eq(unitaPersone.unitaId, id),
            eq(unitaPersone.tipo, tipo),
            eq(unitaPersone.stato, statoInDb("in-revisione")),
          ),
        )
        .run();
    });
  } catch (errore) {
    solleva("unita-store.pubblicaPersone", errore);
  }
}

/** Manda l'elenco in revisione, lasciando in pagina quello pubblicato. */
export async function proponiPersone(
  unitaChiave: UnitaKey,
  tipo: TipoPersona,
  persone: readonly PersonaImmessa[],
  autore: string,
): Promise<void> {
  try {
    transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      scriviElenco(d, id, tipo, persone, "in-revisione", idAutore(d, autore));
    });
  } catch (errore) {
    solleva("unita-store.proponiPersone", errore);
  }
}

/**
 * Approva l'elenco proposto: il pubblicato sparisce e il proposto prende il suo
 * posto.
 *
 * In quest'ordine e nella stessa transazione. L'inverso — promuovere prima e
 * cancellare dopo — lascerebbe per un istante due elenchi pubblicati, e se la
 * transazione si fermasse in mezzo resterebbero entrambi: la pagina dell'unità
 * mostrerebbe ogni responsabile due volte.
 */
export async function approvaPersone(
  unitaChiave: UnitaKey,
  tipo: TipoPersona,
  autore: string,
): Promise<boolean> {
  try {
    return transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const inCoda = d
        .select({ id: unitaPersone.id })
        .from(unitaPersone)
        .where(
          and(
            eq(unitaPersone.unitaId, id),
            eq(unitaPersone.tipo, tipo),
            eq(unitaPersone.stato, statoInDb("in-revisione")),
          ),
        )
        .all();
      if (inCoda.length === 0) return false;

      d.delete(unitaPersone)
        .where(
          and(
            eq(unitaPersone.unitaId, id),
            eq(unitaPersone.tipo, tipo),
            eq(unitaPersone.stato, statoInDb("pubblicato")),
          ),
        )
        .run();
      d.update(unitaPersone)
        .set({
          stato: statoInDb("pubblicato"),
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .where(
          and(
            eq(unitaPersone.unitaId, id),
            eq(unitaPersone.tipo, tipo),
            eq(unitaPersone.stato, statoInDb("in-revisione")),
          ),
        )
        .run();
      return true;
    });
  } catch (errore) {
    solleva("unita-store.approvaPersone", errore);
  }
}

/** Rifiuta l'elenco proposto: sparisce, e quello pubblicato resta dov'era. */
export async function rifiutaPersone(
  unitaChiave: UnitaKey,
  tipo: TipoPersona,
): Promise<boolean> {
  try {
    return transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const n = d
        .delete(unitaPersone)
        .where(
          and(
            eq(unitaPersone.unitaId, id),
            eq(unitaPersone.tipo, tipo),
            eq(unitaPersone.stato, statoInDb("in-revisione")),
          ),
        )
        .run().changes;
      return n > 0;
    });
  } catch (errore) {
    solleva("unita-store.rifiutaPersone", errore);
  }
}

/**
 * Gli elenchi di persone in attesa, per la coda.
 *
 * Restituisce anche quante persone ci sono **adesso** in pagina, perché la
 * differenza fra i due numeri è l'informazione che serve a chi approva: «tre
 * responsabili invece di due» si capisce, «elenco modificato» no.
 */
export async function personeInRevisione(): Promise<
  {
    unita: UnitaKey;
    tipo: TipoPersona;
    proposte: PersonaImmessa[];
    quantiOra: number;
    autore: string;
    quando: number;
  }[]
> {
  const d = dbSeEsiste();
  if (!d) return [];

  try {
    const righe = d
      .select({
        unita: tabellaUnita.chiave,
        tipo: unitaPersone.tipo,
        nome: unitaPersone.nome,
        ruolo: unitaPersone.ruolo,
        periodo: unitaPersone.periodo,
        nota: unitaPersone.nota,
        stato: unitaPersone.stato,
        autore: utenti.utente,
        aggiornatoIl: unitaPersone.aggiornatoIl,
      })
      .from(unitaPersone)
      .innerJoin(tabellaUnita, eq(unitaPersone.unitaId, tabellaUnita.id))
      .leftJoin(utenti, eq(unitaPersone.autoreId, utenti.id))
      .orderBy(asc(unitaPersone.ordine), asc(unitaPersone.id))
      .all();

    const vuotaVoce = () => ({
      proposte: [] as PersonaImmessa[],
      quantiOra: 0,
      autore: "",
      quando: 0,
    });
    const per = new Map<string, ReturnType<typeof vuotaVoce>>();

    for (const r of righe) {
      const chiave = `${r.unita}|${r.tipo}`;
      if (!per.has(chiave)) per.set(chiave, vuotaVoce());
      const voce = per.get(chiave)!;
      if (r.stato === statoInDb("pubblicato")) {
        voce.quantiOra++;
      } else if (r.stato === statoInDb("in-revisione")) {
        voce.proposte.push({ nome: r.nome, ruolo: r.ruolo, periodo: r.periodo, nota: r.nota });
        voce.autore = voce.autore || (r.autore ?? "");
        voce.quando = voce.quando || isoInMs(r.aggiornatoIl);
      }
    }

    return [...per.entries()]
      .filter(([, v]) => v.proposte.length > 0)
      .map(([chiave, v]) => {
        const [unita, tipo] = chiave.split("|");
        return {
          unita: unita as UnitaKey,
          tipo: tipo as TipoPersona,
          proposte: v.proposte,
          quantiOra: v.quantiOra,
          autore: v.autore,
          quando: v.quando,
        };
      });
  } catch (errore) {
    solleva("unita-store.personeInRevisione", errore);
  }
}

// --------------------------------------------------------------------------
// Anagrafica: nome, età, iscritti, sigla
// --------------------------------------------------------------------------

/**
 * Le colonne dell'anagrafica, in una mappa **a parte** da `COLONNA_DI`.
 *
 * Non è duplicazione: è la barriera. `salvaCampiUnita` — quella che un referente
 * unità raggiunge con `unita-scheda` — filtra su `COLONNA_DI`, e `nome` non è
 * lì. Nessun errore di validazione a monte, nessun campo in più in un modulo e
 * nessuna svista in un'azione può quindi far scrivere a un referente di unità il nome
 * della propria unità: la funzione che lo scrive è un'altra, e chiede
 * `unita-anagrafica`.
 *
 * Se fossero una mappa sola con un elenco di «campi ammessi per livello», la
 * barriera dipenderebbe da quell'elenco — cioè da una riga che si può
 * dimenticare. Così dipende da quale funzione si chiama, che si vede in
 * revisione.
 */
const COLONNA_ANAGRAFICA = {
  nome: tabellaUnita.nome,
  eta: tabellaUnita.eta,
  sigla: tabellaUnita.sigla,
} as const;

type CampoAnagraficaColonna = keyof typeof COLONNA_ANAGRAFICA;

const eCampoAnagrafica = (campo: string): campo is CampoAnagraficaColonna =>
  campo in COLONNA_ANAGRAFICA;

/**
 * Scrive l'anagrafica di un'unità.
 *
 * `iscritti` sta a parte perché è un numero e non una stringa: la colonna è
 * `INTEGER` con un `CHECK` che vuole `>= 0`, e passarle una stringa vuota
 * scriverebbe `''` in una colonna intera — che con `STRICT` è un errore, e senza
 * `STRICT` sarebbe stato uno zero silenzioso.
 *
 * `nome` è `NOT NULL`: un valore vuoto **non** lo azzera, lo lascia com'è. Non
 * si può «tornare al predefinito» su una colonna obbligatoria, e un'unità senza
 * nome non è una cosa che il sito possa mostrare.
 */
export async function salvaAnagraficaUnita(
  unitaChiave: UnitaKey,
  valori: { nome?: string; eta?: string; sigla?: string; iscritti?: string },
  autore: string,
): Promise<void> {
  try {
    transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const set: Record<string, string | number | null> = {};

      for (const [campo, grezzo] of Object.entries(valori)) {
        if (campo === "iscritti") continue;
        if (!eCampoAnagrafica(campo)) continue;
        const valore = (grezzo ?? "").trim();
        // `nome` non si svuota: vedi sopra
        if (campo === "nome") {
          if (valore !== "") set.nome = valore;
          continue;
        }
        set[campo] = valore === "" ? null : valore;
      }

      if (valori.iscritti !== undefined) {
        const grezzo = valori.iscritti.trim();
        const n = Number(grezzo);
        // vuoto ⇒ NULL, cioè «usa il numero di lib/data.ts». Un valore non
        // numerico non arriva qui: lo ferma l'azione, che sa dirlo all'utente.
        set.iscritti = grezzo === "" ? null : Math.trunc(n);
      }

      if (Object.keys(set).length === 0) return;
      d.update(tabellaUnita)
        .set({ ...set, aggiornatoIl: adessoIso(), autoreId: idAutore(d, autore) })
        .where(eq(tabellaUnita.id, id))
        .run();
    });
  } catch (errore) {
    solleva("unita-store.salvaAnagraficaUnita", errore);
  }
}

// --------------------------------------------------------------------------
// La fotografia di copertina
// --------------------------------------------------------------------------

/**
 * Registra la copertina di un'unità. Il file l'ha già scritto chi chiama.
 *
 * Lo stesso ordine di `salvaMarchio` in `lib/gruppo.ts`, e per lo stesso motivo:
 * i file **prima**, fuori dalla transazione, perché §18 del piano vieta di
 * tenerne una aperta durante un'operazione su filesystem. Se la transazione poi
 * fallisce resta un file senza riga, che è molto meglio di una riga che punta a
 * un file che non c'è — la prima è spazio occupato, la seconda un riquadro rotto
 * in cima alla pagina di un'unità.
 *
 * Le quattro colonne si scrivono insieme, e un `CHECK` garantisce che restino
 * insieme: `unita_copertina_completa`.
 */
export async function registraCopertina(
  unitaChiave: UnitaKey,
  file: string,
  tipo: string,
  misure: { larghezza: number; altezza: number },
  autore: string,
): Promise<void> {
  try {
    transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      d.update(tabellaUnita)
        .set({
          copertina: file,
          copertinaTipo: tipo,
          copertinaLarghezza: misure.larghezza,
          copertinaAltezza: misure.altezza,
          // una copertina nuova si vede: nascosta era quella di prima
          ...(haColonna(d, "unita", "copertina_nascosta") ? { copertinaNascosta: 0 } : {}),
          aggiornatoIl: adessoIso(),
          autoreId: idAutore(d, autore),
        })
        .where(eq(tabellaUnita.id, id))
        .run();
    });
  } catch (errore) {
    solleva("unita-store.registraCopertina", errore);
  }
}

/** Toglie la copertina: la pagina torna al segnaposto del progetto. */
export async function dimenticaCopertina(unitaChiave: UnitaKey): Promise<string | null> {
  try {
    return transazione((d) => {
      const id = idRichiesto(d, unitaChiave);
      const riga = d
        .select({ file: tabellaUnita.copertina })
        .from(tabellaUnita)
        .where(eq(tabellaUnita.id, id))
        .get();
      d.update(tabellaUnita)
        .set({
          copertina: null,
          copertinaTipo: null,
          copertinaLarghezza: null,
          copertinaAltezza: null,
          ...(haColonna(d, "unita", "copertina_nascosta") ? { copertinaNascosta: 0 } : {}),
          aggiornatoIl: adessoIso(),
        })
        .where(eq(tabellaUnita.id, id))
        .run();
      return riga?.file ?? null;
    });
  } catch (errore) {
    solleva("unita-store.dimenticaCopertina", errore);
  }
}

/**
 * Nasconde la copertina di un'unità, o la rimette. Vero se l'unità ne aveva una.
 *
 * Il file e le quattro colonne restano: la pagina torna al segnaposto, e chi
 * gestisce la copertina la ritrova nell'area. È il «togliere» del social media
 * manager, che le fotografie non le elimina (6 ottobre 2026). Come
 * `nascondiImmagine`, qui si scrive e basta: chi può lo decidono le azioni.
 */
export async function nascondiCopertina(
  unitaChiave: UnitaKey,
  nascosta: boolean,
): Promise<boolean> {
  try {
    return transazione((d) => {
      if (!haColonna(d, "unita", "copertina_nascosta")) return false;
      const id = idRichiesto(d, unitaChiave);
      return (
        d
          .update(tabellaUnita)
          .set({ copertinaNascosta: nascosta ? 1 : 0, aggiornatoIl: adessoIso() })
          .where(and(eq(tabellaUnita.id, id), isNotNull(tabellaUnita.copertina)))
          .run().changes > 0
      );
    });
  } catch (errore) {
    solleva("unita-store.nascondiCopertina", errore);
  }
}

/**
 * La copertina di un'unità, per la rotta che la serve.
 *
 * Restituisce qualcosa **solo** se quel nome è registrato in una riga: nessun
 * altro file dell'archivio è raggiungibile indovinando l'indirizzo. È la stessa
 * regola di `fileMarchio` in `lib/gruppo.ts`.
 *
 * Non c'è controllo di ambito e non serve: una copertina è di una pagina
 * pubblica, quindi è pubblica appena registrata. Non ha uno stato «bozza»
 * perché non ce l'ha la cosa che rappresenta — a differenza di un album, che
 * contiene fotografie di minori e non esce finché i consensi non tornano.
 */
export async function copertinaRegistrata(
  nome: string,
): Promise<{
  tipo: string;
  larghezza: number;
  altezza: number;
  unita: string;
  nascosta: boolean;
} | null> {
  const d = dbSeEsiste();
  if (!d) return null;

  try {
    const riga = d
      .select({
        tipo: tabellaUnita.copertinaTipo,
        larghezza: tabellaUnita.copertinaLarghezza,
        altezza: tabellaUnita.copertinaAltezza,
        unita: tabellaUnita.chiave,
        ...(haColonna(d, "unita", "copertina_nascosta")
          ? { nascosta: tabellaUnita.copertinaNascosta }
          : {}),
      })
      .from(tabellaUnita)
      .where(eq(tabellaUnita.copertina, nome))
      .get() as
      | {
          tipo: string | null;
          larghezza: number | null;
          altezza: number | null;
          unita: string;
          nascosta?: number;
        }
      | undefined;
    if (!riga || !riga.tipo || riga.larghezza === null || riga.altezza === null) return null;
    return {
      tipo: riga.tipo,
      larghezza: riga.larghezza,
      altezza: riga.altezza,
      unita: riga.unita,
      nascosta: riga.nascosta === 1,
    };
  } catch (errore) {
    solleva("unita-store.copertinaRegistrata", errore);
  }
}

/** Tutti i nomi di copertina registrati: serve al confronto con l'archivio. */
export function copertineRegistrate(d: Handle): string[] {
  return d
    .select({ file: tabellaUnita.copertina })
    .from(tabellaUnita)
    .all()
    .map((r) => r.file)
    .filter((f): f is string => f !== null);
}

// --------------------------------------------------------------------------
// Anteprima
// --------------------------------------------------------------------------

/**
 * Un'unità come **sarebbe** se tutto quello che aspetta venisse approvato.
 *
 * È la sorgente dell'anteprima: sopra i valori in linea si applicano le proposte
 * pendenti di `unita_proposte` e gli elenchi di persone in `in_revisione`. Non
 * scrive niente e non tocca nessuno stato — è una lettura che risponde a una
 * domanda ipotetica.
 *
 * ## Perché non è `leggiUnita` con un parametro
 *
 * Sarebbe stata una riga in meno e un rischio in più. `leggiUnita` la chiamano
 * le quattro pagine pubbliche e l'indice di ricerca: un booleano in quella firma
 * significa che da qualche parte, prima o poi, qualcuno lo passa `true` — o
 * peggio, che un valore predefinito cambia e le proposte finiscono online senza
 * che nessuno le abbia approvate. Una funzione separata non ha quel modo di
 * sbagliare: chi vuole l'anteprima la chiede per nome.
 *
 * Restituisce anche **che cosa** cambierebbe, perché la fascia dell'anteprima lo
 * elenca: vedere una pagina senza sapere quali righe sono ancora da approvare
 * lascia a chi guarda il compito di confrontarla a memoria con quella vera.
 */
export async function unitaInAnteprima(
  slug: string,
  /**
   * Solo le proposte di **contenuto** — testi, non recapiti, ritrovo e nomi dei
   * referenti — e nessun elenco di persone: è l'anteprima per chi quelle cose non le
   * può leggere, il social media manager (audit degli accessi del 4 ottobre
   * 2026). Prima la vedeva intera, compresi i telefoni e i nomi che i referenti
   * unità stavano proponendo.
   */
  filtro: { soloContenuti?: boolean } = {},
): Promise<{
  unita: Unita;
  /** i campi che aspettano, con l'etichetta del catalogo */
  campi: { campo: CampoUnita; prima: string; dopo: string }[];
  /** gli elenchi di persone che aspettano, per tipo */
  elenchi: TipoPersona[];
} | null> {
  const corrente = (await leggiUnita()).find((u) => u.slug === slug);
  if (!corrente) return null;

  const proposte = (await leggiProposte()).filter(
    (p) =>
      p.unita === corrente.chiave &&
      (!filtro.soloContenuti || campoUnita(p.campo)?.contenuto === true),
  );
  const inRevisione = filtro.soloContenuti
    ? []
    : (await personeInRevisione()).filter((p) => p.unita === corrente.chiave);

  // i campi scalari: la proposta prende il posto del valore in linea
  const conCampi = { ...corrente } as unknown as Record<string, unknown>;
  for (const p of proposte) {
    if (p.campo === "storia") {
      // la storia è un elenco di paragrafi; vuota vuol dire «quella del
      // progetto», come quando la si svuota con un salvataggio diretto
      const paragrafi = inParagrafi(p.proposto);
      conCampi.storia =
        paragrafi.length > 0
          ? paragrafi
          : (UNITA.find((u) => u.chiave === corrente.chiave)?.storia ?? corrente.storia);
    } else if (p.campo === "presentazione") {
      // come la storia: vuota vuol dire «quella del progetto»
      const testo = daParagrafi(inParagrafi(p.proposto));
      conCampi.presentazione =
        testo || UNITA.find((u) => u.chiave === corrente.chiave)?.presentazione;
    } else {
      conCampi[p.campo] = p.proposto;
    }
  }

  const unita = conCampi as unknown as Unita;

  // gli elenchi di persone: quelli proposti al posto di quelli pubblicati
  for (const e of inRevisione) {
    if (e.tipo === "responsabile") {
      unita.responsabili = e.proposte.map((p): [string, string, string] => [
        p.nome,
        p.ruolo,
        p.periodo,
      ]);
    } else if (e.tipo === "staff") {
      unita.staff = e.proposte.map((p): [string, string] => [p.nome, p.ruolo]);
    } else {
      unita.storico = e.proposte.map((p): [string, string, string] => [
        p.periodo,
        p.nome,
        p.nota,
      ]);
    }
  }

  return {
    unita,
    campi: proposte.map((p) => ({ campo: p.campo, prima: p.attuale, dopo: p.proposto })),
    elenchi: inRevisione.map((e) => e.tipo),
  };
}
