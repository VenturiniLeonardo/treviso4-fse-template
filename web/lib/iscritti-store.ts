import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { haColonna } from "@/lib/db/colonne";
import { solleva } from "@/lib/db/errori";
import { assicuraRiferimenti } from "@/lib/db/riferimenti";
import {
  album,
  albumAssenze,
  anniSociali,
  iscrizioni,
  ragazzi,
  registro,
  unita,
  utenti,
} from "@/lib/db/schema";
import { MODULO_MAX } from "@/lib/contenuti";
import type { UnitaKey } from "@/lib/data";

/**
 * Gli iscritti: i ragazzi e la loro iscrizione a un anno. Modulo di solo server.
 *
 * È la parte del sistema con i dati più delicati — nomi e date di nascita di
 * minori — e quella su cui poggia il consenso alla pubblicazione delle immagini.
 * Tre cose vanno lette prima di toccare questo file.
 *
 * ## 1. Nessuna scheda sanitaria, nessun recapito
 *
 * Ci sono nome, cognome, data di nascita, unità, anno, squadra, quota e
 * consenso. Nient'altro. Le schede sanitarie restano cartacee — lo dice la
 * schermata alle famiglie e ai referenti — e i recapiti dei genitori non stanno qui:
 * ogni campo in più è un campo da proteggere, da esportare per sbaglio e da
 * cancellare su richiesta.
 *
 * ## 2. Un ragazzo non si riconosce dal nome
 *
 * Iscrivere allo stesso ragazzo l'anno dopo richiede di **sceglierlo**: non c'è
 * nessun accoppiamento automatico su nome e cognome. Sembra una scomodità, ed è
 * la protezione più importante del modulo. Due bambini che si chiamano uguale
 * esistono, e unirli vorrebbe dire applicare il consenso dell'uno alle
 * fotografie dell'altro. Un doppione lo si vede e si corregge; una fusione no.
 *
 * ## 3. Il consenso vale per un anno
 *
 * `consenso_immagini` sta su `iscrizioni`, non su `ragazzi`, e riparte da zero a
 * ogni anno: quello dell'anno scorso non vale per quest'anno. È l'unico
 * comportamento corretto, e lo schema lo impone perché la colonna è là.
 */

export type Quota = "da_saldare" | "saldata" | "ridotta";

/**
 * Le etichette della quota, allineate all'enum dello schema.
 *
 * L'interfaccia mostrava `esente`; il piano prescrive `ridotta`, e non sono
 * sinonimi — *esente* è chi non paga, *ridotta* è chi paga meno. Sono due
 * politiche diverse. schema-decisions.md §3 adotta l'enum del piano perché di
 * un'esenzione non c'è traccia in nessun documento del gruppo, mentre esiste
 * una «Richiesta di riduzione quota». **Resta da confermare** se servano
 * quattro stati invece di tre: sarebbe una migrazione additiva.
 */
export const ETICHETTA_QUOTA: Record<Quota, string> = {
  da_saldare: "da saldare",
  saldata: "saldata",
  ridotta: "ridotta",
};

export const QUOTE: Quota[] = ["da_saldare", "saldata", "ridotta"];

export interface Iscritto {
  /** identificativo dell'**iscrizione**, non del ragazzo: è quello che si tocca */
  id: number;
  ragazzoId: number;
  nome: string;
  cognome: string;
  /** ISO, o `null` se non è stata registrata */
  natoIl: string | null;
  /** anni compiuti, se la data di nascita c'è */
  eta: number | null;
  unita: UnitaKey;
  anno: string;
  gruppoInterno: string;
  quota: Quota;
  consenso: boolean;
  consensoData: string | null;
  /** dove sta il modulo di carta, se il referente di unità l'ha scritto (0022) */
  consensoModulo: string;
  /** l'esito della verifica a campione, se c'è stata (0022) */
  verifica: EsitoVerifica | null;
  /** quando, in ISO */
  verificatoIl: string | null;
}

/**
 * Che cosa ha trovato chi ha verificato il consenso in sede (audit degli
 * accessi, I-1): il modulo firmato, oppure niente.
 */
export type EsitoVerifica = "conforme" | "mancante";

export { MODULO_MAX };

/** Anni compiuti a una certa data. `null` se la nascita non è registrata. */
export function etaA(natoIl: string | null, quando = new Date()): number | null {
  if (!natoIl || !/^\d{4}-\d{2}-\d{2}$/.test(natoIl)) return null;
  const [a, m, g] = natoIl.split("-").map(Number);
  let eta = quando.getUTCFullYear() - a;
  // il compleanno non è ancora arrivato quest'anno
  const mese = quando.getUTCMonth() + 1;
  if (mese < m || (mese === m && quando.getUTCDate() < g)) eta--;
  return eta >= 0 ? eta : null;
}

/** Le colonne della verifica a campione, se la 0022 c'è. */
const colonneVerifica = (d: Handle) =>
  haColonna(d, "iscrizioni", "consenso_verifica")
    ? {
        consensoModulo: iscrizioni.consensoModulo,
        verifica: iscrizioni.consensoVerifica,
        verificatoIl: iscrizioni.consensoVerificatoIl,
      }
    : {};

