import { type Azione, type Livello } from "@/lib/permessi";
import {
  decidi,
  livelloNellaMatrice,
  type Motivo,
  Negato,
  type Risorsa,
  vaInCoda,
} from "@/lib/auth/decisione";
import { leggiMatrice } from "@/lib/permessi-store";
import { registra } from "@/lib/registro-store";
import type { Sessione } from "@/lib/sessione";
import { sessioneCorrente } from "@/lib/sessione-server";
import type { TipoOperazione } from "@/lib/registro";

/**
 * Il cancello autorizzativo: un punto solo da cui passano tutte le scritture.
 *
 * Prima della fase 5 l'autorizzazione era distribuita in tre posti — il
 * middleware per la navigazione, i tre predicati di `lib/sessione.ts`, e un
 * controllo scritto a mano in cima a ogni Server Action. Funzionava, ma la
 * matrice dei permessi che l'amministratore vedeva a schermo era **un'altra
 * cosa**: documentazione, non configurazione. Cambiarla non apriva né chiudeva
 * nessuna porta, e la schermata lo diceva.
 *
 * Adesso decide lei. `contesto()` legge il livello dalla tabella `permessi`, che
 * è la stessa riga che la matrice mostra: non possono più divergere, perché sono
 * la stessa riga letta due volte. È il punto di §4 del piano.
 *
 * La sequenza è obbligata e in quest'ordine:
 *
 *     1. sessione valida
 *     2. ruolo abilitato all'azione        <- dalla tabella
 *     3. ambito che copre la risorsa
 *     4. transazione                       <- la apre lo store
 *     5. operazione
 *     6. registro
 *
 * La transazione si apre **dopo** il terzo cancello, così una scrittura parziale
 * seguita da un rifiuto non può esistere. E i rifiuti finiscono nel registro
 * quanto le operazioni riuscite: sono il segnale che qualcosa non torna.
 *
 * Modulo di solo server.
 */

/**
 * Ri-esportati per comodità di chi chiama: `contesto()` e il suo rifiuto si
 * importano dallo stesso posto, e chi non gli serve la parte pura non deve
 * sapere che esiste un secondo modulo.
 */
export { decidi, livelloNellaMatrice, Negato, vaInCoda };
export type { Motivo, Risorsa };

export interface Contesto {
  sessione: Sessione;
  /** nome utente di chi agisce, per gli store che lo scrivono come autore */
  utente: string;
  /** il livello che gli è stato riconosciuto: `completo` o `limitato` */
  livello: Exclude<Livello, "nessuno">;
  /**
   * Scrive nel registro a nome di chi ha agito.
   *
   * È qui e non importata a parte perché il registro va lasciato **dopo**
   * l'operazione, e avere la funzione già legata alla sessione è il modo di non
   * dimenticarsene.
   */
  registra: (tipo: TipoOperazione, operazione: string, origine: string) => Promise<void>;
}

/** Il livello di un ruolo per un'azione, letto dalla tabella. */
async function livelloDi(azione: Azione, ruolo: string): Promise<Livello> {
  return livelloNellaMatrice(await leggiMatrice(), azione, ruolo);
}

/**
 * Registra un rifiuto e **restituisce** l'errore, che chi chiama solleva.
 *
 * Restituire invece di sollevare non è un vezzo: `throw await prepara(...)`
 * permette a TypeScript di capire che il codice dopo non viene eseguito, e
 * quindi di restringere `sessione` a non-nullo. Con una funzione che solleva
 * dentro una `Promise` l'analisi del flusso non ci arriva, e servirebbero
 * asserzioni non nulle sparse — cioè spegnere il controllo proprio nel modulo
 * che decide chi può fare che cosa.
 *
 * Il rifiuto si registra **prima**, perché sollevare interrompe: se la scrittura
 * del registro stesse dopo, un rifiuto non finirebbe mai nel log — ed è proprio
 * il caso in cui il log serve.
 */
async function preparaNegato(
  sessione: Sessione | null,
  motivo: Motivo,
  azione: Azione,
  risorsa?: Risorsa,
): Promise<Negato> {
  // La descrizione, in qualche azione, è costruita con l'input del modulo prima
  // che sia validato, e il rifiuto arriva anche a chi non ha una sessione:
  // basta conoscere l'id dell'azione. Si tiene il tanto che serve a capire su
  // che cosa (DOS-02); il tetto di `registra()` resta la rete sotto.
  const descrizione = risorsa?.descrizione;
  const dove = descrizione
    ? ` su ${descrizione.length > 120 ? `${descrizione.slice(0, 119)}…` : descrizione}`
    : "";
  const ambito = risorsa?.unita ? ` (unità ${risorsa.unita})` : "";

  await registra(
    // senza sessione non si sa chi ha provato: si registra quello che si sa,
    // invece di non registrare niente
    sessione ?? { u: "sconosciuto", n: "sconosciuto", r: "referente", i: "", exp: 0 },
    "configurazione",
    `Rifiutata «${azione}»${dove}${ambito} — ${motivo}`,
    "autorizzazione",
    "rifiutato",
  );

  return new Negato(motivo, azione);
}

