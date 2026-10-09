import { notFound, redirect } from "next/navigation";
import { chiaviSezioni, ruoloPerSlug } from "@/lib/data-area";

/**
 * Costruita a ogni richiesta, non salvata in compilazione.
 *
 * È l'unica rotta dell'area riservata che era prerenderizzata, e con la
 * politica di sicurezza a nonce dell'area non poteva restarlo: un nonce è
 * diverso a ogni risposta, e un HTML salvato ne porterebbe uno vecchio — cioè
 * i suoi script verrebbero bloccati dal browser.
 *
 * Non si perde niente, e per questo è sparito anche `generateStaticParams`:
 * questa pagina non rende nulla — legge il ruolo e rimanda alla prima sezione
 * del menu — e con `force-dynamic` quell'elenco non serve più a prerenderizzare
 * niente. Uno slug che non esiste continua a dare 404, perché lo decide
 * `ruoloPerSlug` qui sotto e non l'elenco.
 */
export const dynamic = "force-dynamic";

/** Senza sezione si apre la prima del menu. */
export default async function VistaRuolo({
  params,
}: {
  params: Promise<{ ruolo: string }>;
}) {
  const { ruolo: slug } = await params;
  const ruolo = ruoloPerSlug(slug);
  if (!ruolo) notFound();

  redirect(`/area-riservata/${ruolo.slug}/${chiaviSezioni(ruolo)[0]}`);
}
