"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { StatoAzione } from "@/lib/contenuti";
import {
  DURATA_PREFERENZE_S,
  NOME_COOKIE_PREFERENZE,
  type Preferenze,
  scriviPreferenze,
} from "@/lib/preferenze";
import { indirizzoRichiedente, tokenCorrente } from "@/lib/auth/cookie";
import { chiudiAltrePerUtente, chiudiSessionePerUtente } from "@/lib/auth/sessioni";
import { sessioneCorrente, sessioneVivaCorrente } from "@/lib/sessione-server";
import { trovaUtente, verificaSecondoFattoreLimitato } from "@/lib/utenti";
import { confermaAutenticatore, generaCodiciRecupero, preparaAutenticatore } from "@/lib/auth/profilo-sicurezza";
import { qrSvg } from "@/lib/auth/qr";
import { uriOtpauth } from "@/lib/auth/totp";
import { attesa, azzera, segnaFallimento } from "@/lib/auth/tentativi";
import { registra } from "@/lib/registro-store";
import type { StatoSicurezzaProfilo } from "@/lib/profilo";

/** Preferenze, sessioni e secondo fattore del proprio account. */

const NEGATO: StatoAzione = { stato: "errore", messaggio: "Sessione scaduta: rientrate." };

const testo = (f: FormData, nome: string) => String(f.get(nome) ?? "");

export async function salvaPreferenze(
  _precedente: StatoAzione,
  formData: FormData,
): Promise<StatoAzione> {
  if (!(await sessioneCorrente())) return NEGATO;

  const tema = testo(formData, "tema");
  const p: Preferenze = {
    tema: tema === "chiaro" || tema === "scuro" ? tema : "sistema",
    densita: testo(formData, "densita") === "compatta" ? "compatta" : "comoda",
    testo: testo(formData, "testo") === "grande" ? "grande" : "normale",
    fermo: formData.get("fermo") !== null,
  };

  const barattolo = await cookies();
  barattolo.set(NOME_COOKIE_PREFERENZE, scriviPreferenze(p), {
    // niente httpOnly: non è un segreto, ed è comodo poterlo ispezionare
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/area-riservata",
    maxAge: DURATA_PREFERENZE_S,
  });

  revalidatePath("/area-riservata", "layout");
  return { stato: "fatto", messaggio: "Preferenze salvate per questo browser." };
}

export async function azzeraPreferenze(
  _precedente: StatoAzione,
  _formData: FormData,
): Promise<StatoAzione> {
  if (!(await sessioneCorrente())) return NEGATO;
  const barattolo = await cookies();
  barattolo.delete({ name: NOME_COOKIE_PREFERENZE, path: "/area-riservata" });
  revalidatePath("/area-riservata", "layout");
  return { stato: "fatto", messaggio: "Rimesse le impostazioni predefinite." };
}


export async function esciDagliAltriDispositivi(_precedente: StatoAzione, _formData: FormData): Promise<StatoAzione> {
  const sessione = await sessioneCorrente();
  const token = await tokenCorrente();
  const u = sessione && trovaUtente(sessione.u);
  if (!sessione || !u || !token) return NEGATO;
  const chiuse = chiudiAltrePerUtente(u.id, token);
  await registra(sessione, "configurazione", `Chiusi gli altri accessi (${chiuse})`, "profilo");
  revalidatePath("/area-riservata/profilo");
  return { stato: "fatto", messaggio: chiuse ? "Gli altri accessi sono stati chiusi." : "Non ci sono altri accessi aperti." };
}

export async function chiudiAccesso(_precedente: StatoAzione, formData: FormData): Promise<StatoAzione> {
  const sessione = await sessioneCorrente();
  const token = await tokenCorrente();
  const u = sessione && trovaUtente(sessione.u);
  if (!sessione || !u || !token) return NEGATO;
  const id = Number(testo(formData, "id"));
  if (!Number.isSafeInteger(id) || id <= 0) return { stato: "errore", messaggio: "Accesso non riconosciuto." };
  const chiusa = chiudiSessionePerUtente(u.id, id, token);
  if (chiusa) await registra(sessione, "configurazione", "Chiuso un altro accesso", "profilo");
  revalidatePath("/area-riservata/profilo");
  return { stato: chiusa ? "fatto" : "errore", messaggio: chiusa ? "Accesso chiuso." : "Questo accesso non è disponibile." };
}

/** Una sessione già aperta non basta per cambiare il secondo fattore. */
async function verificaProfilo(formData: FormData) {
  const viva = await sessioneVivaCorrente();
  if (!viva || viva.stato !== "attiva" || viva.daCambiare) return { errore: NEGATO };
  const ip = await indirizzoRichiedente();
  const esito = verificaSecondoFattoreLimitato(viva.utenteId, ip, testo(formData, "codice"));
  if (esito.esito !== "ok") return { errore: { stato: "errore" as const, messaggio: esito.esito === "bloccato" ? `Troppi tentativi. Riprovate fra ${esito.minuti} minuti.` : "Codice non valido: usate un nuovo codice del telefono o un codice di recupero." } };
  return { viva };
}

export async function creaCodiciRecupero(_precedente: StatoSicurezzaProfilo, formData: FormData): Promise<StatoSicurezzaProfilo> {
  const c = await verificaProfilo(formData);
  if (c.errore) return c.errore;
  const codici = generaCodiciRecupero(c.viva.utenteId, c.viva.id);
  if (!codici) return NEGATO;
  await registra(c.viva.sessione, "configurazione", "Generati nuovi codici di recupero del secondo fattore", "profilo");
  revalidatePath("/area-riservata/profilo");
  return { stato: "fatto", messaggio: "Conservate questi codici in un luogo sicuro. Compaiono una volta sola; quelli precedenti sono annullati.", codici };
}

export async function cambiaAutenticatore(_precedente: StatoSicurezzaProfilo, formData: FormData): Promise<StatoSicurezzaProfilo> {
  const c = await verificaProfilo(formData);
  if (c.errore) return c.errore;
  const segreto = preparaAutenticatore(c.viva.utenteId, c.viva.id);
  if (!segreto) return NEGATO;
  return { stato: "fatto", messaggio: "Inquadrate il QR con il nuovo telefono e confermate un codice entro cinque minuti. Il vecchio autenticatore resta valido fino alla conferma.", segreto, qr: qrSvg(uriOtpauth(segreto, c.viva.sessione.u)) };
}

export async function confermaNuovoAutenticatore(_precedente: StatoSicurezzaProfilo, formData: FormData): Promise<StatoSicurezzaProfilo> {
  const viva = await sessioneVivaCorrente();
  if (!viva || viva.stato !== "attiva" || viva.daCambiare) return NEGATO;
  const ip = await indirizzoRichiedente();
  const minuti = attesa(viva.sessione.u, ip);
  if (minuti !== null) return { stato: "errore", messaggio: `Troppi tentativi. Riprovate fra ${minuti} minuti.` };
  const codici = confermaAutenticatore(viva.utenteId, viva.id, testo(formData, "codice"));
  if (!codici) {
    segnaFallimento(viva.sessione.u, ip);
    return { stato: "errore", messaggio: "Codice non valido o configurazione scaduta. Riprovate oppure ricominciate." };
  }
  azzera(viva.sessione.u);
  await registra(viva.sessione, "configurazione", "Sostituito l’autenticatore e chiusi gli altri accessi", "profilo");
  revalidatePath("/area-riservata/profilo");
  return { stato: "fatto", messaggio: "Nuovo autenticatore attivo. Gli altri accessi sono chiusi e i vecchi codici di recupero annullati. Conservate i nuovi codici qui sotto.", codici };
}