function selezione(d: Handle) {
  return d
    .select({
      ...(colonneVerifica(d) as Record<string, never>),
      id: iscrizioni.id,
      ragazzoId: ragazzi.id,
      nome: ragazzi.nome,
      cognome: ragazzi.cognome,
      natoIl: ragazzi.natoIl,
      unita: unita.chiave,
      anno: anniSociali.etichetta,
      gruppoInterno: iscrizioni.gruppoInterno,
      quota: iscrizioni.quota,
      consenso: iscrizioni.consensoImmagini,
      consensoData: iscrizioni.consensoData,
    })
    .from(iscrizioni)
    .innerJoin(ragazzi, eq(iscrizioni.ragazzoId, ragazzi.id))
    .innerJoin(unita, eq(iscrizioni.unitaId, unita.id))
    .innerJoin(anniSociali, eq(iscrizioni.annoId, anniSociali.id));
}

type Riga = ReturnType<ReturnType<typeof selezione>["all"]>[number] & {
  consensoModulo?: string | null;
  verifica?: string | null;
  verificatoIl?: string | null;
};

const componi = (r: Riga): Iscritto => ({
  id: r.id,
  ragazzoId: r.ragazzoId,
  nome: r.nome,
  cognome: r.cognome,
  natoIl: r.natoIl,
  eta: etaA(r.natoIl),
  unita: r.unita as UnitaKey,
  anno: r.anno,
  gruppoInterno: r.gruppoInterno ?? "",
  quota: r.quota as Quota,
  consenso: r.consenso === 1,
  consensoData: r.consensoData,
  consensoModulo: r.consensoModulo ?? "",
  verifica: r.verifica === "conforme" || r.verifica === "mancante" ? r.verifica : null,
  verificatoIl: r.verificatoIl ?? null,
});

/**
 * L'elenco, filtrabile per unità e per anno.
 *
 * L'ordine è cognome, nome: è quello con cui si cerca un nome in un elenco
 * stampato, e i referenti questo elenco lo stampano.
 */
export function elencoIscritti(filtro?: { unita?: UnitaKey; anno?: string }): Iscritto[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    const dove = [
      filtro?.unita ? eq(unita.chiave, filtro.unita) : undefined,
      filtro?.anno ? eq(anniSociali.etichetta, filtro.anno) : undefined,
    ].filter((x) => x !== undefined);

    return selezione(d)
      .where(dove.length > 0 ? and(...dove) : undefined)
      .orderBy(asc(ragazzi.cognome), asc(ragazzi.nome))
      .all()
      .map(componi);
  } catch (errore) {
    solleva("iscritti.elencoIscritti", errore);
  }
}

export function iscrittoPerId(id: number): Iscritto | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const r = selezione(d).where(eq(iscrizioni.id, id)).get();
    return r ? componi(r) : null;
  } catch (errore) {
    solleva("iscritti.iscrittoPerId", errore);
  }
}

/**
 * L'unità dell'iscrizione più recente di un ragazzo già in anagrafica.
 *
 * È l'ambito da cui si giudica chi può collegarlo a un'iscrizione nuova
 * (audit di sicurezza, AUTHZ-01): l'unità di destinazione la sceglie il modulo,
 * questa la dice l'archivio. Un referente di unità reiscrive i ragazzi che sono già
 * suoi; il passaggio da un'unità all'altra lo fa chi le copre entrambe.
 *
 * `null` se il ragazzo non esiste; `{ unita: null }` se esiste ma non ha
 * nessuna iscrizione, e allora non è di nessuna unità.
 */
export function provenienzaDelRagazzo(id: number): { unita: UnitaKey | null } | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    if (!d.select({ id: ragazzi.id }).from(ragazzi).where(eq(ragazzi.id, id)).get()) return null;
    const recente = selezione(d)
      .where(eq(iscrizioni.ragazzoId, id))
      .orderBy(desc(anniSociali.etichetta), desc(iscrizioni.id))
      .limit(1)
      .get();
    return { unita: recente ? (recente.unita as UnitaKey) : null };
  } catch (errore) {
    solleva("iscritti.provenienzaDelRagazzo", errore);
  }
}

export interface NuovaIscrizione {
  /** un ragazzo già in anagrafica; se manca se ne crea uno nuovo */
  ragazzoId?: number;
  nome?: string;
  cognome?: string;
  /** ISO */
  natoIl?: string;
  unita: UnitaKey;
  /** etichetta canonica, `2026-2027` */
  anno: string;
  gruppoInterno?: string;
}

/**
 * Iscrive un ragazzo a un anno. Restituisce l'identificativo dell'iscrizione.
 *
 * Il consenso **non** si passa qui, ed è deliberato: si registra con
 * `registraConsenso`, che chiede la data e lascia una riga nel registro. Un
 * consenso che entra insieme all'anagrafica è un consenso che qualcuno può
 * spuntare per abitudine mentre compila un modulo.
 */
