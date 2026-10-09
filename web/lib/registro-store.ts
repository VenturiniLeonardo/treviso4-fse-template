import { and, desc, eq, inArray, lt, not, or, sql } from "drizzle-orm";
import { cache } from "react";
import { IP_SCONOSCIUTO, ipDaCatena } from "@/lib/auth/indirizzo";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { registraEMappa, solleva } from "@/lib/db/errori";
import { adessoIso, isoInMs } from "@/lib/db/mappa";
import { registro as tabella } from "@/lib/db/schema";
import { type TipoOperazione, type Voce, VOCI_MAX } from "@/lib/registro";
import type { Sessione } from "@/lib/sessione";

/**
 * Scrittura e lettura del registro delle operazioni. Modulo di solo server.
 *
 * `registra` non solleva mai: se il registro non si scrive, l'operazione che lo
 * ha generato deve comunque riuscire. Un referente che non riesce a caricare una foto
 * perché il registro è illeggibile sarebbe il peggiore dei mondi — si perde il
 * lavoro *e* non si capisce perché. L'errore finisce sulla console del server,
 * dove chi amministra lo vede.
 *
 * **È il contratto più importante di questo modulo e il passaggio a SQLite non
 * lo cambia.** Cambia solo la natura del guasto: prima un file illeggibile o un
 * disco pieno, adesso anche un database occupato o assente.
 *
 * Il piano §4 mette il registro **dopo** la transazione (Fig. 3), e non dentro:
 * un log che non si scrive non deve annullare l'operazione che descrive. Per
 * questo qui non c'è nessuna transazione — è una riga per volta, e chi chiama ha
 * già commesso la propria.
 */

/** Le colonne che servono a costruire una `Voce`. */
const COLONNE = {
  quando: tabella.quando,
  utente: tabella.utente,
  nome: tabella.nome,
  ruolo: tabella.ruolo,
  tipo: tabella.tipo,
  operazione: tabella.operazione,
  origine: tabella.origine,
  esito: tabella.esito,
  indirizzo: tabella.indirizzo,
};

interface Riga {
  quando: string;
  utente: string;
  nome: string;
  ruolo: string;
  tipo: string;
  operazione: string;
  origine: string;
  esito: string;
  indirizzo: string | null;
}

/**
 * Da riga a `Voce`.
 *
 * Due conversioni, entrambe per non cambiare la forma che i componenti già
 * ricevono:
 *
 *  - `quando` torna in millisecondi, perché `quandoLeggibile` e `quantoFa` in
 *    `lib/registro.ts` lavorano su quelli;
 *  - `esito` compare **solo** quando vale `rifiutato`. Nel vecchio archivio la
 *    chiave veniva scritta soltanto in quel caso, quindi `Voce.esito` è
 *    facoltativo e vale `undefined` per le operazioni riuscite. Restituire
 *    `'ok'` cambierebbe la forma per ogni voce del registro.
 */
function comeVoce(r: Riga, conIndirizzi: boolean): Voce {
  return {
    quando: isoInMs(r.quando),
    utente: r.utente,
    nome: r.nome,
    ruolo: r.ruolo,
    tipo: r.tipo as TipoOperazione,
    operazione: r.operazione,
    origine: r.origine,
    ...(r.esito === "rifiutato" ? { esito: "rifiutato" as const } : {}),
    // l'IP solo a chi lo deve vedere: la chiave non c'è proprio, altrimenti
    // finirebbe serializzata nella pagina del gestore anche senza colonna
    ...(conIndirizzi && r.indirizzo ? { indirizzo: r.indirizzo } : {}),
  };
}

/**
 * Le voci del registro, più recenti in testa, al massimo `VOCI_MAX`.
 *
 * **Il limite si applica in lettura, non in scrittura.** Con il file JSON la
 * scrittura troncava l'elenco a 500 voci: le più vecchie sparivano per sempre, a
 * ogni operazione. Qui il `LIMIT` mostra le stesse 500 — la schermata si comporta
 * come prima — ma non cancella niente. La cancellazione per anzianità è il
 * lavoro notturno di conservazione (§08 del piano: registro oltre 12 mesi), che
 * è un limite temporale e non un numero.
 *
 * Non è una funzionalità in meno: è la stessa vista, senza distruggere quello
 * che sta sotto. Vedi la decisione aperta in store-migration-map.md §5.
 */
