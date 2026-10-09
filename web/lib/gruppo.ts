import { readdir } from "node:fs/promises";
import { inArray, like } from "drizzle-orm";
import { cache } from "react";
import {
  cancellaCaricato,
  CARTELLA_DATI,
  leggiCaricato,
  scriviCaricato,
} from "@/lib/archivio";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { pagineTesti } from "@/lib/db/schema";
import {
  CAMPI_RECAPITI,
  type Identita,
  IDENTITA_PREDEFINITA,
  MARCHIO_PREDEFINITO,
  type Recapiti,
} from "@/lib/identita";

/**
 * Identità del gruppo: nome, sottotitolo, recapiti e marchio.
 *
 * Modulo di solo server. Prima stava in `dati/gruppo.json`, adesso in
 * `pagine_testi` come righe chiave/valore — `gruppo.nome`, `gruppo.email`, e
 * così via. Il piano non prevede una tabella per l'identità del gruppo, e §4 del
 * mandato vieta di inventarne una: `pagine_testi` è la tabella dei testi
 * editoriali, e questi sono testi editoriali.
 *
 * **Si conservano solo le differenze dai valori predefiniti.** Era la proprietà
 * del vecchio archivio ed è quella che rende sensato il modello: se un domani
 * cambia un valore in `lib/data.ts`, chi non ha personalizzato niente se lo
 * ritrova aggiornato. In chiave/valore viene naturale — la riga semplicemente
 * non c'è, e l'assenza significa «usa il predefinito».
 *
 * **La firma pubblica non cambia.** `leggiIdentita` restituisce la stessa
 * `Identita`, `fileMarchio` lo stesso buffer, le quattro scritture non
 * restituiscono niente come prima. I sedici consumer non sono stati toccati.
 *
 * `misureImmagine` si è spostata in `lib/immagini.ts`: è una funzione pura, e
 * `lib/album.ts` la importava da qui, cioè uno store importava un altro store.
 */

/** Il prefisso di tutte le chiavi di questo modulo, in un posto solo. */
const PREFISSO = "gruppo.";

const CHIAVE = {
  nome: `${PREFISSO}nome`,
  sottotitolo: `${PREFISSO}sottotitolo`,
  marchioFile: `${PREFISSO}marchio.file`,
  marchioTipo: `${PREFISSO}marchio.tipo`,
  marchioLarghezza: `${PREFISSO}marchio.larghezza`,
  marchioAltezza: `${PREFISSO}marchio.altezza`,
} as const;

/** La chiave di un recapito: `gruppo.email`, `gruppo.telefonoGestori`, … */
const chiaveRecapito = (campo: keyof Recapiti) => `${PREFISSO}${campo}`;

/**
 * Tutte le righe `gruppo.*`, come dizionario.
 *
 * Una interrogazione sola: sono nove valori, e nove `SELECT` separate per
 * disegnare un piede di pagina sarebbero nove viaggi per niente.
 */
function leggiSalvato(d: Handle): Record<string, string> {
  const righe = d
    .select({ chiave: pagineTesti.chiave, valore: pagineTesti.valore })
    .from(pagineTesti)
    .where(like(pagineTesti.chiave, `${PREFISSO}%`))
    .all();
  return Object.fromEntries(righe.map((r) => [r.chiave, r.valore]));
}

/**
 * Identità corrente. `cache` la lega alla singola richiesta: una pagina che la
 * chiede tre volte interroga il database una volta sola.
 */
