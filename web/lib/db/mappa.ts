import type { Stato } from "@/lib/contenuti";
import type { UnitaKey } from "@/lib/data";

/**
 * Conversioni fra il vocabolario dell'applicazione e quello del database.
 *
 * Sta in un modulo solo perché è l'unico posto in cui le due rappresentazioni si
 * toccano: gli store passano da qui, e nessun altro. Le decisioni e il motivo di
 * ciascuna sono in `docs/implementation/schema-decisions.md`.
 *
 * Nessun import di `node:*`: questo modulo è importabile anche da un componente
 * client, che serve per formattare l'anno a schermo.
 */

// --------------------------------------------------------------------------
// Stato di album e documenti
// --------------------------------------------------------------------------

/**
 * Lo stato come lo scrive il database.
 *
 * Differisce dall'applicazione per un valore su tre: `in_revisione` con
 * l'underscore, perché è la convenzione di tutti gli altri elenchi chiusi del
 * modello (`da_saldare`, `in_attesa`, `da_leggere`). Il trattino sopravvive solo
 * dove è il dominio ad averlo, cioè nei ruoli, che finiscono negli indirizzi.
 */
export type StatoDb = "bozza" | "in_revisione" | "pubblicato";

/**
 * I due dizionari sono `Record` completi e non funzioni con `switch`: un valore
 * aggiunto a `Stato` e dimenticato qui **non compila**. È la differenza fra un
 * vincolo e una convenzione da ricordare.
 */
const STATO_IN_DB: Record<Stato, StatoDb> = {
  bozza: "bozza",
  "in-revisione": "in_revisione",
  pubblicato: "pubblicato",
};

const DB_IN_STATO: Record<StatoDb, Stato> = {
  bozza: "bozza",
  in_revisione: "in-revisione",
  pubblicato: "pubblicato",
};

/**
 * Le due conversioni **sollevano** su un valore non mappato, invece di
 * restituire `undefined`.
 *
 * Non è pedanteria difensiva: senza, un valore fuori elenco diventa un guasto
 * silenzioso. Drizzle omette dall'`UPDATE` le colonne il cui valore è
 * `undefined`, quindi `set({ stato: statoInDb("inventato") })` non scriveva
 * niente e l'operazione restituiva `true` — chi la chiama crede di aver
 * cambiato lo stato e non è cambiato nulla. Meglio un errore che si vede.
 *
 * Il tipo `Stato` lo impedisce già in TypeScript: qui si copre il caso in cui il
 * valore arrivi da un cast o da JavaScript non tipizzato, che è esattamente da
 * dove arriverebbe.
 */
export function statoInDb(s: Stato): StatoDb {
  const v = STATO_IN_DB[s];
  if (!v) throw new Error(`stato non riconosciuto: ${JSON.stringify(s)}`);
  return v;
}

export function dbInStato(s: StatoDb): Stato {
  const v = DB_IN_STATO[s];
  if (!v) throw new Error(`stato del database non riconosciuto: ${JSON.stringify(s)}`);
  return v;
}

/** Gli stati ammessi dal database, per il `CHECK` e per i test. */
export const STATI_DB = Object.values(STATO_IN_DB) as StatoDb[];

// --------------------------------------------------------------------------
// Anno sociale
// --------------------------------------------------------------------------

/**
 * L'anno canonico: `2026-2027`. È già la forma di `ANNI_DOC[].chiave` e quella
 * con cui i documenti sono persistiti oggi.
 */
const CANONICO = /^(\d{4})-(\d{4})$/;

/**
 * Riconosce le forme in cui l'anno può arrivare, e le riporta a quella
 * canonica.
 *
 * Tollerante di proposito: l'editor degli album pretende il trattino lungo
 * (`album/actions.ts`), quello dei documenti pretende quello corto
 * (`documenti/actions.ts`), e nessuna delle due validazioni va toccata. Chi
 * scrive nel database passa comunque da qui.
 *
 * Restituisce `null` per qualunque cosa non sia un anno: chi chiama decide se è
 * un errore di validazione o un dato da saltare, e non riceve una stringa
 * inventata.
 */
export function displayInEtichetta(testo: string): string | null {
  // si normalizzano i trattini tipografici e si togliono gli spazi attorno
  const pulito = testo
    .trim()
    .replace(/[‐-―−]/g, "-") // trattini unicode → trattino ASCII
    .replace(/\s*-\s*/g, "-");

  const m = CANONICO.exec(pulito);
  if (!m) return null;

  // un anno sociale va da settembre a luglio: il secondo numero è il primo più uno
  if (Number(m[2]) !== Number(m[1]) + 1) return null;
  return pulito;
}