const leggiTutto = cache(async (conIndirizzi: boolean): Promise<Voce[]> => {
  const d = dbSeEsiste();
  // niente database: il registro è vuoto, non è un errore. Succede in
  // compilazione e alla prima installazione.
  if (!d) return [];

  try {
    return d
      .select(COLONNE)
      .from(tabella)
      .orderBy(desc(tabella.quando), desc(tabella.id))
      .limit(VOCI_MAX)
      .all()
      .map((r) => comeVoce(r, conIndirizzi));
  } catch (errore) {
    // anche la lettura è tollerante: una schermata di riepilogo senza registro è
    // meno grave di una schermata che non si apre
    registraEMappa("registro-store.leggiRegistro", errore);
    return [];
  }
});

/**
 * Le voci, con o senza l'indirizzo IP.
 *
 * Senza, di predefinito: l'IP è un dato personale che serve solo allo
 * sviluppatore per la sicurezza, e il gestore legge lo stesso registro.
 * Chi passa `conIndirizzi` deve aver già controllato che la sessione sia di uno
 * sviluppatore — vale il ruolo vero (`sessione.r`), non la vista che sta
 * guardando.
 */
export async function leggiRegistro(
  { conIndirizzi = false }: { conIndirizzi?: boolean } = {},
): Promise<Voce[]> {
  return leggiTutto(conIndirizzi);
}

/**
 * Le voci di un singolo utente: è quello che vede nel proprio riepilogo.
 *
 * Resta un filtro sulla stessa finestra di `leggiRegistro`, come prima, e non
 * una interrogazione propria: con una query dedicata un referente vedrebbe le proprie
 * ultime cinquecento operazioni invece di quelle che ricadono nelle ultime
 * cinquecento complessive, cioè *più* dati di adesso. Sarebbe probabilmente un
 * miglioramento, ma è un cambiamento di comportamento e non lo si fa di
 * soppiatto durante un porting.
 */
export async function registroDi(utente: string): Promise<Voce[]> {
  return (await leggiRegistro()).filter((v) => v.utente === utente);
}

/**
 * Quanto può essere lungo ciascun testo di una voce, in caratteri.
 *
 * Dall'audit di sicurezza (DOS-02): `registra()` si fidava di chi la chiamava,
 * e un nome utente da megabyte di un accesso fallito finiva intero nel
 * registro — dodici mesi di conservazione, cinquecento voci rilette in memoria
 * da ogni dashboard. I chiamanti di oggi i loro tetti li hanno; questo è la
 * rete per quelli di domani. I valori sono larghi per ogni voce vera: la più
 * lunga che il sito scrive è una descrizione d'operazione di qualche decina di
 * parole.
 */
export const TETTI_REGISTRO = { utente: 64, nome: 120, operazione: 500, origine: 64 } as const;

/**
 * L'IP della richiesta in corso, o `null` se una richiesta non c'è.
 *
 * Stessa difesa dallo spoofing di `X-Forwarded-For` dei limiti di accesso
 * (`lib/auth/indirizzo.ts`): si prende l'elemento scritto dal proxy fidato,
 * non quello scelto dal client. Fuori da una richiesta — un lavoro notturno,
 * uno script — `headers()` (o il suo import) solleva, e la voce resta senza indirizzo invece di
 * non essere scritta.
 */
async function indirizzoCorrente(): Promise<string | null> {
  try {
    // importato qui e non in testa: fuori da Next (lavoro notturno, test)
    // `next/headers` non si risolve, e il modulo deve restare caricabile
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip = ipDaCatena(h.get("x-forwarded-for"));
    // un IPv6 è lungo al massimo 45 caratteri: oltre è un'intestazione falsa
    return ip === IP_SCONOSCIUTO ? null : ip.slice(0, 64);
  } catch {
    return null;
  }
}

/** Taglia al tetto, e lo dice con un'ellissi: una voce tagliata non deve
 * sembrare intera a chi la legge. */
function taglia(testo: string, tetto: number): string {
  return testo.length > tetto ? `${testo.slice(0, tetto - 1)}…` : testo;
}

/**
 * Scrive una voce. Non solleva, per nessun motivo.
 *
 * `utente_id` resta nullo: la tabella `utenti` si popola nella fase 6, e finché
 * gli account stanno in `utenti.json` non c'è un id a cui puntare. Le colonne di
 * testo `utente`, `nome` e `ruolo` sono comunque quelle che il registro deve
 * conservare — devono sopravvivere alla cancellazione dell'account, altrimenti
 * il registro non dimostra niente.
 */
