import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import {
  ambitoDa,
  ETICHETTA_TIPO,
  eTipoValido,
  separa,
  tipoAmmessoPer,
  type TipoAttivita,
  unisci,
} from "@/lib/attivita";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { haColonna } from "@/lib/db/colonne";
import { solleva } from "@/lib/db/errori";
import { dbInStato, statoInDb } from "@/lib/db/mappa";
import { assicuraRiferimenti, assicuraRiferimentiIn } from "@/lib/db/riferimenti";
import { anniSociali, attivita as tabella, unita, utenti } from "@/lib/db/schema";
import type { Stato } from "@/lib/contenuti";
import { EVENTI, type Evento, MESI_ORDINE, type UnitaKey } from "@/lib/data";

/**
 * Il calendario delle attività. Modulo di solo server.
 *
 * Prima non esisteva: `EVENTI` in `lib/data.ts` era l'unica sorgente, e la
 * tabella `attivita` era vuota — l'unica delle venti a esserlo. Adesso la
 * tabella è la sorgente, e `EVENTI` è il seme, esattamente come per gli album.
 *
 * ## Che cosa è cambiato nella forma dei dati
 *
 * `Evento.tipo` diceva **due cose insieme**: `gruppo` e `unità` dicevano a chi
 * si rivolge l'attività, `campo` e `escursione` che cosa è. E la prima delle due era
 * già scritta anche in `Evento.unita`, che il calendario mostra come pastiglie
 * accanto a ogni data — cioè la stessa informazione due volte, in due colonne
 * che potevano contraddirsi.
 *
 * Adesso `tipo` porta solo «che cosa è» (vedi `lib/attivita.ts`) e l'ambito lo
 * portano `unita_id` e `unita_chiavi`. `Calendario.tsx` **non è stato toccato**:
 * continua a mostrare `e.tipo` accanto al titolo e `e.unita` come pastiglie, e
 * adesso le due cose dicono cose diverse invece di ripetersi.
 *
 * ## Il giorno della settimana non si conserva
 *
 * `Evento.dow` (`dom`, `sab`, …) si ricava dalla data invece di stare in una
 * colonna. Una data e il suo giorno della settimana non possono divergere, e
 * tenerli separati vorrebbe dire poterlo fare. Che il seme fosse già coerente
 * non l'ho dato per scontato: c'è una prova che lo verifica evento per evento.
 */

export interface AttivitaSalvata extends Evento {
  id: number;
  /** chiave del tipo, non l'etichetta: `uscita-squadra`, non «uscita di squadra» */
  tipoChiave: TipoAttivita;
  stato: Stato;
  /** l'anno sociale in forma canonica: `2026-2027` */
  anno_sociale: string;
}

const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"] as const;

/** Il mese come lo scrive `lib/data.ts`, dal numero 1–12. */
const NOME_MESE = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

/**
 * L'anno sociale di una data: settembre apre, agosto chiude.
 *
 * Non si chiede a chi scrive un'attività di dirlo: è una funzione della data, e
 * chiederlo vorrebbe dire poter ricevere una risposta sbagliata.
 */