export function registraIscrizione(nuova: NuovaIscrizione): number {
  assicuraRiferimenti();

  const d = dbSeEsiste();
  if (!d) throw new Error("Il database non è raggiungibile.");

  // le convalide **fuori** dalla transazione, se no `solleva()` le trasforma in
  // «qualcosa non ha funzionato sul server» e chi ha sbagliato non lo sa
  const idUnita = d
    .select({ id: unita.id })
    .from(unita)
    .where(eq(unita.chiave, nuova.unita))
    .get()?.id;
  if (idUnita === undefined) throw new Error(`Unità sconosciuta: ${nuova.unita}`);

  const idAnno = d
    .select({ id: anniSociali.id })
    .from(anniSociali)
    .where(eq(anniSociali.etichetta, nuova.anno))
    .get()?.id;
  if (idAnno === undefined) throw new Error(`Anno sociale sconosciuto: ${nuova.anno}`);

  if (nuova.ragazzoId === undefined) {
    if (!nuova.nome?.trim() || !nuova.cognome?.trim()) {
      throw new Error("Servono nome e cognome, oppure un ragazzo già in anagrafica.");
    }
  } else if (
    !d.select({ id: ragazzi.id }).from(ragazzi).where(eq(ragazzi.id, nuova.ragazzoId)).get()
  ) {
    throw new Error("Quel ragazzo non è in anagrafica.");
  }

  try {
    return transazione((dd) => {
      const ragazzoId =
        nuova.ragazzoId ??
        dd
          .insert(ragazzi)
          .values({
            nome: nuova.nome!.trim(),
            cognome: nuova.cognome!.trim(),
            natoIl: nuova.natoIl?.trim() || null,
          })
          .returning({ id: ragazzi.id })
          .get().id;

      const r = dd
        .insert(iscrizioni)
        .values({
          ragazzoId,
          unitaId: idUnita,
          annoId: idAnno,
          gruppoInterno: nuova.gruppoInterno?.trim() || null,
          quota: "da_saldare",
          // niente consenso alla nascita dell'iscrizione: si registra a parte
          consensoImmagini: 0,
        })
        .returning({ id: iscrizioni.id })
        .get();
      return r.id;
    });
  } catch (errore) {
    solleva("iscritti.registraIscrizione", errore);
  }
}

/**
 * Registra o revoca il consenso alla pubblicazione delle immagini.
 *
 * La data è obbligatoria quando si concede — lo impone anche il `CHECK` dello
 * schema — perché un consenso senza data non si può dimostrare. Revocando, la
 * data si azzera: lasciare la data di un consenso che non c'è più farebbe
 * credere a chi legge la riga che il consenso ci sia.
 *
 * Che la revoca resti scritta da qualche parte è compito del registro, e chi
 * chiama deve scriverci una riga. Qui non si registra niente: lo store non ha
 * una sessione, e inventarne una per il log sarebbe peggio che chiederlo a chi
 * chiama.
 */
export function registraConsenso(
  iscrizioneId: number,
  concesso: boolean,
  data?: string,
  /** chi lo registra: il nome con cui accede. Chi registra non verifica (0022) */
  chi?: string,
): boolean {
  if (concesso && (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data))) {
    throw new Error("Per registrare un consenso serve la data in cui è stato firmato.");
  }
  try {
    return transazione(
      (d) =>
        d
          .update(iscrizioni)
          .set({
            consensoImmagini: concesso ? 1 : 0,
            consensoData: concesso ? data! : null,
            // un consenso registrato di nuovo è un altro modulo: la verifica di
            // quello di prima non vale per questo
            ...(haColonna(d, "iscrizioni", "consenso_verifica")
              ? { ...senzaVerifica, consensoDa: concesso ? idDi(d, chi) : null }
              : {}),
          })
          .where(eq(iscrizioni.id, iscrizioneId))
          .run().changes > 0,
    );
  } catch (errore) {
    solleva("iscritti.registraConsenso", errore);
  }
}

/** Cambia la quota. Chi chiama scrive la riga di registro: vedi §3 di schema-decisions. */
export function cambiaQuota(iscrizioneId: number, quota: Quota): boolean {
  if (!QUOTE.includes(quota)) throw new Error(`Quota non valida: ${quota}`);
  try {
    return transazione(
      (d) =>
        d.update(iscrizioni).set({ quota }).where(eq(iscrizioni.id, iscrizioneId)).run().changes >
        0,
    );
  } catch (errore) {
    solleva("iscritti.cambiaQuota", errore);
  }
}

/** Cambia la squadra o squadra. */
export function cambiaGruppoInterno(iscrizioneId: number, gruppo: string): boolean {
  try {
    return transazione(
      (d) =>
        d
          .update(iscrizioni)
          .set({ gruppoInterno: gruppo.trim() || null })
          .where(eq(iscrizioni.id, iscrizioneId))
          .run().changes > 0,
    );
  } catch (errore) {
    solleva("iscritti.cambiaGruppoInterno", errore);
  }
}

/**
 * Toglie un'iscrizione. Il ragazzo resta in anagrafica.
 *
 * Serve a chi si è ritirato a metà anno, o a un'iscrizione sbagliata. **Non** è
 * la cancellazione GDPR: quella è `cancellaRagazzo`, che porta via anche gli
 * anni precedenti.
 */
export function togliIscrizione(iscrizioneId: number): boolean {
  try {
    return transazione(
      (d) => d.delete(iscrizioni).where(eq(iscrizioni.id, iscrizioneId)).run().changes > 0,
    );
  } catch (errore) {
    solleva("iscritti.togliIscrizione", errore);
  }
}

