import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { tentativiAccesso as tabella } from "@/lib/db/schema";

/**
 * Il conteggio dei tentativi falliti. Modulo di solo server.
 *
 * Prima stava in una `Map` dentro `accedi/actions.ts`, con un commento onesto:
 * «si azzera a ogni riavvio e non è condivisa fra processi… è un ripiego, la
 * versione vera conta su database». Questa è quella versione.
 *
 * Il riavvio non è un dettaglio da poco: chi provava password a raffica non
 * doveva far altro che aspettare un rilascio — o provocarlo — per ripartire da
 * zero. Adesso le righe restano.
 *
 * ## Finestra scorrevole, non blocco a scadenza
 *
 * §7 del piano dice «5 in 15 min, poi attesa». La `Map` lo faceva in due tempi:
 * contava fino a cinque, poi scriveva un istante di sblocco e azzerava il
 * contatore. Qui si contano le righe degli ultimi quindici minuti e basta: se
 * sono cinque o più, si aspetta. Non c'è nessuno stato di blocco da tenere
 * allineato, e la frase del piano viene applicata alla lettera invece che
 * approssimata.
 *
 * Il conteggio è doppio e indipendente — per nome utente e per indirizzo IP —
 * perché le due cose difendono da attacchi diversi: il primo dal provare mille
 * password su un referente, il secondo dal provare una password su mille referenti.
 */

export const TENTATIVI_MAX = 5;
export const FINESTRA_MINUTI = 15;

export type TipoTentativo = "utente" | "ip";

const finestra = sql`strftime('%Y-%m-%dT%H:%M:%SZ','now',${`-${FINESTRA_MINUTI} minutes`})`;

/** La chiave normalizzata: il nome utente si confronta in minuscolo, l'IP no. */
function chiaveDi(tipo: TipoTentativo, valore: string): string {
  return tipo === "utente" ? valore.trim().toLowerCase() : valore.trim();
}

/**
 * Quanti minuti mancano prima di poter riprovare, o `null` se si può adesso.
 *
 * Il momento in cui si sblocca è quando il **più vecchio** dei tentativi nella
 * finestra ne esce: da quell'istante ne restano quattro, cioè meno del limite.
 * Arrotondato per eccesso, perché dire «fra 0 minuti» a chi deve ancora
 * aspettare quaranta secondi è peggio che dire «fra 1».
 */
export function attesaMinuti(tipo: TipoTentativo, valore: string): number | null {
  const d = dbSeEsiste();
  if (!d) return null;

  try {
    const righe = d
      .select({ quando: tabella.quando })
      .from(tabella)
      .where(
        and(
          eq(tabella.tipo, tipo),
          eq(tabella.chiave, chiaveDi(tipo, valore)),
          sql`${tabella.quando} > ${finestra}`,
        ),
      )
      .orderBy(tabella.quando)
      .all();

    if (righe.length < TENTATIVI_MAX) return null;

    const scadeIlPiuVecchio = Date.parse(righe[0].quando) + FINESTRA_MINUTI * 60_000;
    return Math.max(1, Math.ceil((scadeIlPiuVecchio - Date.now()) / 60_000));
  } catch (errore) {
    solleva("tentativi.attesaMinuti", errore);
  }
}

/**
 * Il blocco che vale adesso, considerando entrambi i conteggi.
 *
 * Restituisce l'attesa **più lunga** fra le due: se l'indirizzo è bloccato per
 * dieci minuti e il nome utente per due, si aspettano dieci. Bloccare per la più
 * corta vorrebbe dire non bloccare affatto.
 */
export function attesa(utente: string, ip: string): number | null {
  const a = attesaMinuti("utente", utente);
  const b = attesaMinuti("ip", ip);
  if (a === null && b === null) return null;
  return Math.max(a ?? 0, b ?? 0);
}

/**
 * Conta il tentativo PRIMA della verifica asincrona della password.
 * Controllo e inserimento nella stessa transazione impediscono che richieste
 * concorrenti (anche su processi diversi) superino tutte il controllo.
 * In caso di errore del database si solleva: senza conteggio non si verifica.
 */
export function prenotaTentativo(utente: string, ip: string):
  | { bloccato: true; minuti: number }
  | { bloccato: false; ids: number[] } {
  return transazione((d) => {
    const minuti = attesa(utente, ip);
    if (minuti !== null) return { bloccato: true, minuti };
    const righe = d.insert(tabella).values([
      { tipo: "utente", chiave: chiaveDi("utente", utente) },
      { tipo: "ip", chiave: chiaveDi("ip", ip) },
    ]).returning({ id: tabella.id }).all();
    return { bloccato: false, ids: righe.map((r) => r.id) };
  });
}

/** Una password giusta toglie solo il proprio tentativo, mai gli altri errori. */
export function annullaPrenotazione(ids: number[]): void {
  transazione((d) => { d.delete(tabella).where(inArray(tabella.id, ids)).run(); });
}

/** Segna un tentativo fallito su entrambi i conteggi. */
export function segnaFallimento(utente: string, ip: string): void {
  try {
    transazione((d) => {
      d.insert(tabella)
        .values([
          { tipo: "utente", chiave: chiaveDi("utente", utente) },
          { tipo: "ip", chiave: chiaveDi("ip", ip) },
        ])
        .run();
    });
  } catch (errore) {
    // un accesso fallito non deve diventare un errore 500: il conteggio è una
    // difesa, non il risultato dell'operazione. Se il database non scrive, la
    // risposta all'utente resta «credenziali non valide».
    console.warn("tentativi: non sono riuscito a segnare un fallimento:", errore);
  }
}

/**
 * Azzera il conteggio dopo un accesso riuscito.
 *
 * Solo quello del nome utente, **non** quello dell'indirizzo: se così non
 * fosse, chi ha un account valido potrebbe ripulire il contatore del proprio IP
 * a ogni accesso e provare password sugli altri account all'infinito.
 */
export function azzera(utente: string): void {
  try {
    transazione((d) => {
      d.delete(tabella)
        .where(and(eq(tabella.tipo, "utente"), eq(tabella.chiave, chiaveDi("utente", utente))))
        .run();
    });
  } catch (errore) {
    console.warn("tentativi: non sono riuscito ad azzerare un conteggio:", errore);
  }
}

/**
 * Toglie i tentativi usciti dalla finestra. Restituisce quanti.
 *
 * Fra i lavori notturni di §16: le righe vecchie non contano più per nessun
 * conteggio, e senza questa pulizia la tabella crescerebbe finché c'è disco.
 */
export function pulisci(): number {
  try {
    return transazione((d) => d.delete(tabella).where(lt(tabella.quando, finestra)).run().changes);
  } catch (errore) {
    solleva("tentativi.pulisci", errore);
  }
}