export function annoSocialeDi(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/** Da giorno/mese/anno del seme alla data ISO. `null` se il mese non si riconosce. */
export function isoDaEvento(giorno: number, mese: string, anno: number): string | null {
  const i = NOME_MESE.indexOf(mese);
  if (i < 0) return null;
  return `${anno}-${String(i + 1).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`;
}

/** Il giorno della settimana di una data ISO, nella forma del sito. */
export function giornoSettimana(iso: string): string {
  // `T12:00:00Z` e non mezzanotte: a mezzanotte UTC una data cade nel giorno
  // prima per chi sta a ovest di Greenwich, e il calendario slitterebbe di uno
  return GIORNI[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

interface Riga {
  id: number;
  titolo: string;
  dataIso: string | null;
  dataTesto: string;
  tipo: string;
  nota: string;
  luogo: string;
  durata: string;
  stato: string;
  anno: string;
  unitaChiave: string | null;
  unitaChiavi: string;
}

function comeAttivita(r: Riga): AttivitaSalvata {
  const iso = r.dataIso ?? "";
  const [anno, mese, giorno] = iso.split("-").map(Number);
  const ambito = ambitoDa(r.unitaChiave, r.unitaChiavi);

  return {
    id: r.id,
    giorno: giorno || 1,
    dow: iso ? giornoSettimana(iso) : "",
    mese: NOME_MESE[(mese || 1) - 1],
    anno: anno || 0,
    titolo: r.titolo,
    // per la pagina pubblica `tipo` è l'etichetta; la chiave sta accanto
    tipo: r.tipo,
    tipoChiave: r.tipo as TipoAttivita,
    unita:
      ambito.genere === "gruppo"
        ? (["gruppo"] as UnitaKey[])
        : ambito.genere === "unita"
          ? [ambito.chiave]
          : ambito.chiavi,
    nota: r.nota,
    luogo: r.luogo,
    durata: r.durata,
    stato: dbInStato(r.stato as Parameters<typeof dbInStato>[0]),
    anno_sociale: r.anno,
  };
}

/**
 * Che cosa **è** ciascuna attività del seme.
 *
 * Il seme diceva `gruppo` o `unità`, che adesso sono l'ambito e non il tipo:
 * per ogni riga serve dire che cosa sono davvero. Non è una regola
 * automatica, è una tabella scritta a mano — e va letta come tale: sono
 * contenuti dimostrativi, e un referente che guarda «Apertura dell'anno sociale» e
 * pensa che non sia una festa ha ragione lui. Si cambia dalla schermata, riga
 * per riga, senza migrazioni.
 */
const TIPO_DEL_SEME: Record<string, TipoAttivita> = {
  "Apertura dell’anno sociale": "festa",
  "Prima uscita di unità": "uscita",
  "Castagnata con le famiglie": "festa",
  "Uscita di squadra": "uscita-squadra",
  "Giornata di servizio nel quartiere": "servizio",
  "Uscita invernale": "uscita",
  "Pernotto in sede": "uscita",
  "Festa di primavera": "festa",
  "Festa di gruppo": "festa",
  "Incontro di zona": "distretto",
  "Uscita finale di unità": "uscita",
  "Chiusura dell’anno": "festa",
  "Campo estivo": "campo",
  "Gita in montagna": "escursione",
};

/**
 * Il tipo di un evento del seme. Quando il titolo non è in tabella si ricade
 * sul vecchio valore, se è un tipo valido, e su `riunione` se non lo è —
 * dicendolo, perché è il segnale che la tabella qui sopra è rimasta indietro.
 */
function tipoDelSeme(e: Evento): TipoAttivita {
  const noto = TIPO_DEL_SEME[e.titolo];
  if (noto) return noto;
  if (eTipoValido(e.tipo)) return e.tipo;
  console.warn(
    `attività: «${e.titolo}» ha tipo «${e.tipo}», che non è nel vocabolario. ` +
      "Uso «riunione»: aggiungete la riga in TIPO_DEL_SEME.",
  );
  return "riunione";
}

/**
 * Materializza il seme se la tabella è vuota.
 *
 * Come per gli album: va chiamata **dentro** la transazione della scrittura, e
 * una lettura non la chiama mai — in compilazione il database può non esistere.
 */
function semina(d: Handle): void {
  const quante = d.select({ n: sql<number>`count(*)` }).from(tabella).get()?.n ?? 0;
  if (quante > 0) return;

  assicuraRiferimentiIn(d);

  const anni = new Map(
    d
      .select({ e: anniSociali.etichetta, id: anniSociali.id })
      .from(anniSociali)
      .all()
      .map((a) => [a.e, a.id]),
  );
  const idUnita = new Map(
    d
      .select({ c: unita.chiave, id: unita.id })
      .from(unita)
      .all()
      .map((u) => [u.c, u.id]),
  );

  for (const e of EVENTI) {
    const iso = isoDaEvento(e.giorno, e.mese, e.anno);
    if (!iso) {
      console.warn(`attività: «${e.titolo}» ha il mese «${e.mese}», che non riconosco: salto.`);
      continue;
    }
    const annoId = anni.get(annoSocialeDi(iso));
    if (annoId === undefined) {
      console.warn(
        `attività: «${e.titolo}» cade nell'anno ${annoSocialeDi(iso)}, che non è fra gli anni ` +
          "sociali: salto la riga.",
      );
      continue;
    }

    // «gruppo» non è un'unità: è l'assenza di unità, e le due colonne
    // dell'ambito devono restare come vuole il CHECK — una sola parla
    const chiavi = e.unita.filter((u) => u !== "gruppo");
    const unaSola = chiavi.length === 1 ? idUnita.get(chiavi[0]) : undefined;

    d.insert(tabella)
      .values({
        annoId,
        unitaId: unaSola ?? null,
        unitaChiavi: unaSola !== undefined || chiavi.length === 0 ? "" : unisci(chiavi),
        titolo: e.titolo,
        dataIso: iso,
        dataTesto: `${e.giorno} ${e.mese.slice(0, 3).toLowerCase()} ${e.anno}`,
        tipo: tipoDelSeme(e),
        nota: e.nota,
        luogo: e.luogo,
        durata: e.durata,
        // il calendario del seme è quello che il sito pubblica già
        stato: statoInDb("pubblicato"),
      })
      .run();
  }
}

/** La selezione comune, con anno e unità già uniti. */
function selezione(d: Handle) {
  return d
    .select({
      id: tabella.id,
      titolo: tabella.titolo,
      dataIso: tabella.dataIso,
      dataTesto: tabella.dataTesto,
      tipo: tabella.tipo,
      nota: tabella.nota,
      luogo: tabella.luogo,
      durata: tabella.durata,
      stato: tabella.stato,
      anno: anniSociali.etichetta,
      unitaChiave: unita.chiave,
      unitaChiavi: tabella.unitaChiavi,
    })
    .from(tabella)
    .innerJoin(anniSociali, eq(tabella.annoId, anniSociali.id))
    .leftJoin(unita, eq(tabella.unitaId, unita.id));
}

/**
 * Tutte le attività, in ordine di data. `cache` lega la lettura alla richiesta.
 *
 * Con la tabella vuota si restituisce il seme, senza scrivere: è il caso della
 * compilazione, dove `/attivita` viene prerenderizzata e il database può non
 * esserci affatto. Stesso comportamento degli altri store.
 */
export const leggiAttivita = cache(async (): Promise<AttivitaSalvata[]> => {
  const d = dbSeEsiste();
  if (!d) return semeComeAttivita();

  try {
    const righe = selezione(d).orderBy(asc(tabella.dataIso), asc(tabella.id)).all();
    return righe.length === 0 ? semeComeAttivita() : righe.map(comeAttivita);
  } catch (errore) {
    /*
     * Qui non si solleva: si ricade sul seme, dicendolo forte.
     *
     * Il caso che capita davvero è un database indietro di una migrazione —
     * `unita_chiavi` non esiste ancora — e succede in **compilazione**, dove
     * questa pagina viene prerenderizzata. Sollevare fa fallire `next build`
     * con «qualcosa non ha funzionato salvando i dati», che è vero e inutile:
     * chi lo legge non ha modo di sapere che gli manca un `npm run db:applica`.
     *
     * Ricadere sul seme è lo stesso comportamento che questa funzione ha già
     * quando il database non c'è affatto, e il calendario che esce è quello
     * che il sito mostrava prima della fase 8 — non una pagina vuota. Le
     * scritture invece continuano a sollevare: là un errore va visto.
     */
    console.error(
      "attività: non riesco a leggere la tabella, uso il calendario del seme. " +
        "Se avete appena aggiornato, manca «npm run db:applica».",
      errore,
    );
    return semeComeAttivita();
  }
});

/** Il seme nella forma dello store, per quando il database non c'è. */
function semeComeAttivita(): AttivitaSalvata[] {
  return EVENTI.map((e, i) => {
    const iso = isoDaEvento(e.giorno, e.mese, e.anno) ?? "";
    return {
      ...e,
      id: -(i + 1),
      dow: iso ? giornoSettimana(iso) : e.dow,
      tipo: tipoDelSeme(e),
      tipoChiave: tipoDelSeme(e),
      stato: "pubblicato" as Stato,
      anno_sociale: iso ? annoSocialeDi(iso) : "",
    };
  });
}

/** Le sole attività pubblicate: quello che le famiglie vedono. */
export async function attivitaPubbliche(): Promise<AttivitaSalvata[]> {
  return (await leggiAttivita()).filter((a) => a.stato === "pubblicato");
}

/** Un'attività per identificativo. */
export async function attivitaPerId(id: number): Promise<AttivitaSalvata | null> {
  const d = dbSeEsiste();
  if (!d) return (await leggiAttivita()).find((a) => a.id === id) ?? null;
  try {
    const r = selezione(d).where(eq(tabella.id, id)).get();
    return r ? comeAttivita(r) : null;
  } catch (errore) {
    solleva("attivita-store.attivitaPerId", errore);
  }
}

export interface NuovaAttivita {
  titolo: string;
  /** ISO `2026-10-11`; l'anno sociale e il giorno della settimana si ricavano */
  data: string;
  tipo: TipoAttivita;
  /** una sola unità, oppure più d'una, oppure niente per «tutto il gruppo» */
  unita?: UnitaKey[];
  nota?: string;
  luogo?: string;
  durata?: string;
}

/**
 * Traduce l'ambito nelle due colonne, rispettando il `CHECK`.
 *
 * Si chiama **fuori** dalla transazione, e non è una questione di stile.
 * `solleva()` trasforma qualunque cosa esca da un `try` in un `ErroreDatabase`
 * con un messaggio generico — è il suo compito, perché il dettaglio di un
 * guasto SQLite non va mostrato a nessuno. Ma «l'unità castorini non esiste»
 * non è un guasto: è una cosa che chi ha chiamato deve poter leggere e
 * correggere. Dentro il try diventava «qualcosa non ha funzionato sul server».
 * È lo stesso difetto già trovato in `creaUtente` alla fase 6.
 */
function ambitoInColonne(
  d: Handle,
  chiaviRichieste: readonly UnitaKey[] | undefined,
): { unitaId: number | null; unitaChiavi: string } {
  const chiavi = (chiaviRichieste ?? []).filter((u) => u !== "gruppo");
  if (chiavi.length === 0) return { unitaId: null, unitaChiavi: "" };

  if (chiavi.length === 1) {
    const id = d
      .select({ id: unita.id })
      .from(unita)
      .where(eq(unita.chiave, chiavi[0]))
      .get()?.id;
    if (id === undefined) throw new Error(`Unità sconosciuta: ${chiavi[0]}`);
    return { unitaId: id, unitaChiavi: "" };
  }

  const note = new Set(d.select({ c: unita.chiave }).from(unita).all().map((u) => u.c));
  const ignote = chiavi.filter((c) => !note.has(c));
  if (ignote.length > 0) throw new Error(`Unità sconosciute: ${ignote.join(", ")}`);

  return { unitaId: null, unitaChiavi: unisci(chiavi) };
}

/** L'identificativo dell'anno sociale di una data. Solleva se quell'anno non c'è. */
function idAnnoDi(data: string): number {
  const etichetta = annoSocialeDi(data);
  const d = dbSeEsiste();
  const anno = d
    ? d
        .select({ id: anniSociali.id })
        .from(anniSociali)
        .where(eq(anniSociali.etichetta, etichetta))
        .get()
    : undefined;
  if (!anno) {
    throw new Error(
      `L'anno sociale ${etichetta} non esiste: aggiungetelo prima di mettere ` +
        "un'attività in quella data.",
    );
  }
  return anno.id;
}

function soloFasciaVerde(tipo: TipoAttivita): string {
  return (
    `«${ETICHETTA_TIPO[tipo]}» è solo per la fascia verde: scegliete l'unità 3, ` +
    "l'unità 4 o tutte e due, e nessun'altra unità."
  );
}

/** Come `ambitoInColonne`, ma prende il collegamento da sé. */
function ambitoDaChiavi(chiavi: readonly UnitaKey[] | undefined) {
  const d = dbSeEsiste();
  if (!d) throw new Error("Il database non è raggiungibile.");
  return ambitoInColonne(d, chiavi);
}

/** Crea un'attività in bozza. Restituisce l'identificativo. */
export async function creaAttivita(
  nuova: NuovaAttivita,
  autore: string,
): Promise<number> {
  if (!eTipoValido(nuova.tipo)) throw new Error(`Tipo non valido: ${nuova.tipo}`);
  if (!tipoAmmessoPer(nuova.tipo, nuova.unita ?? [])) throw new Error(soloFasciaVerde(nuova.tipo));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nuova.data)) {
    throw new Error(`Data non valida: ${nuova.data}. Serve la forma 2026-10-11.`);
  }

  // le anagrafiche prima di tutto: senza unità e anni non si può né validare né
  // scrivere, e crearle è idempotente
  assicuraRiferimenti();

  const annoId = idAnnoDi(nuova.data);
  const ambito = ambitoDaChiavi(nuova.unita);
  const [a, m, g] = nuova.data.split("-").map(Number);

  try {
    return transazione((d) => {
      semina(d);

      const r = d
        .insert(tabella)
        .values({
          annoId,
          ...ambito,
          titolo: nuova.titolo,
          dataIso: nuova.data,
          dataTesto: `${g} ${NOME_MESE[m - 1].slice(0, 3).toLowerCase()} ${a}`,
          tipo: nuova.tipo,
          nota: nuova.nota ?? "",
          luogo: nuova.luogo ?? "",
          durata: nuova.durata ?? "",
          stato: statoInDb("bozza"),
          aggiornatoIl: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
          // chi l'ha creata (0014): serve al social media manager, che ritira ed
          // elimina solo le attività sue. Prima della migrazione la colonna non c'è
          ...(haColonna(d, "attivita", "creato_da")
            ? {
                creatoDa:
                  d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, autore)).get()
                    ?.id ?? null,
              }
            : {}),
        })
        .returning({ id: tabella.id })
        .get();
      return r.id;
    });
  } catch (errore) {
    solleva("attivita-store.creaAttivita", errore);
  }
}