/**
 * I tre cancelli. Solleva `Negato` se uno non passa.
 *
 * Chi non la chiama non ottiene il nome utente da scrivere come autore né la
 * funzione di registro: non è una barriera insuperabile — il `db()` resta
 * raggiungibile dagli store, che è l'architettura che il mandato di fase 2B
 * chiedeva di conservare — ma è la strada che ogni scrittura percorre, e le
 * deviazioni si vedono in revisione perché mancano l'autore e la riga di log.
 */
export async function contesto(azione: Azione, risorsa?: Risorsa): Promise<Contesto> {
  const sessione = await sessioneCorrente();
  const esito = decidi(await leggiMatrice(), sessione, azione, risorsa);

  if (!esito.ok) throw await preparaNegato(sessione, esito.motivo, azione, risorsa);

  // la sessione è non-nulla: `decidi` restituisce «sessione» come motivo quando
  // manca, quindi qui l'unica strada rimasta l'ha già vista valida
  const valida = sessione as Sessione;
  return {
    sessione: valida,
    utente: valida.u,
    livello: esito.livello,
    registra: (tipo, operazione, origine) => registra(valida, tipo, operazione, origine),
  };
}

/**
 * Il primo cancello, da passare **prima** di cercare un record.
 *
 * Molte azioni leggono la riga per sapere a che unità appartiene, e solo dopo
 * chiamano `contesto()` con quell'ambito. In quell'ordine, chi non ha una
 * sessione riceveva «non esiste più» per un id inventato e «sessione scaduta»
 * per uno vero: abbastanza per contare account, iscrizioni e bozze senza
 * essere entrato (audit del 7 ottobre, SEC-AUTH-003). Qui si guardano sessione
 * e ruolo, che non dipendono dal record; l'ambito resta a `contesto()`, che si
 * chiama dopo la lettura come prima.
 */
export async function ingresso(azione: Azione): Promise<void> {
  const sessione = await sessioneCorrente();
  if (!sessione) throw await preparaNegato(null, "sessione", azione);
  if ((await livelloDi(azione, sessione.r)) === "nessuno") {
    throw await preparaNegato(sessione, "ruolo", azione);
  }
}

/**
 * Il livello di un'azione per la sessione corrente, senza sollevare.
 *
 * Serve all'interfaccia, che nasconde i comandi che l'utente non può usare. È
 * una gentilezza **in più**: la sicurezza la fa `contesto()` server-side, e una
 * schermata che nasconde un pulsante non protegge niente da chi costruisce la
 * richiesta a mano.
 */
export async function livelloPer(azione: Azione): Promise<Livello> {
  const sessione = await sessioneCorrente();
  if (!sessione) return "nessuno";
  return livelloDi(azione, sessione.r);
}

/**
 * Come `puo()`, ma restituisce anche sessione e livello — o `null`.
 *
 * Per le letture che oltre al «sì» hanno bisogno di sapere **come**: con
 * `limitato` il social media manager vede solo i propri contenuti
 * (`soloIPropri`), e per chiederlo serve il livello. Non scrive nel registro,
 * come `puo()`: una lettura negata non è un tentativo di scrittura.
 */
export async function concesso(
  azione: Azione,
  risorsa?: Risorsa,
): Promise<{ sessione: Sessione; livello: Exclude<Livello, "nessuno"> } | null> {
  const sessione = await sessioneCorrente();
  const esito = decidi(await leggiMatrice(), sessione, azione, risorsa);
  return esito.ok && sessione ? { sessione, livello: esito.livello } : null;
}

/** Vero se la sessione corrente può fare l'azione, eventualmente nel suo ambito. */
export async function puo(azione: Azione, risorsa?: Risorsa): Promise<boolean> {
  // passa da `decidi`, la stessa funzione che usa il cancello: una seconda
  // copia della regola per l'interfaccia è il modo di farle divergere, ed è
  // esattamente il difetto che questa fase è servita a togliere
  return decidi(await leggiMatrice(), await sessioneCorrente(), azione, risorsa).ok;
}

/**
 * Traduce un `Negato` nella forma che le azioni restituiscono ai form.
 *
 * Da usare nel `catch`, insieme a quello di `ErroreDatabase`: sono i due modi in
 * cui un'operazione può non farsi, e nessuno dei due deve arrivare al browser
 * come eccezione.
 */
export function esitoNegato(e: Negato): {
  stato: "errore";
  messaggio: string;
  codice: string;
} {
  return { stato: "errore", messaggio: e.message, codice: `NEGATO_${e.motivo.toUpperCase()}` };
}