/**
 * Cancella un ragazzo e tutte le sue iscrizioni. Restituisce quante ne cadono.
 *
 * È la cancellazione dell'art. 17, e cancella davvero: nessun contrassegno,
 * nessuna riga svuotata che resta. Le iscrizioni cadono per `ON DELETE CASCADE`,
 * che è nello schema apposta.
 *
 * Quello che **resta** è il registro: chi ha pubblicato quale album continua a
 * dirlo, perché `registro.utente` è testo e non una chiave esterna. Un registro
 * che si svuota cancellando una persona non dimostra più niente, ed è
 * esattamente ciò che deve dimostrare.
 *
 * Restano le voci, ma **non il nome**. Qui c'era scritto che nel registro non
 * ci sono nomi di ragazzi, ed era falso: iscrizione, consenso, quota, squadra
 * e assenze da un album scrivono «Cognome Nome» nella descrizione, e dopo una
 * cancellazione il nome sopravviveva dodici mesi — per sempre nelle voci di
 * consenso, che non scadono (audit di sicurezza, PRIV-01). Nella stessa
 * transazione il nome diventa «[persona cancellata]» in ogni voce che lo
 * contiene. Un omonimo perde il nome nelle sue voci insieme a lui: è il lato
 * giusto da cui sbagliare.
 */
/** Che cosa resta nel registro al posto del nome di una persona cancellata. */
export const PERSONA_CANCELLATA = "[persona cancellata]";

export function cancellaRagazzo(ragazzoId: number): { cancellato: boolean; iscrizioni: number } {
  try {
    return transazione((d) => {
      const quante =
        d
          .select({ n: sql<number>`count(*)` })
          .from(iscrizioni)
          .where(eq(iscrizioni.ragazzoId, ragazzoId))
          .get()?.n ?? 0;

      const persona = d
        .select({ nome: ragazzi.nome, cognome: ragazzi.cognome })
        .from(ragazzi)
        .where(eq(ragazzi.id, ragazzoId))
        .get();

      const via = d.delete(ragazzi).where(eq(ragazzi.id, ragazzoId)).run().changes > 0;
      if (via && persona) {
        // le descrizioni li scrivono così, cognome davanti; `instr` e non
        // `LIKE`, perché un nome con «%» o «_» non deve diventare un modello
        const scritto = `${persona.cognome} ${persona.nome}`;
        d.update(registro)
          .set({ operazione: sql`replace(${registro.operazione}, ${scritto}, ${PERSONA_CANCELLATA})` })
          .where(sql`instr(${registro.operazione}, ${scritto}) > 0`)
          .run();
      }
      return { cancellato: via, iscrizioni: via ? quante : 0 };
    });
  } catch (errore) {
    solleva("iscritti.cancellaRagazzo", errore);
  }
}

// --------------------------------------------------------------------------
// Consensi: quello che serve al cancello della pubblicazione
// --------------------------------------------------------------------------

export interface Conteggi {
  iscritti: number;
  conConsenso: number;
  senzaConsenso: number;
  quoteDaSaldare: number;
}

/** I quattro numeri in cima alla schermata. */
export function conteggi(filtro?: { unita?: UnitaKey; anno?: string }): Conteggi {
  const righe = elencoIscritti(filtro);
  return {
    iscritti: righe.length,
    conConsenso: righe.filter((r) => r.consenso).length,
    senzaConsenso: righe.filter((r) => !r.consenso).length,
    quoteDaSaldare: righe.filter((r) => r.quota === "da_saldare").length,
  };
}

/**
 * Chi, in questa unità e in quest'anno, non ha il consenso.
 *
 * È la funzione che il cancello della pubblicazione userà per dire **i nomi**
 * invece di «mancano dei consensi». §5 del piano: la prima serratura serve a
 * dare un messaggio utile; senza i nomi, chi legge non sa a chi telefonare.
 *
 * `unita` assente significa «di gruppo», cioè tutte le unità — che è la stessa
 * lettura che ne dà il trigger di §5 con `NEW.unita_id IS NULL`.
 */
export function senzaConsenso(anno: string, unitaChiave?: UnitaKey): Iscritto[] {
  return elencoIscritti({ anno, unita: unitaChiave }).filter((r) => !r.consenso);
}

/**
 * Lo stato dei consensi di un'unità e di un anno, come serve a chi approva.
 *
 * `null` **non** vuol dire «tutti a posto»: vuol dire che per quell'unità e
 * quell'anno non c'è nessun iscritto registrato, quindi il sito non ha niente
 * da dire. È la distinzione che conta, perché un elenco vuoto e un elenco tutto
 * in regola si vedono uguali in una schermata — e trattarli allo stesso modo
 * farebbe apparire come controllato un album che nessuno ha controllato.
 *
 * `unita` assente significa «di gruppo», cioè tutte le unità: la stessa lettura
 * che ne dà §5 del piano con `NEW.unita_id IS NULL`.
 *
 * Aggiunta in 10.2, quando questi dati hanno smesso di stare solo in una
 * schermata e sono arrivati alla coda di approvazione.
 */
export function statoConsensi(
  anno: string,
  unitaChiave?: UnitaKey,
): { nomi: string[]; totale: number } | null {
  const tutti = elencoIscritti({ anno, unita: unitaChiave });
  if (tutti.length === 0) return null;

  const mancanti = tutti.filter((i) => !i.consenso);
  return {
    nomi: mancanti.map((i) => `${i.cognome} ${i.nome}`),
    totale: mancanti.length,
  };
}

// ==========================================================================
// Dichiarazioni di assenza — §5 del piano, confermato il 31 agosto 2026
// ==========================================================================

