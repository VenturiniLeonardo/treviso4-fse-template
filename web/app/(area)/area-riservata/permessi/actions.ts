"use server";

import { revalidatePath } from "next/cache";
import { type StatoAzione } from "@/lib/contenuti";
import { ammesso, type Livello, LIVELLI, RIGHE_FISSE, RUOLI_MATRICE, tetto } from "@/lib/permessi";
import {
  impostaLivello,
  ripristinaMatrice,
  togliFunzione,
} from "@/lib/permessi-store";
import { registra } from "@/lib/registro-store";
import { ErroreDatabase } from "@/lib/db/errori";
import { contesto, esitoNegato, Negato } from "@/lib/auth/contesto";
import { type Sessione } from "@/lib/sessione";

/**
 * La matrice dei permessi la tocca solo l'admin.
 *
 * È l'unico caso in cui il controllo non è «chi vede può scrivere»: qui si
 * descrive chi può fare che cosa, e lasciarla modificare a un gestore
 * vorrebbe dire lasciargli riscrivere le regole che lo riguardano.
 */

/** Autorizzazione distinta dalla gestione degli account. */
const AZIONE = "permessi" as const;

async function soloAdmin(): Promise<
  { ok: true; sessione: Sessione } | { ok: false; esito: StatoAzione }
> {
  let ctx;
  try {
    ctx = await contesto(AZIONE);
  } catch (errore) {
    if (errore instanceof Negato) return { ok: false, esito: esitoNegato(errore) };
    throw errore;
  }
  if (ctx.livello !== "completo") {
    await registra(
      ctx.sessione,
      "configurazione",
      "Rifiutata la modifica della matrice dei permessi — serve «permessi» completo",
      "permessi",
      "rifiutato",
    );
    return { ok: false, esito: esitoNegato(new Negato("ruolo", "permessi")) };
  }
  return { ok: true, sessione: ctx.sessione };
}

/**
 * Esegue una chiamata allo store traducendo un guasto del database in un esito
 * per il form.
 *
 * Serve da quando lo store sta su SQLite: prima un errore di scrittura risaliva
 * come eccezione non gestita e Next mostrava una pagina d'errore. Ora l'utente
 * vede una frase comprensibile e un codice da riferire — §11 e §19 del piano.
 *
 * Rilancia tutto ciò che non è un `ErroreDatabase`: `redirect` e `notFound` di
 * Next funzionano lanciando, e intercettarli qui li romperebbe.
 */
async function prova<T>(
  azione: () => Promise<T>,
): Promise<{ ok: true; valore: T } | { ok: false; esito: StatoAzione }> {
  try {
    return { ok: true, valore: await azione() };
  } catch (errore) {
    if (errore instanceof ErroreDatabase) {
      return {
        ok: false,
        esito: { stato: "errore", messaggio: errore.message, codice: errore.codice },
      };
    }
    throw errore;
  }
}



const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

function aggiorna() {
  revalidatePath("/area-riservata/sviluppatore/permessi");
}

export async function cambiaLivello(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const g = await soloAdmin();
  if (!g.ok) return g.esito;
  const sessione = g.sessione;

  const id = testo(formData, "id");
  const ruolo = testo(formData, "ruolo");
  const livello = testo(formData, "livello") as Livello;

  if (!RUOLI_MATRICE.some((r) => r.chiave === ruolo)) {
    return { stato: "errore", messaggio: "Ruolo non riconosciuto." };
  }
  if (!LIVELLI.some((l) => l.valore === livello)) {
    return { stato: "errore", messaggio: "Livello non riconosciuto." };
  }

  /*
   * I tetti (`tetto()` in `lib/permessi.ts`, audit degli accessi M-5): ci sono
   * cose che la matrice non può concedere a un ruolo, qualunque clic arrivi. La
   * schermata non offre quei valori; questo è il controllo vero, per chi manda
   * la richiesta a mano. Anche il rifiuto finisce nel registro.
   */
  if (!ammesso(id, ruolo, livello)) {
    const motivo = RIGHE_FISSE[id]?.perche ?? tetto(id, ruolo).perche ?? "";
    await registra(
      sessione,
      "permessi",
      `Rifiutato «${id}» per ${ruolo} → ${livello}: oltre il tetto del ruolo`,
      "permessi",
      "rifiutato",
    );
    return { stato: "errore", messaggio: `Non si può: ${motivo}` };
  }

  const r = await prova(() => impostaLivello(id, ruolo, livello));
  if (!r.ok) return r.esito;
  const fatto = r.valore;
  aggiorna();
  if (fatto) {
    await registra(sessione, "permessi", `«${id}» per ${ruolo} → ${livello}`, "permessi");
  }
  return fatto
    ? { stato: "fatto", messaggio: "Livello aggiornato." }
    : { stato: "errore", messaggio: "Questa funzione non esiste più." };
}

export async function rimuoviFunzione(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  const g = await soloAdmin();
  if (!g.ok) return g.esito;
  const sessione = g.sessione;
  if (RIGHE_FISSE[testo(formData, "id")]) return { stato: "errore", messaggio: "Questa autorizzazione è protetta e non può essere rimossa." };
  const r = await prova(() => togliFunzione(testo(formData, "id")));
  if (!r.ok) return r.esito;
  const fatto = r.valore;
  aggiorna();
  if (fatto) {
    await registra(sessione, "permessi", `Tolta la funzione «${testo(formData, "id")}»`, "permessi");
  }
  return fatto
    ? { stato: "fatto", messaggio: "Funzione tolta dalla matrice." }
    : { stato: "errore", messaggio: "Questa funzione non esiste più." };
}

export async function ripristina(
  _precedente: StatoAzione,
  _formData: FormData,
): Promise<StatoAzione> {
  const g = await soloAdmin();
  if (!g.ok) return g.esito;
  const sessione = g.sessione;
  const r = await prova(() => ripristinaMatrice());
  if (!r.ok) return r.esito;
  aggiorna();
  await registra(sessione, "permessi", "Matrice riportata ai valori del codice", "permessi");
  return {
    stato: "fatto",
    messaggio: "Matrice riportata a quello che il codice applica davvero oggi.",
  };
}