export const leggiIdentita = cache(async (): Promise<Identita> => {
  const d = dbSeEsiste();
  // niente database: si servono i valori predefiniti. È il caso della
  // compilazione, e il piede del sito deve comparire comunque.
  if (!d) return IDENTITA_PREDEFINITA;

  let s: Record<string, string>;
  try {
    s = leggiSalvato(d);
  } catch (errore) {
    solleva("gruppo.leggiIdentita", errore);
  }

  /*
   * Un recapito **salvato vuoto** resta vuoto, se non è obbligatorio.
   *
   * Prima ogni valore vuoto tornava al predefinito, e per un campo che si può
   * togliere vuol dire che non si toglie: si svuotava la casella, si salvava, e
   * sul sito tornava l'indirizzo del progetto. La chiave assente è un'altra
   * cosa — «nessuno l'ha mai scritto» — e quella sì usa il predefinito. L'email
   * è obbligatoria, e un'email vuota non è mai valida: si torna al predefinito.
   */
  const recapiti = {} as Recapiti;
  for (const { chiave, obbligatorio } of CAMPI_RECAPITI) {
    const salvato = s[chiaveRecapito(chiave)];
    recapiti[chiave] =
      salvato === undefined
        ? IDENTITA_PREDEFINITA[chiave]
        : salvato.trim() || (obbligatorio ? IDENTITA_PREDEFINITA[chiave] : "");
  }

  const file = s[CHIAVE.marchioFile];
  const larghezza = Number(s[CHIAVE.marchioLarghezza]);
  const altezza = Number(s[CHIAVE.marchioAltezza]);
  // il marchio conta solo se le tre informazioni ci sono tutte: un record
  // incompleto non deve produrre un'immagine senza misure, che è esattamente
  // il salto di layout che le misure servono a evitare
  const marchioValido = Boolean(file) && Number.isFinite(larghezza) && Number.isFinite(altezza);

  return {
    ...recapiti,
    nome: s[CHIAVE.nome]?.trim() || IDENTITA_PREDEFINITA.nome,
    // vuoto si può: il modulo dice «si può lasciare vuota», e tornare al
    // predefinito non lo rispettava
    sottotitolo:
      s[CHIAVE.sottotitolo] === undefined
        ? IDENTITA_PREDEFINITA.sottotitolo
        : s[CHIAVE.sottotitolo].trim(),
    marchio: marchioValido
      ? {
          // la marca temporale nel nome del file fa da impronta: cambia a ogni
          // caricamento, quindi le cache dei browser non tengono il vecchio
          src: `/marchio/${file}`,
          larghezza,
          altezza,
        }
      : MARCHIO_PREDEFINITO,
  };
});

/** Il file del marchio caricato, per il gestore di rotta che lo serve. */
/**
 * Il nome del file del marchio registrato, o `null` se nessuno l'ha caricato.
 *
 * Diverso da `fileMarchio`, che restituisce i **byte**: qui serve il solo nome,
 * e leggere un file per buttarlo via sarebbe uno spreco. Lo usa la bonifica dei
 * metadati, che deve sapere quali file l'applicazione considera suoi.
 */
export async function fileMarchioRegistrato(): Promise<string | null> {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    return leggiSalvato(d)[CHIAVE.marchioFile] ?? null;
  } catch (errore) {
    solleva("gruppo.fileMarchioRegistrato", errore);
  }
}

export async function fileMarchio(
  nome: string,
): Promise<{ dati: Buffer; tipo: string } | null> {
  const d = dbSeEsiste();
  if (!d) return null;

  let s: Record<string, string>;
  try {
    s = leggiSalvato(d);
  } catch (errore) {
    solleva("gruppo.fileMarchio", errore);
  }

  // solo il marchio registrato è servibile: nessun altro file dell'archivio
  if (s[CHIAVE.marchioFile] !== nome) return null;
  const dati = await leggiCaricato(nome);
  return dati ? { dati, tipo: s[CHIAVE.marchioTipo] ?? "application/octet-stream" } : null;
}

// --------------------------------------------------------------------------
// Scrittura
// --------------------------------------------------------------------------

/**
 * Scrive o aggiorna un gruppo di chiavi in un colpo solo.
 *
 * `onConflictDoUpdate` sulla chiave univoca: la riga si crea la prima volta e si
 * aggiorna le successive, senza un `SELECT` in mezzo che lascerebbe una finestra
 * fra il controllo e la scrittura.
 */
