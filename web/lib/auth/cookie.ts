import { cookies, headers } from "next/headers";
import { ipDaCatena } from "@/lib/auth/indirizzo";
import { NOME_COOKIE, PERCORSO_COOKIE } from "@/lib/sessione";

/**
 * Il cookie di sessione, scritto e cancellato in un posto solo.
 *
 * Le opzioni devono coincidere fra scrittura e cancellazione — soprattutto
 * `path` — o il `delete` non cancella niente e l'uscita lascia il cookie
 * addosso. È già successo. Tenerle qui è il modo di non farlo succedere di
 * nuovo.
 *
 * `httpOnly` perché il token è una credenziale e il JavaScript della pagina non
 * ha alcun motivo di leggerla; `sameSite: lax` perché una Server Action arriva
 * per POST dalla stessa origine, e `strict` romperebbe il ritorno da un
 * collegamento esterno; `secure` fuori dallo sviluppo, dove non c'è HTTPS.
 */
export async function scriviCookieSessione(token: string, durataS: number): Promise<void> {
  const barattolo = await cookies();
  barattolo.set(NOME_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PERCORSO_COOKIE,
    maxAge: durataS,
  });
}

export async function cancellaCookieSessione(): Promise<void> {
  const barattolo = await cookies();
  barattolo.delete({ name: NOME_COOKIE, path: PERCORSO_COOKIE });
}

/** Il token della richiesta corrente, se c'è. */
export async function tokenCorrente(): Promise<string | undefined> {
  return (await cookies()).get(NOME_COOKIE)?.value;
}

/**
 * L'indirizzo da cui arriva la richiesta, per il conteggio dei tentativi.
 *
 * La difesa dallo spoofing di `X-Forwarded-For` sta in `lib/auth/indirizzo.ts`:
 * si prende l'elemento fidato dall'estremo destro della catena, non il primo a
 * sinistra scelto dal client. Non dipende più dal fatto che il proxy sovrascriva
 * l'intestazione — vale anche dietro un proxy che la accoda.
 */
export async function indirizzoRichiedente(): Promise<string> {
  const intestazioni = await headers();
  return ipDaCatena(intestazioni.get("x-forwarded-for"));
}