export interface Assenza {
  iscrizioneId: number;
  nome: string;
  cognome: string;
  dichiarataDa: string;
  dichiarataIl: string;
}

/** Chi è stato dichiarato assente da questo album. */
export function assenzeDi(albumId: number): Assenza[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return d
      .select({
        iscrizioneId: albumAssenze.iscrizioneId,
        nome: ragazzi.nome,
        cognome: ragazzi.cognome,
        dichiarataDa: utenti.utente,
        dichiarataIl: albumAssenze.dichiarataIl,
      })
      .from(albumAssenze)
      .innerJoin(iscrizioni, eq(albumAssenze.iscrizioneId, iscrizioni.id))
      .innerJoin(ragazzi, eq(iscrizioni.ragazzoId, ragazzi.id))
      .innerJoin(utenti, eq(albumAssenze.dichiarataDa, utenti.id))
      .where(eq(albumAssenze.albumId, albumId))
      .orderBy(asc(ragazzi.cognome), asc(ragazzi.nome))
      .all();
  } catch (errore) {
    solleva("iscritti.assenzeDi", errore);
  }
}

/**
 * Quante assenze di quest'album ha dichiarato questa persona.
 *
 * È la domanda della separazione dei compiti sulla pubblicazione (audit degli
 * accessi del 4 ottobre 2026, SoD-1): una dichiarazione d'assenza toglie un
 * ragazzo senza consenso dai «bloccanti» del trigger, cioè sblocca la
 * pubblicazione. Chi l'ha fatta non può essere anche chi pubblica — altrimenti
 * il solo controllo tecnico sui consensi lo aggira una persona sola.
 */
export const HA_DICHIARATO_CHI_PUBBLICA =
  "Su quest’album avete dichiarato voi delle assenze: a pubblicarlo dev’essere " +
  "un’altra persona, perché chi attesta che un ragazzo non compare non è anche chi " +
  "mette online le fotografie. Chiedete a un altro gestore, oppure fate rifare " +
  "la dichiarazione al referente di unità.";

export function assenzeDichiarateDa(albumId: number, utente: string): number {
  const d = dbSeEsiste();
  if (!d) return 0;
  try {
    return (
      d
        .select({ n: sql<number>`count(*)` })
        .from(albumAssenze)
        .innerJoin(utenti, eq(albumAssenze.dichiarataDa, utenti.id))
        .where(and(eq(albumAssenze.albumId, albumId), sql`lower(${utenti.utente}) = lower(${utente})`))
        .get()?.n ?? 0
    );
  } catch (errore) {
    solleva("iscritti.assenzeDichiarateDa", errore);
  }
}

/**
 * Dichiara che un iscritto non compare nelle fotografie di un album.
 *
 * Vero se la dichiarazione è stata scritta ora, falso se c'era già. Non è un
 * errore riprovarci: due referenti che guardano lo stesso album possono dichiarare
 * la stessa assenza, e la prima vale.
 *
 * **Non verifica che l'iscritto sia senza consenso**, e non è una svista: si
 * può dichiarare assente anche chi ce l'ha, e la dichiarazione non fa niente di
 * male — il trigger guarda solo quelli senza. Aggiungere il controllo
 * significherebbe rifiutare un'affermazione vera perché in quel momento non
 * serve, e le affermazioni vere non si rifiutano.
 */
export function dichiaraAssenza(
  albumId: number,
  iscrizioneId: number,
  utenteId: number,
): boolean {
  try {
    return transazione((d) => {
      const gia = d
        .select({ a: albumAssenze.albumId })
        .from(albumAssenze)
        .where(
          and(
            eq(albumAssenze.albumId, albumId),
            eq(albumAssenze.iscrizioneId, iscrizioneId),
          ),
        )
        .get();
      if (gia) return false;

      d.insert(albumAssenze)
        .values({ albumId, iscrizioneId, dichiarataDa: utenteId })
        .run();
      return true;
    });
  } catch (errore) {
    solleva("iscritti.dichiaraAssenza", errore);
  }
}

/**
 * Ritira una dichiarazione di assenza. Vero se c'era.
 *
 * Esiste perché una dichiarazione si può sbagliare — si guarda l'album, ci si
 * accorge che quel bambino c'è in una foto in fondo — e perché una
 * dichiarazione che non si può ritirare è una che nessuno oserebbe fare. Che
 * sia stata ritirata resta nel registro.
 */
export function togliAssenza(albumId: number, iscrizioneId: number): boolean {
  try {
    return transazione(
      (d) =>
        d
          .delete(albumAssenze)
          .where(
            and(
              eq(albumAssenze.albumId, albumId),
              eq(albumAssenze.iscrizioneId, iscrizioneId),
            ),
          )
          .run().changes > 0,
    );
  } catch (errore) {
    solleva("iscritti.togliAssenza", errore);
  }
}

/**
 * Chi, per questo album, impedisce ancora la pubblicazione.
 *
 * È la stessa domanda che si fa il trigger, posta prima di premere il pulsante:
 * senza consenso **e** non dichiarato assente. Le due liste devono restare
 * d'accordo, e una prova lo verifica confrontando questa funzione con il
 * rifiuto vero del database.
 *
 * `null` quando in quell'unità e in quell'anno non c'è nessun iscritto: come
 * `statoConsensi`, e per lo stesso motivo — non sapere non è «va bene».
 */
