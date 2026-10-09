import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import { notFound } from "next/navigation";
import { CorpoUnita } from "@/components/site/CorpoUnita";
import { UNITA } from "@/lib/data";
import { leggiUnita, unitaSalvataPerSlug } from "@/lib/unita-store";

/**
 * Le sei pagine di unità nascono da un unico modello, come già nel generatore
 * statico: qui diventano una sola rotta dinamica prerenderizzata (§04).
 *
 * ## Da dove arrivano i testi, dalla fase 14
 *
 * Da `lib/unita-store.ts`, che è `lib/data.ts` con sopra quello che i referenti hanno
 * cambiato. Il corpo della pagina **non è stato toccato**: lo store restituisce
 * la stessa `Unita` di prima, quindi qui cambia un import e un `await`. Era il
 * punto — si cambia da dove arrivano i dati senza rimettere le mani su un
 * disegno approvato.
 *
 * Gli indirizzi restano quelli del codice: `generateStaticParams` legge `UNITA`
 * e non lo store. Uno slug è un indirizzo pubblico, non un contenuto, e
 * generarlo da una tabella vorrebbe dire che una modifica in area riservata può
 * far sparire una pagina che qualcuno ha condiviso.
 */
export function generateStaticParams() {
  return UNITA.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const u = await unitaSalvataPerSlug(slug);
  if (!u) return {};
  return metadatiPagina(
    u.nome,
    `${u.nome}: ${u.ramoPlurale.toLowerCase()}, ${u.eta}. Lorem ipsum dolor sit amet, consectetur adipiscing.`,
    `/unita/${slug}`,
  );
}

export default async function PaginaUnita({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const u = await unitaSalvataPerSlug(slug);
  if (!u) notFound();

  // per la barra in fondo: i nomi delle altre unità sono contenuto quanto questo
  const tutte = await leggiUnita();

  return <CorpoUnita u={u} tutte={tutte} />;
}