/**
 * L'anno come lo mostra il sito: `2026 – 2027`, con il trattino lungo e gli
 * spazi. È la forma che `/foto` stampa come intestazione di gruppo e che
 * `ANNI_DOC[].label` già usa.
 *
 * Non si conserva nel database: si ricava. Tenere due colonne per lo stesso
 * concetto è il modo di farle divergere.
 */
export function etichettaInDisplay(etichetta: string): string {
  const m = CANONICO.exec(etichetta);
  return m ? `${m[1]} – ${m[2]}` : etichetta;
}

/**
 * Inizio e fine di un anno sociale, dedotti dall'etichetta.
 *
 * La convenzione — da settembre a luglio — è dichiarata dal piano §3. Sono due
 * colonne `NOT NULL` che nel repository non hanno una sorgente: si derivano in
 * modo esplicito invece di inventare due date diverse a ogni importazione.
 */
export function periodoDiAnno(etichetta: string): { inizio: string; fine: string } | null {
  const m = CANONICO.exec(etichetta);
  if (!m) return null;
  return { inizio: `${m[1]}-09-01`, fine: `${m[2]}-07-31` };
}

// --------------------------------------------------------------------------
// Unità, e il caso «gruppo»
// --------------------------------------------------------------------------

/**
 * `gruppo` non è un'unità: è l'assenza di unità.
 *
 * `UnitaKey` ha sette valori ma il gruppo ha sei unità — la settima è la voce
 * delle attività comuni. Nel database diventa `unita_id IS NULL`, come vuole il
 * piano («nullo se di gruppo»), e non una settima riga in `unita`.
 *
 * Non è un dettaglio di stile: il trigger dei consensi si regge su
 * `(NEW.unita_id IS NULL OR i.unita_id = NEW.unita_id)`, che è ciò che rende un
 * album di gruppo soggetto ai consensi di **tutte** le unità. Con una riga
 * «gruppo» in tabella, quel confronto non troverebbe nessuna iscrizione e gli
 * album di gruppo passerebbero senza controllo.
 */
export const CHIAVE_GRUPPO = "gruppo" satisfies UnitaKey;

export const eDiGruppo = (unita: UnitaKey): boolean => unita === CHIAVE_GRUPPO;

/** La chiave da restituire agli store a partire dall'unità letta dal database. */
export const chiaveUnita = (chiave: string | null | undefined): UnitaKey =>
  (chiave ?? CHIAVE_GRUPPO) as UnitaKey;

// --------------------------------------------------------------------------
// Tempo
// --------------------------------------------------------------------------

/**
 * Le date nel database sono `TEXT` ISO-8601 in UTC; l'applicazione usa
 * millisecondi dall'epoca (`Voce.quando`, `AlbumSalvato.aggiornato`).
 *
 * Lo zero non diventa il 1° gennaio 1970: i record del seme hanno
 * `aggiornato: 0` per dire «nessuno l'ha mai toccato», e la verità di quel dato
 * è `NULL`.
 *
 * La forma è quella del database: secondi, con lo `Z`, **senza millisecondi**.
 *
 * Deve combaciare esattamente con il valore predefinito dichiarato nello schema,
 * `strftime('%Y-%m-%dT%H:%M:%SZ','now')`, e la ragione è che le date sono `TEXT`
 * e si ordinano come stringhe. Mescolare le due precisioni ordina male:
 *
 *   '2026-08-22T18:00:00.000Z'  <  '2026-08-22T18:00:00Z'
 *                            ^                        ^
 *                       '.' = 0x2E              'Z' = 0x5A
 *
 * cioè una riga scritta dall'applicazione con i millisecondi risulterebbe
 * *precedente* a una scritta dal valore predefinito nello stesso secondo. È il
 * genere di difetto che si vede solo come «il registro mostra le voci in ordine
 * strano», mesi dopo.
 *
 * Il secondo basta: `quandoLeggibile` mostra i minuti, e dove serve un ordine
 * stretto fra voci dello stesso secondo si aggiunge l'id come secondo criterio.
 */
const senzaMillisecondi = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;

export const msInIso = (ms: number): string | null =>
  ms > 0 ? senzaMillisecondi(new Date(ms)) : null;

export const isoInMs = (iso: string | null | undefined): number =>
  iso ? Date.parse(iso) : 0;

/** L'istante corrente nella forma che il database si aspetta. */
export const adessoIso = (): string => senzaMillisecondi(new Date());