/** Cambia i campi indicati. Vero se l'attività c'era. */
export async function aggiornaAttivita(
  id: number,
  campi: Partial<NuovaAttivita>,
  autore: string,
): Promise<boolean> {
  void autore;
  if (campi.tipo !== undefined && !eTipoValido(campi.tipo)) {
    throw new Error(`Tipo non valido: ${campi.tipo}`);
  }
  if (campi.data !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(campi.data)) {
    throw new Error(`Data non valida: ${campi.data}. Serve la forma 2026-10-11.`);
  }
  if (campi.tipo !== undefined || campi.unita !== undefined) {
    // la regola guarda tipo e unità insieme: quello che non cambia si legge
    const attuale =
      campi.tipo === undefined || campi.unita === undefined ? await attivitaPerId(id) : null;
    const tipo = campi.tipo ?? attuale?.tipoChiave;
    const unita = campi.unita ?? attuale?.unita.filter((u) => u !== "gruppo") ?? [];
    if (tipo && !tipoAmmessoPer(tipo, unita)) throw new Error(soloFasciaVerde(tipo));
  }

  assicuraRiferimenti();

  // come in `creaAttivita`: fuori dalla transazione, se no i messaggi diventano
  // «qualcosa non ha funzionato sul server»
  const annoRichiesto = campi.data !== undefined ? idAnnoDi(campi.data) : undefined;
  const ambitoRichiesto = campi.unita !== undefined ? ambitoDaChiavi(campi.unita) : undefined;

  try {
    return transazione((d) => {
      semina(d);
      const esiste = d.select({ id: tabella.id }).from(tabella).where(eq(tabella.id, id)).get();
      if (!esiste) return false;

      const set: Record<string, unknown> = {
        aggiornatoIl: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
      };
      if (campi.titolo !== undefined) set.titolo = campi.titolo;
      if (campi.tipo !== undefined) set.tipo = campi.tipo;
      if (campi.nota !== undefined) set.nota = campi.nota;
      if (campi.luogo !== undefined) set.luogo = campi.luogo;
      if (campi.durata !== undefined) set.durata = campi.durata;

      if (campi.data !== undefined) {
        const [a, m, g] = campi.data.split("-").map(Number);
        set.annoId = annoRichiesto;
        set.dataIso = campi.data;
        set.dataTesto = `${g} ${NOME_MESE[m - 1].slice(0, 3).toLowerCase()} ${a}`;
      }

      if (ambitoRichiesto) Object.assign(set, ambitoRichiesto);

      d.update(tabella).set(set).where(eq(tabella.id, id)).run();
      return true;
    });
  } catch (errore) {
    solleva("attivita-store.aggiornaAttivita", errore);
  }
}