function scriviChiavi(d: Handle, valori: Record<string, string>): void {
  const quando = adessoIso();
  for (const [chiave, valore] of Object.entries(valori)) {
    d.insert(pagineTesti)
      .values({ chiave, valore, aggiornatoIl: quando })
      .onConflictDoUpdate({
        target: pagineTesti.chiave,
        set: { valore, aggiornatoIl: quando },
      })
      .run();
  }
}

export async function salvaTesti(nome: string, sottotitolo: string): Promise<void> {
  try {
    transazione((d) =>
      scriviChiavi(d, {
        [CHIAVE.nome]: nome.trim(),
        [CHIAVE.sottotitolo]: sottotitolo.trim(),
      }),
    );
  } catch (errore) {
    solleva("gruppo.salvaTesti", errore);
  }
}

export async function salvaRecapiti(recapiti: Recapiti): Promise<void> {
  try {
    // i sette recapiti in una transazione: il modulo si salva tutto o niente,
    // altrimenti un guasto a metà lascerebbe il piede del sito con l'indirizzo
    // nuovo e il telefono vecchio
    transazione((d) =>
      scriviChiavi(
        d,
        Object.fromEntries(
          CAMPI_RECAPITI.map(({ chiave }) => [chiaveRecapito(chiave), recapiti[chiave]]),
        ),
      ),
    );
  } catch (errore) {
    solleva("gruppo.salvaRecapiti", errore);
  }
}

export async function salvaMarchio(
  dati: Buffer,
  tipo: string,
  misure: { larghezza: number; altezza: number },
  adesso: number,
): Promise<void> {
  const est = tipo === "image/png" ? "png" : "jpg";
  const file = `marchio-${adesso}.${est}`;

  // Il file **prima**, fuori dalla transazione: §18 del piano vieta di tenere
  // aperta una transazione durante un'operazione su filesystem. Se la
  // transazione poi fallisce resta un file orfano, che `ripulisci` porterà via
  // al prossimo salvataggio — molto meglio di una riga che punta a un file che
  // non c'è.
  await scriviCaricato(file, dati);

  try {
    transazione((d) =>
      scriviChiavi(d, {
        [CHIAVE.marchioFile]: file,
        [CHIAVE.marchioTipo]: tipo,
        // stringhe costruite qui: una colonna TEXT che riceve un numero
        // dal driver diventerebbe «277.0» invece di «277»
        [CHIAVE.marchioLarghezza]: String(misure.larghezza),
        [CHIAVE.marchioAltezza]: String(misure.altezza),
      }),
    );
  } catch (errore) {
    // la riga non c'è: si porta via subito il file appena scritto, invece di
    // lasciarlo lì a far compagnia a quelli vecchi
    await cancellaCaricato(file);
    solleva("gruppo.salvaMarchio", errore);
  }

  await ripulisci(file);
}

/** Torna al marchio consegnato con il sito. */
export async function rimuoviMarchio(): Promise<void> {
  try {
    transazione((d) => {
      d.delete(pagineTesti)
        .where(
          inArray(pagineTesti.chiave, [
            CHIAVE.marchioFile,
            CHIAVE.marchioTipo,
            CHIAVE.marchioLarghezza,
            CHIAVE.marchioAltezza,
          ]),
        )
        .run();
    });
  } catch (errore) {
    solleva("gruppo.rimuoviMarchio", errore);
  }
  await ripulisci(null);
}

/**
 * Cancella i marchi vecchi: ne resta uno solo, quello in uso.
 *
 * Fuori dalla transazione, e dopo il commit: cancellare file dentro una
 * transazione significherebbe, in caso di annullamento, aver perso i file e
 * riavuto le righe.
 */
async function ripulisci(tienimi: string | null): Promise<void> {
  try {
    for (const f of await readdir(CARTELLA_DATI)) {
      if (f.startsWith("marchio-") && f !== tienimi) await cancellaCaricato(f);
    }
  } catch {
    // la cartella non esiste ancora: niente da ripulire
  }
}