export function bloccantiPer(
  albumId: number,
  anno: string,
  unitaChiave?: UnitaKey,
): Iscritto[] | null {
  const tutti = elencoIscritti({ anno, unita: unitaChiave });
  if (tutti.length === 0) return null;

  const dichiarati = new Set(assenzeDi(albumId).map((a) => a.iscrizioneId));
  return tutti.filter((i) => !i.consenso && !dichiarati.has(i.id));
}

// ==========================================================================
// La revoca, e il buco che chiude — fase 11
// ==========================================================================

/**
 * Gli album **già pubblicati** che non potrebbero più esserlo, se questa
 * iscrizione perdesse il consenso.
 *
 * È la stessa domanda del trigger, girata al passato: il trigger impedisce di
 * pubblicare mentre un consenso manca, ma non dice niente su quello che era già
 * online quando il consenso è stato revocato. Fino alla fase 11 quel buco era
 * dichiarato in consensi.md §6 e non chiuso.
 *
 * Un album rientra se è dell'anno di questa iscrizione, se il suo ambito la
 * comprende — la propria unità, oppure `unita_id IS NULL` che vuol dire tutto il
 * gruppo — e se **non** c'è una dichiarazione di assenza per quella coppia.
 */
function albumDaRitirare(d: Handle, iscrizioneId: number): { id: number; slug: string }[] {
  const i = d
    .select({ annoId: iscrizioni.annoId, unitaId: iscrizioni.unitaId })
    .from(iscrizioni)
    .where(eq(iscrizioni.id, iscrizioneId))
    .get();
  if (!i) return [];

  const dichiarati = d
    .select({ id: albumAssenze.albumId })
    .from(albumAssenze)
    .where(eq(albumAssenze.iscrizioneId, iscrizioneId))
    .all()
    .map((r) => r.id);

  return d
    .select({ id: album.id, slug: album.slug })
    .from(album)
    .where(
      and(
        eq(album.stato, "pubblicato"),
        eq(album.annoId, i.annoId),
        // l'ambito: la sua unità, o un album di gruppo
        or(isNull(album.unitaId), eq(album.unitaId, i.unitaId)),
      ),
    )
    .all()
    .filter((a) => !dichiarati.includes(a.id));
}

/**
 * Revoca un consenso, e **ritira dalla pubblicazione** gli album che di
 * conseguenza non potrebbero più essere online.
 *
 * ## Perché ritira, invece di segnalare
 *
 * L'alternativa era lasciarli online avvisando qualcuno. Ma un consenso revocato
 * significa che quella famiglia non vuole più che quelle immagini stiano su
 * Internet, e «le togliamo appena qualcuno legge l'avviso» non è una risposta a
 * quella richiesta. Il trigger impedisce di pubblicare mentre un consenso manca;
 * lasciare online ciò che era già pubblicato sarebbe la stessa regola applicata
 * solo al futuro.
 *
 * ## Perché in una transazione sola
 *
 * Se la revoca fosse scritta e il ritiro no — un guasto in mezzo, il processo che
 * muore — resterebbero online fotografie di chi ha revocato, e nel database
 * scritto che il consenso non c'è. La combinazione peggiore: illecita **e**
 * invisibile, perché la schermata direbbe che tutto è a posto.
 *
 * ## Che cosa NON copre
 *
 * Una revoca fatta con SQL a mano, o da un'altra applicazione. Per quello c'è
 * `albumNonConformi()`, che ricontrolla tutto da zero e non si fida di nessun
 * percorso.
 *
 * Restituisce gli indirizzi degli album ritirati, perché chi ha revocato deve
 * poter dire alla famiglia che cosa è stato tolto — e perché il referente di unità deve
 * sapere che cosa gli è tornato in bozza.
 */
export function revocaConsenso(iscrizioneId: number): { ok: boolean; ritirati: string[] } {
  try {
    return transazione((d) => {
      const daRitirare = albumDaRitirare(d, iscrizioneId);

      const cambiate = d
        .update(iscrizioni)
        .set({
          consensoImmagini: 0,
          consensoData: null,
          // revocato, il modulo non vale più: né dove sta né la sua verifica
          ...(haColonna(d, "iscrizioni", "consenso_verifica")
            ? { ...senzaVerifica, consensoDa: null, consensoModulo: null }
            : {}),
        })
        .where(eq(iscrizioni.id, iscrizioneId))
        .run().changes;
      if (cambiate === 0) return { ok: false, ritirati: [] };

      for (const a of daRitirare) {
        d.update(album).set({ stato: "bozza" }).where(eq(album.id, a.id)).run();
      }
      return { ok: true, ritirati: daRitirare.map((a) => a.slug) };
    });
  } catch (errore) {
    solleva("iscritti.revocaConsenso", errore);
  }
}

export interface AlbumNonConforme {
  slug: string;
  titolo: string;
  /** i nomi che lo rendono non conforme */
  nomi: string[];
}

/**
 * Gli album pubblicati che violano la regola dei consensi, comunque ci siano
 * arrivati.
 *
 * Serve perché tutte le protezioni di questo capitolo stanno su un percorso: il
 * trigger sull'`UPDATE`, il ritiro dentro `revocaConsenso`. Una riga cambiata
 * con `sqlite3` a mano, un ripristino da una copia vecchia, un `INSERT` di un
 * album già pubblicato — nessuno dei tre passa da lì.
 *
 * Questa funzione non si fida di nessun percorso: rilegge tutto e confronta. È
 * il controllo che va guardato, non quello che protegge — e la differenza è che
 * un controllo si può eseguire quando si vuole, anche su un database che nessuno
 * sa da dove viene.
 */