/** Bozza → in revisione → pubblicato, e ritorno. Vero se l'attività c'era. */
/**
 * `seUguale`: lo stesso controllo dentro la transazione di `cambiaStatoAlbum`
 * (report QA, BUG-011).
 */
export async function cambiaStatoAttivita(
  id: number,
  stato: Stato,
  autore: string,
  seUguale?: (attuale: AttivitaSalvata) => boolean,
): Promise<boolean> {
  void autore;
  try {
    return transazione((d) => {
      semina(d);
      if (seUguale) {
        const riga = selezione(d).where(eq(tabella.id, id)).get();
        if (!riga || !seUguale(comeAttivita(riga))) return false;
      }
      const n = d
        .update(tabella)
        .set({
          stato: statoInDb(stato),
          aggiornatoIl: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
        })
        .where(eq(tabella.id, id))
        .run();
      return n.changes > 0;
    });
  } catch (errore) {
    solleva("attivita-store.cambiaStatoAttivita", errore);
  }
}

/** Cancella un'attività. Vero se c'era. */
export async function eliminaAttivita(id: number, autore: string): Promise<boolean> {
  void autore;
  try {
    return transazione((d) => {
      semina(d);
      return d.delete(tabella).where(eq(tabella.id, id)).run().changes > 0;
    });
  } catch (errore) {
    solleva("attivita-store.eliminaAttivita", errore);
  }
}

