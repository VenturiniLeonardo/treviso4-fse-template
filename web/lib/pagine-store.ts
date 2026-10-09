import { inArray, like } from "drizzle-orm";
import { cache } from "react";
import { dbSeEsiste, type Handle, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { adessoIso } from "@/lib/db/mappa";
import { pagineTesti, utenti } from "@/lib/db/schema";
import { CHI_SIAMO, HOME } from "@/lib/data";
import { eq } from "drizzle-orm";
import {
  CAMPI_PAGINE,
  type CampoPagina,
  inRighe,
  predefinitoDi,
} from "@/lib/pagine-contenuti";
import { inParagrafi } from "@/lib/unita-contenuti";

/**
 * I testi di Home e Chi siamo: quello che i gestori cambiano, sopra quello
 * che il codice consegna.
 *
 * Modulo di solo server. Terzo store sulla stessa tabella `pagine_testi`, dopo
 * `lib/gruppo.ts` (`gruppo.*`) e i testi delle unità (`unita.*`), e con la
 * stessa proprietà: **si conservano solo le differenze.** Una chiave assente
 * significa «usa il predefinito di `lib/data.ts`».
 *
 * Tre store e una tabella non è disordine: `pagine_testi` è la tabella dei testi
 * editoriali, e questi sono testi editoriali. Il prefisso della chiave dice di
 * chi sono, e §4 del mandato vieta di inventare una tabella per una forma di
 * dato che ne ha già una.
 *
 * ## La forma salvata è quella del modulo
 *
 * In tabella un testo è **una stringa**, anche quando in pagina è un array: i
 * paragrafi con una riga vuota in mezzo, le righe del titolo con un ritorno a
 * referente. È la stessa forma che la casella mostra, e questo è il punto —
 * `inParagrafi` e `inRighe` sono le uniche due conversioni, si applicano in
 * lettura, e non esiste nessun posto in cui il testo salvato e il testo mostrato
 * possano divergere.
 */

/** Le chiavi che questo store possiede: `home.` e `chi-siamo.`. */
const PREFISSI = ["home.", "chi-siamo."] as const;

/** Tutti i valori salvati, come dizionario. Una interrogazione sola. */
function leggiSalvati(d: Handle): Record<string, string> {
  const righe = PREFISSI.flatMap((p) =>
    d
      .select({ chiave: pagineTesti.chiave, valore: pagineTesti.valore })
      .from(pagineTesti)
      .where(like(pagineTesti.chiave, `${p}%`))
      .all(),
  );
  return Object.fromEntries(righe.map((r) => [r.chiave, r.valore]));
}

/**
 * Il valore corrente di ogni campo, nella forma **testuale** del modulo.
 *
 * È quello che la schermata mostra nelle caselle. Le pagine pubbliche usano
 * `leggiHome` e `leggiChiSiamo`, che da qui ricavano gli array.
 */
export const leggiTestiPagine = cache(async (): Promise<Record<CampoPagina, string>> => {
  const d = dbSeEsiste();
  const salvati = d ? sicuro(d) : {};

  const fuori = {} as Record<CampoPagina, string>;
  for (const c of CAMPI_PAGINE) {
    const salvato = salvati[c.chiave];
    // vuoto conta come «non personalizzato», come in tutti gli altri store: chi
    // svuota una casella vuole tornare a come era, non pubblicare uno spazio
    fuori[c.chiave] = salvato?.trim() ? salvato : predefinitoDi(c.chiave);
  }
  return fuori;
});

function sicuro(d: Handle): Record<string, string> {
  try {
    return leggiSalvati(d);
  } catch (errore) {
    solleva("pagine-store.leggiTestiPagine", errore);
  }
}

/**
 * La home con i testi correnti.
 *
 * Restituisce la stessa forma di `HOME`: la pagina cambia un import e un
 * `await`, non il suo corpo. `titoloTesto` si ricompone unendo le righe con uno
 * spazio — serve al `<title>` e agli attributi, dove un ritorno a capo non ha
 * senso, e ricavarlo invece di farlo scrivere due volte è ciò che impedisce che
 * i due divergano.
 */
export async function leggiHome(): Promise<typeof HOME> {
  const t = await leggiTestiPagine();
  const titolo = inRighe(t["home.titolo"]);
  return {
    ...HOME,
    occhiello: t["home.occhiello"],
    titolo: titolo.length > 0 ? titolo : HOME.titolo,
    titoloTesto: titolo.length > 0 ? titolo.join(" ") : HOME.titoloTesto,
    intro: t["home.intro"],
    chiSiamoTitolo: t["home.chiSiamoTitolo"],
    chiSiamoTesti: paragrafiOppure(t["home.chiSiamoTesti"], HOME.chiSiamoTesti),
    citazione: t["home.citazione"],
    citazioneAutore: t["home.citazioneAutore"],
  };
}

/** «Chi siamo» con i testi correnti. Stessa forma di `CHI_SIAMO`. */
export async function leggiChiSiamo(): Promise<typeof CHI_SIAMO> {
  const t = await leggiTestiPagine();
  return {
    ...CHI_SIAMO,
    titolo: t["chi-siamo.titolo"],
    sommario: t["chi-siamo.sommario"],
    testi: paragrafiOppure(t["chi-siamo.testi"], CHI_SIAMO.testi),
  };
}

/**
 * I paragrafi di un testo, o quelli del codice se non ne resta nessuno.
 *
 * Il ripiego copre il caso in cui `inParagrafi` scarti tutto quello che ha
 * ricevuto: un valore che `trim()` considera pieno — quindi passa il controllo
 * di `leggiTestiPagine` — ma composto solo di caratteri che la divisione in
 * paragrafi butta via. Non capiterà scrivendo in una casella; capiterà se un
 * giorno qualcuno scrive in tabella a mano.
 *
 * Fra una sezione vuota in mezzo a una pagina e un paragrafo del codice, il
 * secondo: si vede che c'è del testo da correggere, invece di un buco che
 * sembra un guasto.
 */
function paragrafiOppure(testo: string, predefinito: string[]): string[] {
  const p = inParagrafi(testo);
  return p.length > 0 ? p : predefinito;
}

// --------------------------------------------------------------------------
// Scrittura
// --------------------------------------------------------------------------

/**
 * Scrive i campi indicati, in una transazione sola.
 *
 * Un valore uguale al predefinito **cancella la riga** invece di scriverla: è
 * ciò che tiene vera la regola «si conservano solo le differenze», e senza
 * questo passaggio una pagina salvata senza modifiche avrebbe congelato dieci
 * testi del codice in dieci righe di tabella.
 */
export async function salvaTestiPagine(
  valori: Partial<Record<CampoPagina, string>>,
  autore: string,
): Promise<void> {
  try {
    transazione((d) => {
      const quando = adessoIso();
      const autoreId = autore
        ? (d.select({ id: utenti.id }).from(utenti).where(eq(utenti.utente, autore)).get()?.id ??
          null)
        : null;

      const daTogliere: string[] = [];

      for (const [chiave, grezzo] of Object.entries(valori)) {
        const campo = CAMPI_PAGINE.find((c) => c.chiave === chiave);
        // la mappa dei campi è anche il filtro: una chiave che non è nel
        // catalogo non si scrive. Vedi `COLONNA_DI` in `lib/unita-store.ts`.
        if (!campo) continue;

        const valore = (grezzo ?? "").replace(/\r\n?/g, "\n").trim();
        if (valore === "" || valore === predefinitoDi(campo.chiave).trim()) {
          daTogliere.push(campo.chiave);
          continue;
        }

        d.insert(pagineTesti)
          .values({ chiave: campo.chiave, valore, aggiornatoIl: quando, autoreId })
          .onConflictDoUpdate({
            target: pagineTesti.chiave,
            set: { valore, aggiornatoIl: quando, autoreId },
          })
          .run();
      }

      if (daTogliere.length > 0) {
        d.delete(pagineTesti).where(inArray(pagineTesti.chiave, daTogliere)).run();
      }
    });
  } catch (errore) {
    solleva("pagine-store.salvaTestiPagine", errore);
  }
}

/** Quali campi sono personalizzati: la schermata lo dichiara accanto. */
export async function campiPersonalizzati(): Promise<Set<CampoPagina>> {
  const d = dbSeEsiste();
  if (!d) return new Set();
  const salvati = sicuro(d);
  return new Set(
    CAMPI_PAGINE.filter((c) => salvati[c.chiave]?.trim()).map((c) => c.chiave),
  );
}