export async function registra(
  sessione: Sessione,
  tipo: TipoOperazione,
  operazione: string,
  origine: string,
  esito: "ok" | "rifiutato" = "ok",
): Promise<void> {
  try {
    const d = dbSeEsiste();
    if (!d) {
      console.error(
        "registro: database non disponibile, la voce non è stata scritta " +
          `(${tipo}: ${operazione})`,
      );
      return;
    }

    const indirizzo = await indirizzoCorrente();
    d.insert(tabella)
      .values({
        quando: adessoIso(),
        utente: taglia(sessione.u, TETTI_REGISTRO.utente),
        nome: taglia(sessione.n, TETTI_REGISTRO.nome),
        ruolo: sessione.r,
        tipo,
        operazione: taglia(operazione, TETTI_REGISTRO.operazione),
        origine: taglia(origine, TETTI_REGISTRO.origine),
        esito,
        indirizzo,
      })
      .run();
  } catch (errore) {
    // il contratto: qualunque guasto qui non deve far fallire l'operazione che
    // ha generato la voce
    registraEMappa("registro-store.registra", errore);
  }
}

/**
 * Registra un accesso o un'uscita, quando la sessione piena non c'è ancora
 * (all'accesso) o non c'è più (all'uscita).
 */
export async function registraAccesso(
  utente: string,
  nome: string,
  ruolo: string,
  tipo: "accesso" | "uscita",
  esito: "ok" | "rifiutato" = "ok",
): Promise<void> {
  await registra(
    { u: utente, n: nome, r: ruolo as Sessione["r"], i: "", exp: 0 },
    tipo,
    tipo === "accesso"
      ? esito === "ok"
        ? "Accesso riuscito"
        : "Tentativo di accesso rifiutato"
      : "Uscita dall’area riservata",
    "accesso",
    esito,
  );
}

/**
 * C'è nel registro una pubblicazione che contiene uno di questi segni?
 *
 * Serve a sapere se un contenuto oggi in bozza **è stato** online: dall'audit
 * di sicurezza (BIZ-03), un referente di unità ritira da solo — è il lato sicuro, per
 * togliere subito una fotografia contestata — ma cancellare ciò che era stato
 * approvato in due resta a chi pubblica. Lo schema non ricorda le
 * pubblicazioni passate; il registro sì, e le voci di tipo `pubblicazione` non
 * scadono mai (`TIPI_CONSERVATI`). Chi chiama passa le forme in cui quel
 * contenuto compare nelle voci: un falso positivo chiede un gestore in
 * più, che è il lato giusto da cui sbagliare.
 */
