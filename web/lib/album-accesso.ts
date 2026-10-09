import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { cifra, decifra } from "@/lib/auth/cifratura";
import { dbSeEsiste, transazione } from "@/lib/db/db";
import { solleva } from "@/lib/db/errori";
import { album as tabella } from "@/lib/db/schema";

/**
 * La serratura degli album: chi ha la password vede le fotografie.
 *
 * ## Che cosa è protetto e che cosa no
 *
 * Titolo, data e unità di un album pubblicato restano pubblici — nella pagina
 * Foto, nella ricerca, nella sitemap — perché sono l'indice con cui una
 * famiglia trova l'album di cui le hanno dato la password. Le **fotografie**
 * no, copertina compresa: la pagina dell'album mostra il modulo invece della
 * griglia, e `/foto-file/[file]` risponde 404 senza il cookie. La seconda è la
 * serratura vera: la pagina si potrebbe saltare conoscendo il nome di un file.
 *
 * ## Il cookie
 *
 * Uno per album, `sito_album_<id>`, con dentro l'impronta di
 * `accesso_versione` — un valore casuale che cambia a ogni cambio di password.
 * Quindi:
 *
 *  - non si fabbrica: `accesso_versione` non esce mai dal server;
 *  - non si prova a indovinare fuori linea: non deriva dalla password, quindi
 *    avere un cookie non aiuta a ricostruirla, e non averlo non permette di
 *    provare password senza passare dal limite di tentativi;
 *  - cambiare la password chiude l'album a tutti quelli che l'avevano aperto,
 *    senza un elenco di sessioni da ripulire.
 *
 * Dura trenta giorni: una famiglia apre l'album del campo nelle settimane dopo,
 * non ogni sera, e ridigitare la password a ogni visita non protegge di più.
 */

export const DURATA_COOKIE_ALBUM_S = 30 * 24 * 60 * 60;
const DOMINIO = "sito/album/v1";

export function nomeCookieAlbum(id: number): string {
  return `sito_album_${id}`;
}

function gettone(id: number, versione: string): string {
  return createHash("sha256").update(`${DOMINIO}:${id}:${versione}`).digest("base64url");
}

function stessi(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface SerraturaAlbum {
  id: number;
  /** nulla finché nessuno ha impostato una password: l'album resta chiuso */
  versione: string | null;
}

/** La serratura di un album dal suo indirizzo, o `null` se l'album non c'è. */
export function serraturaPerIndirizzo(slug: string): SerraturaAlbum | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const r = d
      .select({ id: tabella.id, versione: tabella.accessoVersione, password: tabella.passwordAccesso })
      .from(tabella)
      .where(eq(tabella.slug, slug))
      .get();
    if (!r) return null;
    return { id: r.id, versione: r.password ? r.versione : null };
  } catch (errore) {
    solleva("album-accesso.serraturaPerIndirizzo", errore);
  }
}

/**
 * La serratura di un album **pubblicato**, o `null` per tutti gli altri.
 *
 * È quella del modulo pubblico della password. `serraturaPerIndirizzo` non
 * guarda lo stato, e al modulo bastava rispondere «password non corretta» per
 * una bozza e «non esiste più» per un indirizzo inventato perché chiunque
 * potesse sapere quali album sono in preparazione — e se hanno già una
 * password —, mentre la pagina dello stesso album risponde 404 (audit del 7
 * ottobre, SEC-AUTH-001). Per il pubblico un album non pubblicato non esiste.
 */
export function serraturaPubblica(slug: string): SerraturaAlbum | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const r = d
      .select({ id: tabella.id, versione: tabella.accessoVersione, password: tabella.passwordAccesso })
      .from(tabella)
      .where(and(eq(tabella.slug, slug), eq(tabella.stato, "pubblicato")))
      .get();
    if (!r) return null;
    return { id: r.id, versione: r.password ? r.versione : null };
  } catch (errore) {
    solleva("album-accesso.serraturaPubblica", errore);
  }
}

/** Il valore di un cookie apre questa serratura? */
export function cookieValido(s: SerraturaAlbum, valore: string | undefined): boolean {
  if (!s.versione || valore === undefined) return false;
  return stessi(valore, gettone(s.id, s.versione));
}

