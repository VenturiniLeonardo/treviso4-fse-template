"use server";

import { redirect } from "next/navigation";
import { cancellaCookieSessione, tokenCorrente } from "@/lib/auth/cookie";
import { chiudi } from "@/lib/auth/sessioni";

/**
 * Chiude la sessione dell'area riservata e ne cancella il cookie.
 *
 * È l'unico comando che questa pagina può davvero offrire: gli altri cookie non
 * esistono, e questo è HttpOnly, quindi il browser non lo fa cancellare dal
 * codice della pagina. Deve passare dal server, ed è esattamente quello che fa
 * anche «esci» dall'area riservata.
 *
 * E come «esci» chiude anche la **riga** nel database, non solo il cookie.
 * Prima cancellava soltanto il cookie: chi premeva il pulsante credendo di
 * uscire lasciava la sessione valida lato server fino alla scadenza, per
 * chiunque ne avesse il token (audit di sicurezza, AUTH-02). Il cookie ha
 * `Path=/` dalla fase 6, quindi arriva anche a questa pagina pubblica; se non
 * c'è, `chiudi` non fa niente. Il pulsante resta sempre disponibile e la
 * pagina non finge di leggere lo stato del browser.
 */
export async function dimenticaSessione() {
  chiudi(await tokenCorrente());
  await cancellaCookieSessione();
  redirect("/legale/preferenze-cookie?fatto=1");
}