export function fuPubblicato(segni: string[]): boolean {
  const d = dbSeEsiste();
  if (!d || segni.length === 0) return false;
  try {
    return (
      d
        .select({ id: tabella.id })
        .from(tabella)
        .where(
          and(
            eq(tabella.tipo, "pubblicazione"),
            or(...segni.map((segno) => sql`instr(${tabella.operazione}, ${segno}) > 0`)),
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  } catch (errore) {
    // nel dubbio, «sì»: la conseguenza è soltanto chiedere a un gestore
    registraEMappa("registro-store.fuPubblicato", errore);
    return true;
  }
}

// --------------------------------------------------------------------------
// Filtri — funzioni pure, non toccano il database
// --------------------------------------------------------------------------

export interface Filtri {
  utente?: string;
  tipo?: string;
  /** giorni all'indietro: 1, 7, 30 */
  giorni?: number;
}

export function applicaFiltri(voci: Voce[], f: Filtri, adesso: number): Voce[] {
  return voci.filter((v) => {
    if (f.utente && v.utente !== f.utente) return false;
    if (f.tipo && v.tipo !== f.tipo) return false;
    if (f.giorni && v.quando < adesso - f.giorni * 24 * 60 * 60 * 1000) return false;
    return true;
  });
}

/** Gli utenti che compaiono nel registro, per la tendina del filtro. */
export function utentiNelRegistro(voci: Voce[]): { utente: string; nome: string }[] {
  const visti = new Map<string, string>();
  for (const v of voci) if (!visti.has(v.utente)) visti.set(v.utente, v.nome);
  return [...visti].map(([utente, nome]) => ({ utente, nome }));
}

// ==========================================================================
// Conservazione — §16, il lavoro delle 02:10
// ==========================================================================

/** Dodici mesi, come dice §16. */
export const CONSERVAZIONE_MESI = 12;

/**
 * I tipi che **non** si cancellano dopo dodici mesi.
 *
 * §16 dice «registro oltre 12» senza distinguere, e qui si distingue. Il motivo
 * non è tecnico:
 *
 * `consenso` e `pubblicazione` sono le due righe che documentano decisioni sulle
 * immagini di minori — chi ha registrato un consenso e quando, chi ha dichiarato
 * un'assenza, chi ha mandato online un album. Sono esattamente le righe che
 * `docs/implementation/gdpr.md` descrive come quelle che «finiscono la
 * conversazione» il giorno in cui una famiglia contesta una fotografia. E quella
 * contestazione può arrivare tre anni dopo: un ragazzo cresce, si iscrive
 * all'università, cerca il proprio nome.
 *
 * Cancellarle a dodici mesi vorrebbe dire tenere il dato — la fotografia è
 * ancora online, il consenso è ancora nella riga di `iscrizioni` — e buttare via
 * la prova di essere stati diligenti. È il rovescio esatto di quello che serve.
 *
 * **È una deviazione dichiarata da §16**, non una dimenticanza: se il gruppo
 * decide che dodici mesi valgono per tutto, si toglie questa costante e si
 * cancella anche quello. Vedi docs/implementation/lavori-notturni.md §2.
 */
export const TIPI_CONSERVATI: TipoOperazione[] = ["consenso", "pubblicazione"];

export interface EsitoConservazione {
  cancellate: number;
  conservate: number;
}

/**
 * Cancella le voci oltre la conservazione, tranne quelle dei tipi conservati.
 *
 * Restituisce anche quante ne ha **lasciate** apposta: senza quel numero, un
 * lavoro notturno che dice «cancellate 0» non distingue «non c'era niente di
 * vecchio» da «c'era e l'ho tenuto», e sono due cose che chi legge il registro
 * del servizio ha bisogno di distinguere.
 */
export function conserva(mesi = CONSERVAZIONE_MESI): EsitoConservazione {
  const d = dbSeEsiste();
  if (!d) return { cancellate: 0, conservate: 0 };

  const soglia = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${mesi} months`})`;
  try {
    return transazione((dd) => {
      const conservate =
        dd
          .select({ n: sql<number>`count(*)` })
          .from(tabella)
          .where(and(lt(tabella.quando, soglia), inArray(tabella.tipo, TIPI_CONSERVATI)))
          .get()?.n ?? 0;

      const cancellate = dd
        .delete(tabella)
        .where(and(lt(tabella.quando, soglia), not(inArray(tabella.tipo, TIPI_CONSERVATI))))
        .run().changes;

      // le voci conservate restano, ma senza l'IP: la prova è chi e quando,
      // l'indirizzo serve alla sicurezza e non oltre la conservazione
      dd.update(tabella)
        .set({ indirizzo: null })
        .where(and(lt(tabella.quando, soglia), sql`${tabella.indirizzo} IS NOT NULL`))
        .run();

      return { cancellate, conservate };
    });
  } catch (errore) {
    solleva("registro.conserva", errore);
  }
}

/**
 * Accorcia le voci scritte prima che `registra()` avesse i suoi tetti.
 *
 * Il passo notturno che chiude DOS-02 anche all'indietro: una voce da megabyte
 * scritta prima della correzione resterebbe dodici mesi a pesare su ogni
 * lettura. Una migrazione l'avrebbe fatto una volta sola; qui si rifà ogni
 * notte, e nei giorni normali non trova niente. Restituisce quante righe ha
 * toccato.
 */
export function accorciaFuoriMisura(): number {
  const d = dbSeEsiste();
  if (!d) return 0;

  try {
    return transazione((dd) => {
      let toccate = 0;
      for (const chiave of ["utente", "nome", "operazione", "origine"] as const) {
        const colonna = tabella[chiave];
        const tetto = TETTI_REGISTRO[chiave];
        toccate += dd
          .update(tabella)
          .set({ [chiave]: sql`substr(${colonna}, 1, ${tetto - 1}) || '…'` })
          .where(sql`length(${colonna}) > ${tetto}`)
          .run().changes;
      }
      return toccate;
    });
  } catch (errore) {
    solleva("registro.accorciaFuoriMisura", errore);
  }
}
