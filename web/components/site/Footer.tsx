import Link from "next/link";
import { GRUPPO } from "@/lib/data";
import { type Identita, sede } from "@/lib/identita";
import { AREA_RISERVATA, ESTERNI, LINK_LEGALI, SOCIAL } from "@/lib/nav";
import { ASSOCIAZIONE } from "@/lib/legale";
import { IconaSocial } from "./IconaSocial";

/** attributi comuni dei collegamenti che escono dal sito */
const FUORI = { target: "_blank", rel: "noopener" } as const;

/**
 * La colonna «Risorse», nell'ordine del progetto grafico. Nel progetto c'era
 * soltanto Instagram; Facebook gli sta accanto, altrimenti chi lo cerca in
 * questa colonna non lo trova.
 */
const RISORSE = [
  { href: ESTERNI.nazionale, etichetta: "Label" },
  { href: ESTERNI.riviste, etichetta: "Label" },
  { href: ESTERNI.distretto, etichetta: "Label" },
  { href: ESTERNI.instagram, etichetta: "Label" },
  { href: ESTERNI.facebook, etichetta: "Label" },
] as const;

export function Footer({ identita, album }: { identita: Identita; album: boolean }) {
  return (
    <footer className="footer">
      <div className="footer__top">
        <div className="stack gap-14">
          <div className="footer__brand">
            <img
              src={identita.marchio.src}
              width={identita.marchio.larghezza}
              height={identita.marchio.altezza}
              alt="Marchio del gruppo"
            />
            <span>
              <strong>{identita.nome}</strong>
              <span>{identita.sottotitolo}</span>
            </span>
          </div>
          <p className="footer__about">
            {/* Il nome del gruppo e dell'eventuale associazione a cui aderisce. */}
            Lorem ipsum dolor sit amet, consectetur adipiscing elit.{" "}
            {identita.nome}.
          </p>
          {/* Le pastiglie social compaiono solo per i profili che esistono, e
              la fila sparisce se non ne esiste nessuno: tre sigle che portano
              alla schermata d'accesso del servizio non sono i profili del
              gruppo, sono tre vicoli ciechi con un'etichetta invitante. Gli
              indirizzi stanno in `lib/nav.ts`; le icone in `IconaSocial`. */}
          {SOCIAL.length > 0 ? (
            <div className="footer__social">
              {SOCIAL.map(({ href, sigla, nome }) => (
                <a key={sigla} href={href} {...FUORI}>
                  <IconaSocial sigla={sigla} />
                  <span className="visually-hidden"> {nome}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <nav className="footer__col" aria-label="Il gruppo">
          <span className="footer__title">Label</span>
          <Link href="/chi-siamo">Label</Link>
          <Link href="/unita">Label</Link>
          <Link href="/attivita">Label</Link>
          {album ? <Link href="/foto">Label</Link> : null}
          <Link href={AREA_RISERVATA}>Area riservata</Link>
        </nav>

        <nav className="footer__col" aria-label="Trasparenza">
          <span className="footer__title">Label</span>
          <Link href="/documenti">Label</Link>
          {/* Le cartelle di partenza hanno una pagina ciascuna, e non si
              eliminano proprio perché questi due collegamenti vi portano: vedi
              `eDiPartenza` in lib/cartelle-store.ts. Erano due ancore della
              pagina unica, `/documenti#statuti`. */}
          <Link href="/documenti/statuti">Label</Link>
          <Link href="/documenti/quote">Label</Link>
          <Link href="/contatti">Label</Link>
        </nav>

        <nav className="footer__col" aria-label="Risorse">
          <span className="footer__title">Label</span>
          {/* Stessa regola delle pastiglie: si stampano le voci che hanno un
              indirizzo. */}
          {RISORSE.filter((r) => r.href).map((r, i) => (
            <a key={i} href={r.href} {...FUORI}>
              {r.etichetta}
            </a>
          ))}
        </nav>

        <div className="footer__col">
          <span className="footer__title">Label</span>
          {/* la sede è facoltativa: senza indirizzo né città la riga non c'è */}
          {sede(identita) ? (
            <span>
              {identita.indirizzo ? <>Label: {identita.indirizzo}</> : <>Label: {identita.citta}</>}
              {identita.indirizzo && identita.citta ? (
                <>
                  <br />
                  {identita.citta}
                </>
              ) : null}
            </span>
          ) : null}
          <a href={`mailto:${identita.email}`}>{identita.email}</a>
        </div>
      </div>

      <div className="footer__legal">
        <div className="footer__links">
          {LINK_LEGALI.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </div>
        {/* La stessa impostazione dei moduli di tesseramento: gruppo e
            associazione contitolari. Il testo lungo sta in lib/legale.ts. */}
        <p className="footer__gdpr">
          Lorem ipsum {identita.nome} dolor sit amet, {ASSOCIAZIONE.nome}. Consectetur
          adipiscing elit, sed do eiusmod tempor
          {sede(identita) ? ` (${sede(identita)})` : ""} incididunt ut labore ({ASSOCIAZIONE.sede}),
          et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation
          ullamco laboris nisi ut aliquip ex ea commodo consequat:{" "}
          {identita.email}.
        </p>
        <div className="footer__meta">
          <span>
            {/* il codice fiscale compare solo se c'è: finché è vuoto il piede
                scrive il resto, invece di un «C.F.» seguito da niente */}
            © {GRUPPO.annoCopyright} {identita.nome}
            {GRUPPO.codiceFiscale ? ` · C.F. ${GRUPPO.codiceFiscale}` : ""} · Tutti
            i diritti riservati
          </span>
          <span>Label · Label</span>
        </div>
      </div>
    </footer>
  );
}
