import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { PaginaTesto } from "@/components/site/PaginaTesto";
import { AGGIORNAMENTO, legaleApprovato, legaleMancante, SLUG_LEGALI } from "@/lib/legale";
import { NOME_COOKIE } from "@/lib/sessione";
import { NOME_COOKIE_PREFERENZE } from "@/lib/preferenze";
import { moduloContattiAttivo } from "@/lib/modulo-contatti";
import { dimenticaSessione } from "./actions";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.",
  "/legale/preferenze-cookie",
);

/**
 * Pannello delle preferenze cookie. I testi descrittivi sono segnaposto; il
 * comando resta vero: cancella il cookie di sessione dell'area riservata, che
 * essendo HttpOnly va cancellato dal server.
 *
 * Non prova a dire se quel cookie c'è. Ha `path=/` (vedi `PERCORSO_COOKIE`), quindi
 * arriva anche qui, ma una pagina pubblica che legge la sessione smette di essere
 * statica per tutti; e il pulsante funziona comunque, che il cookie ci sia o no.
 *
 * L'elenco deve restare allineato con la cookie policy in `lib/legale.ts`: un
 * cookie nuovo va dichiarato in tutte e due.
 */

interface Categoria {
  nome: string;
  /**
   * `area` è la categoria che esiste ma non tocca i visitatori: la scrive solo
   * una scelta di un referente dentro l'area riservata. Metterla fra le «assenti»
   * sarebbe falso, metterla fra le «sempre attive» farebbe credere che arrivi a
   * tutti.
   */
  stato: "attiva" | "assente" | "area";
  testo: string;
}

const LOREM_CATEGORIA =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor " +
  "incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis " +
  "nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";

const CATEGORIE: Categoria[] = [
  { nome: "Label", stato: "attiva", testo: LOREM_CATEGORIA },
  { nome: "Label", stato: "area", testo: LOREM_CATEGORIA },
  { nome: "Label", stato: "assente", testo: LOREM_CATEGORIA },
  { nome: "Label", stato: "assente", testo: LOREM_CATEGORIA },
];

export default async function PreferenzeCookie({
  searchParams,
}: {
  searchParams: Promise<{ fatto?: string }>;
}) {
  const fatto = (await searchParams).fatto === "1";

  return (
    <PaginaTesto
      crumbs={[{ label: "Home", href: "/" }, { label: "Label" }]}
      titolo="Label"
      sommario={
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod " +
        "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam."
      }
      aggiornamento={AGGIORNAMENTO}
      // lo stesso riquadro delle altre pagine legali, per la stessa ragione
      avviso={
        legaleApprovato() ? undefined : (
          <>
            <strong>Label.</strong> Lorem ipsum dolor sit amet, consectetur adipiscing
            elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua:{" "}
            {legaleMancante().join(", ")}.
          </>
        )
      }
    >
      <section className="stack gap-14" aria-label="Label">
        <div className="section-rule">
          <span className="eyebrow">
            Label
          </span>
          <span className="section-rule__line" aria-hidden="true"></span>
        </div>

        <div className="prefs">
          {CATEGORIE.map((c, i) => {
            return (
              <div className="prefs__row" key={i}>
                <div className="stack gap-8" style={{ flex: 1, minWidth: 0 }}>
                  <span className="prefs__name">{c.nome}</span>
                  <p className="prefs__text">{c.testo}</p>
                </div>
                <span
                  className={
                    c.stato === "assente" ? "prefs__state" : "prefs__state prefs__state--on"
                  }
                >
                  {c.stato === "attiva"
                    ? "Label"
                    : c.stato === "area"
                      ? "Label"
                      : "Label"}
                </span>
              </div>
            );
          })}
        </div>

        <p className="tiny-note">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
          incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
          nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
          fugiat nulla pariatur.
        </p>
      </section>

      <section className="stack gap-14" aria-label="Label">
        <div className="section-rule">
          <span className="eyebrow">
            Label
          </span>
          <span className="section-rule__line" aria-hidden="true"></span>
        </div>

        <dl className="deflist">
          <div className="deflist__row">
            <dt>
              <code>{NOME_COOKIE}</code>
            </dt>
            <dd>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
              tempor incididunt ut labore et dolore magna aliqua.
            </dd>
          </div>
          <div className="deflist__row">
            <dt>
              <code>{NOME_COOKIE_PREFERENZE}</code>
            </dt>
            <dd>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </dd>
          </div>
          <div className="deflist__row">
            <dt>
              <code>Label</code>
            </dt>
            <dd>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </dd>
          </div>
          <div className="deflist__row">
            <dt>
              <code>Label</code>
            </dt>
            <dd>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </dd>
          </div>
          <div className="deflist__row">
            <dt>
              <code>Label</code>
            </dt>
            <dd>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </dd>
          </div>
        </dl>

        {fatto ? (
          <p className="callout" role="status">
            <strong>Label.</strong> Lorem ipsum dolor sit amet, consectetur adipiscing
            elit, sed do eiusmod tempor incididunt ut labore.
          </p>
        ) : null}

        {/*
         * Nella copia statica (SITO_MODULO_CONTATTI=0, vedi
         * lib/modulo-contatti.ts) il pulsante non c'è: è un'azione del server, e
         * lì il server non c'è — premuto, manderebbe la richiesta a nessuno. Non
         * c'è nemmeno il cookie da cancellare, perché su quel dominio l'area
         * riservata non esiste.
         */}
        {moduloContattiAttivo() ? (
          <form action={dimenticaSessione} className="stack gap-10">
            <p className="note">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
              tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.
            </p>
            <button className="btn btn--primary" type="submit" style={{ alignSelf: "flex-start" }}>
              Label
            </button>
          </form>
        ) : null}

        <p className="tiny-note">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
          incididunt ut labore.
        </p>
      </section>

      <nav className="legal-nav" aria-label="Label">
        {SLUG_LEGALI.map((a) => (
          <Link key={a.slug} href={`/legale/${a.slug}`}>
            {a.breve}
          </Link>
        ))}
      </nav>
    </PaginaTesto>
  );
}