/**
 * Le attività di un'unità: le sue, quelle di gruppo, e quelle di gruppi di
 * unità che la comprendono.
 *
 * Serve alla vista del referente di unità. Il filtro sull'elenco delimitato si fa in
 * memoria e non in SQL: `LIKE '%u1%'` troverebbe anche una chiave che
 * contiene l'altra come sottostringa, e a venti righe l'ottimizzazione non
 * vale il rischio.
 */
export async function attivitaDiUnita(chiave: UnitaKey): Promise<AttivitaSalvata[]> {
  return (await leggiAttivita()).filter(
    (a) => a.unita.includes("gruppo") || a.unita.includes(chiave),
  );
}

/** Le sole voci che aspettano l'approvazione. Per la coda del gestore. */
export async function attivitaInRevisione(): Promise<AttivitaSalvata[]> {
  const d = dbSeEsiste();
  if (!d) return [];
  try {
    return selezione(d)
      .where(and(eq(tabella.stato, statoInDb("in-revisione"))))
      .orderBy(asc(tabella.dataIso))
      .all()
      .map(comeAttivita);
  } catch (errore) {
    solleva("attivita-store.attivitaInRevisione", errore);
  }
}

/** I mesi nell'ordine dell'anno sociale, per chi raggruppa. Ri-esportato. */
export { MESI_ORDINE };
export { separa };

/**
 * Chi ha creato l'attività, come identificativo d'account; `null` se non si sa
 * — anche su un database fermo a prima della 0014. Vedi `creatoreAlbum`.
 */
export function creatoreAttivita(id: number): number | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    if (!haColonna(d, "attivita", "creato_da")) return null;
    return d.select({ c: tabella.creatoDa }).from(tabella).where(eq(tabella.id, id)).get()?.c ?? null;
  } catch (errore) {
    solleva("attivita.creatoreAttivita", errore);
  }
}