export function albumNonConformi(): AlbumNonConforme[] {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    const pubblicati = d
      .select({
        id: album.id,
        slug: album.slug,
        titolo: album.titolo,
        annoId: album.annoId,
        unitaId: album.unitaId,
      })
      .from(album)
      .where(eq(album.stato, "pubblicato"))
      .all();

    const fuori: AlbumNonConforme[] = [];
    for (const a of pubblicati) {
      const senza = d
        .select({ id: iscrizioni.id, nome: ragazzi.nome, cognome: ragazzi.cognome })
        .from(iscrizioni)
        .innerJoin(ragazzi, eq(iscrizioni.ragazzoId, ragazzi.id))
        .where(
          and(
            eq(iscrizioni.annoId, a.annoId),
            eq(iscrizioni.consensoImmagini, 0),
            a.unitaId === null ? undefined : eq(iscrizioni.unitaId, a.unitaId),
          ),
        )
        .all();
      if (senza.length === 0) continue;

      const dichiarati = new Set(
        d
          .select({ id: albumAssenze.iscrizioneId })
          .from(albumAssenze)
          .where(eq(albumAssenze.albumId, a.id))
          .all()
          .map((r) => r.id),
      );

      const nomi = senza
        .filter((i) => !dichiarati.has(i.id))
        .map((i) => `${i.cognome} ${i.nome}`);
      if (nomi.length > 0) fuori.push({ slug: a.slug, titolo: a.titolo, nomi });
    }
    return fuori;
  } catch (errore) {
    solleva("iscritti.albumNonConformi", errore);
  }
}

// --------------------------------------------------------------------------
// Verifica a campione dei consensi — audit degli accessi, I-1 (0022)
// --------------------------------------------------------------------------

/** Le colonne che una verifica scrive, svuotate. */
const senzaVerifica = {
  consensoVerifica: null,
  consensoVerificatoIl: null,
  consensoVerificatoDa: null,
} as const;

/** L'id di un account dal nome con cui accede, o `null`. */
function idDi(d: Handle, utente?: string): number | null {
  if (!utente) return null;
  return d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, utente)).get()?.id ?? null;
}

/**
 * Scrive dove sta il modulo di carta del consenso. Vero se l'iscrizione ha un
 * consenso: senza, non c'è un modulo da cercare.
 *
 * Non tocca la verifica: spostare il raccoglitore non rende falso il modulo.
 */
export function segnaModulo(iscrizioneId: number, dove: string): boolean {
  const testo = dove.trim().slice(0, MODULO_MAX);
  try {
    return transazione((d) => {
      if (!haColonna(d, "iscrizioni", "consenso_modulo")) return false;
      return (
        d
          .update(iscrizioni)
          .set({ consensoModulo: testo === "" ? null : testo })
          .where(and(eq(iscrizioni.id, iscrizioneId), eq(iscrizioni.consensoImmagini, 1)))
          .run().changes > 0
      );
    });
  } catch (errore) {
    solleva("iscritti.segnaModulo", errore);
  }
}

/** Una voce del campione, come la vede chi verifica: il minimo per trovare il modulo. */
export interface DaVerificare {
  id: number;
  nome: string;
  cognome: string;
  unita: UnitaKey;
  consensoData: string;
  consensoModulo: string;
}

/**
 * Quante iscrizioni estrarre ogni settimana. Poche apposta: è un controllo a
 * campione, non un secondo registro dei consensi — e chi verifica vede solo
 * questi nomi, non l'elenco.
 */
export const CAMPIONE = 5;

/**
 * Il numero della settimana, che fa da seme all'estrazione: il campione resta
 * lo stesso fino a lunedì, così chi verifica non può ricaricare la pagina
 * finché non esce un nome comodo.
 */
function settimana(adesso: number): number {
  // i giorni dal 1° gennaio 1970, che era un giovedì: +3 porta l'inizio al lunedì
  return Math.floor((Math.floor(adesso / 86_400_000) + 3) / 7);
}

/**
 * Il campione della settimana: iscrizioni dell'anno con il consenso, mai
 * verificate, che **non** ha registrato chi verifica.
 *
 * L'ordine è un mescolamento deterministico dell'id con la settimana come
 * seme (una moltiplicazione modulo 2³¹): non `random()`, che darebbe un
 * campione nuovo a ogni apertura della pagina.
 */