/**
 * Prova una password. Se è giusta restituisce nome e valore del cookie da
 * scrivere, altrimenti `null`. Il cookie lo scrive `lib/album-cookie.ts`, che
 * è la sola metà che ha bisogno di `next/headers`: questa si prova fuori da Next.
 *
 * Il confronto è a tempo costante sul testo in chiaro, che si ottiene
 * decifrando: la password è un segreto condiviso e non un'impronta, vedi il
 * commento sulla colonna in `lib/db/schema.ts`. Il limite di tentativi sta in
 * chi chiama, perché dipende dall'indirizzo della richiesta.
 */
export function provaPassword(
  slug: string,
  tentativo: string,
): { nome: string; valore: string } | null {
  const d = dbSeEsiste();
  if (!d) return null;

  let riga: { id: number; password: string | null; versione: string | null } | undefined;
  try {
    riga = d
      .select({ id: tabella.id, password: tabella.passwordAccesso, versione: tabella.accessoVersione })
      .from(tabella)
      .where(eq(tabella.slug, slug))
      .get();
  } catch (errore) {
    solleva("album-accesso.provaPassword", errore);
  }
  if (!riga?.password || !riga.versione) return null;

  // L'impronta di tutte e due, e non il confronto diretto: `timingSafeEqual`
  // vuole lunghezze uguali, e rifiutare prima una lunghezza diversa direbbe a
  // chi prova quanto è lunga la password giusta.
  const giusta = createHash("sha256").update(decifra(riga.password)).digest();
  const provata = createHash("sha256").update(tentativo).digest();
  if (!timingSafeEqual(giusta, provata)) return null;

  return { nome: nomeCookieAlbum(riga.id), valore: gettone(riga.id, riga.versione) };
}

/**
 * Imposta (o cambia) la password di un album. `false` se l'album non c'è.
 *
 * Una versione nuova a ogni chiamata, anche se la password è la stessa di
 * prima: «imposta di nuovo» è anche il modo di chiudere l'album a chi l'aveva
 * già aperto, per esempio dopo che la password è finita in un gruppo sbagliato.
 */
export function impostaPasswordAlbum(slug: string, password: string): boolean {
  try {
    return transazione(
      (d) =>
        d
          .update(tabella)
          .set({ passwordAccesso: cifra(password), accessoVersione: randomBytes(18).toString("base64url") })
          .where(eq(tabella.slug, slug))
          .run().changes > 0,
    );
  } catch (errore) {
    solleva("album-accesso.impostaPasswordAlbum", errore);
  }
}

/**
 * La password in chiaro, per mostrarla ai referenti che gestiscono l'album.
 *
 * Solo per l'area riservata, dopo il controllo di ambito: chi chiama deve aver
 * già verificato che la sessione possa scrivere su quest'album.
 */
export function passwordDellAlbum(slug: string): string | null {
  const d = dbSeEsiste();
  if (!d) return null;
  try {
    const r = d
      .select({ password: tabella.passwordAccesso })
      .from(tabella)
      .where(eq(tabella.slug, slug))
      .get();
    return r?.password ? decifra(r.password) : null;
  } catch (errore) {
    solleva("album-accesso.passwordDellAlbum", errore);
  }
}

/**
 * Gli indirizzi degli album che **hanno** una password.
 *
 * Al contrario di quanto servirebbe all'elenco, di proposito: un album ancora
 * soltanto nel seme di `lib/data.ts` non ha una riga in tabella, e un elenco
 * «senza password» letto dal database lo lascerebbe fuori. Chi chiama fa il
 * complemento sugli album che mostra.
 */
export function albumConPassword(): Set<string> {
  const d = dbSeEsiste();
  if (!d) return new Set();
  try {
    return new Set(
      d
        .select({ slug: tabella.slug })
        .from(tabella)
        .where(isNotNull(tabella.passwordAccesso))
        .all()
        .map((r) => r.slug),
    );
  } catch (errore) {
    solleva("album-accesso.albumConPassword", errore);
  }
}
