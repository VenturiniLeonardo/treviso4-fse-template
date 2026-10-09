import { cookies } from "next/headers";
import {
  cookieValido,
  DURATA_COOKIE_ALBUM_S,
  nomeCookieAlbum,
  provaPassword,
  type SerraturaAlbum,
} from "@/lib/album-accesso";

/**
 * La metà della serratura degli album che legge e scrive i cookie. Il perché
 * del cookie — che cosa contiene e perché non si fabbrica — sta in
 * `lib/album-accesso.ts`.
 */

/** Il browser di questa richiesta ha già aperto l'album? */
export async function haAperto(s: SerraturaAlbum): Promise<boolean> {
  return cookieValido(s, (await cookies()).get(nomeCookieAlbum(s.id))?.value);
}

/** Prova la password e, se è giusta, lascia il cookie. */
export async function apriConPassword(slug: string, tentativo: string): Promise<boolean> {
  const cookie = provaPassword(slug, tentativo);
  if (!cookie) return false;
  (await cookies()).set(cookie.nome, cookie.valore, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURATA_COOKIE_ALBUM_S,
  });
  return true;
}