export function campioneDaVerificare(
  anno: string,
  chi: string,
  adesso = Date.now(),
  quanti = CAMPIONE,
): DaVerificare[] {
  const d = dbSeEsiste();
  if (!d || !haColonna(d, "iscrizioni", "consenso_verifica")) return [];
  try {
    const io = idDi(d, chi);
    const seme = settimana(adesso) % 1_000_003;
    return d
      .select({
        id: iscrizioni.id,
        nome: ragazzi.nome,
        cognome: ragazzi.cognome,
        unita: unita.chiave,
        consensoData: iscrizioni.consensoData,
        consensoModulo: iscrizioni.consensoModulo,
      })
      .from(iscrizioni)
      .innerJoin(ragazzi, eq(iscrizioni.ragazzoId, ragazzi.id))
      .innerJoin(unita, eq(iscrizioni.unitaId, unita.id))
      .innerJoin(anniSociali, eq(iscrizioni.annoId, anniSociali.id))
      .where(
        and(
          eq(anniSociali.etichetta, anno),
          eq(iscrizioni.consensoImmagini, 1),
          isNull(iscrizioni.consensoVerifica),
          io === null
            ? undefined
            : or(isNull(iscrizioni.consensoDa), sql`${iscrizioni.consensoDa} <> ${io}`),
        ),
      )
      .orderBy(sql`((${iscrizioni.id} + ${seme}) * 1103515245) % 2147483648`, asc(iscrizioni.id))
      .limit(quanti)
      .all()
      .map((r) => ({
        id: r.id,
        nome: r.nome,
        cognome: r.cognome,
        unita: r.unita as UnitaKey,
        consensoData: r.consensoData ?? "",
        consensoModulo: r.consensoModulo ?? "",
      }));
  } catch (errore) {
    solleva("iscritti.campioneDaVerificare", errore);
  }
}

/** Perché una verifica non si è scritta. */
export type VerificaNegata = "non-trovata" | "senza-consenso" | "sua";

/**
 * Scrive l'esito della verifica di un consenso.
 *
 * Due regole, nello store perché valgono comunque si arrivi qui: si verifica
 * solo un consenso che c'è, e **non lo verifica chi l'ha registrato** —
 * attestare un fatto e controllarlo sono due compiti, e due persone.
 */
export function verificaConsenso(
  iscrizioneId: number,
  esito: EsitoVerifica,
  chi: string,
  adesso = Date.now(),
): { ok: true } | { ok: false; perche: VerificaNegata } {
  if (esito !== "conforme" && esito !== "mancante") throw new Error(`Esito non valido: ${esito}`);
  try {
    return transazione((d) => {
      const r = d
        .select({ consenso: iscrizioni.consensoImmagini, da: iscrizioni.consensoDa })
        .from(iscrizioni)
        .where(eq(iscrizioni.id, iscrizioneId))
        .get();
      if (!r) return { ok: false as const, perche: "non-trovata" as const };
      if (r.consenso !== 1) return { ok: false as const, perche: "senza-consenso" as const };
      const io = idDi(d, chi);
      if (io !== null && r.da === io) return { ok: false as const, perche: "sua" as const };
      d.update(iscrizioni)
        .set({
          consensoVerifica: esito,
          consensoVerificatoIl: new Date(adesso).toISOString(),
          consensoVerificatoDa: io,
        })
        .where(eq(iscrizioni.id, iscrizioneId))
        .run();
      return { ok: true as const };
    });
  } catch (errore) {
    solleva("iscritti.verificaConsenso", errore);
  }
}

/** Un modulo che chi ha verificato non ha trovato. */
export interface ModuloMancante {
  id: number;
  nome: string;
  cognome: string;
  unita: UnitaKey;
  verificatoIl: string;
  verificatoDa: string;
}

/** I numeri della verifica nell'anno, e i moduli non trovati. */
export interface StatoVerifiche {
  consensi: number;
  verificati: number;
  mancanti: ModuloMancante[];
}

export function statoVerifiche(anno: string): StatoVerifiche {
  const vuoto = { consensi: 0, verificati: 0, mancanti: [] };
  const d = dbSeEsiste();
  if (!d || !haColonna(d, "iscrizioni", "consenso_verifica")) return vuoto;
  try {
    const dellAnno = and(eq(anniSociali.etichetta, anno), eq(iscrizioni.consensoImmagini, 1));
    const conti = d
      .select({
        consensi: sql<number>`count(*)`,
        verificati: sql<number>`count(${iscrizioni.consensoVerifica})`,
      })
      .from(iscrizioni)
      .innerJoin(anniSociali, eq(iscrizioni.annoId, anniSociali.id))
      .where(dellAnno)
      .get();
    const mancanti = d
      .select({
        id: iscrizioni.id,
        nome: ragazzi.nome,
        cognome: ragazzi.cognome,
        unita: unita.chiave,
        verificatoIl: iscrizioni.consensoVerificatoIl,
        verificatoDa: utenti.nome,
      })
      .from(iscrizioni)
      .innerJoin(ragazzi, eq(iscrizioni.ragazzoId, ragazzi.id))
      .innerJoin(unita, eq(iscrizioni.unitaId, unita.id))
      .innerJoin(anniSociali, eq(iscrizioni.annoId, anniSociali.id))
      .leftJoin(utenti, eq(iscrizioni.consensoVerificatoDa, utenti.id))
      .where(and(dellAnno, eq(iscrizioni.consensoVerifica, "mancante")))
      .orderBy(asc(ragazzi.cognome), asc(ragazzi.nome))
      .all();
    return {
      consensi: conti?.consensi ?? 0,
      verificati: conti?.verificati ?? 0,
      mancanti: mancanti.map((m) => ({
        id: m.id,
        nome: m.nome,
        cognome: m.cognome,
        unita: m.unita as UnitaKey,
        verificatoIl: m.verificatoIl ?? "",
        verificatoDa: m.verificatoDa ?? "",
      })),
    };
  } catch (errore) {
    solleva("iscritti.statoVerifiche", errore);
  }
}
