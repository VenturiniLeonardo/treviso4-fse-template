import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { Crumbs } from "@/components/site/Crumbs";
import { ModuloContatti } from "@/components/site/ModuloContatti";
import { fascia, CHI_SIAMO, INTRO, nomeReferente } from "@/lib/data";
import { COLORI_FAQ } from "@/lib/faq-contenuti";
import { leggiFaq } from "@/lib/faq-store";
import { leggiUnita } from "@/lib/unita-store";
import { leggiIdentita } from "@/lib/gruppo";
import { moduloContattiAttivo } from "@/lib/modulo-contatti";
import { sede, tel } from "@/lib/identita";
import { SOCIAL } from "@/lib/nav";
import { IconaSocial } from "@/components/site/IconaSocial";

/**
 * La sede su Google Maps: la **scheda del gruppo**, non una ricerca.
 *
 * È lì che stanno le indicazioni stradali e gli orari, ed è la pagina che i
 * referenti possono aggiornare da soli.
 *
 * Nel riquadro accanto, invece, c'è un'immagine costruita da noi con dati
 * OpenStreetMap (`scripts/mappa-sede.mjs`), e non un riquadro di Google.
 * Non è una preferenza: **incorporare Google Maps richiede oggi una chiave
 * API**. Tutte le forme senza chiave (`output=embed`) rispondono con
 * `X-Frame-Options: SAMEORIGIN` e il browser si rifiuta di mostrarle; l'Embed
 * API ufficiale risponde 401. Verificato.
 *
 * Se un domani arriva una chiave, qui si sostituisce l'immagine con un
 * `<iframe src="https://www.google.com/maps/embed/v1/place?key=…&q=…">` — e
 * vanno riscritte la cookie policy e il pannello «Preferenze cookie», perché
 * da quel momento ogni visita a questa pagina manda l'IP del visitatore a
 * Google.
 */
const MAPPA_SCHEDA = "https://maps.app.goo.gl/jpB7peuGvT44HNkJ6";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod " +
    "tempor incididunt ut labore.",
  "/contatti",
);

export default async function Contatti() {
  const g = await leggiIdentita();
  // referenti, recapiti e nomi delle unità: dallo store, non dal codice
  const unita = await leggiUnita();
  const domande = await leggiFaq();
  /*
   * Il modulo, se c'è un server che lo riceve.
   *
   * Si decide **in compilazione**, non a ogni richiesta: questa pagina è
   * prerenderizzata. Vedi `lib/modulo-contatti.ts` — c'è scritto anche perché
   * togliere il modulo dall'HTML dopo non funziona.
   */
  const conModulo = moduloContattiAttivo();

  return (
    <main id="contenuto">
      <div className="wrap section--tight split split--contatti">
        <div className="stack gap-14">
          <Crumbs items={[{ label: "Home", href: "/" }, { label: "Label" }]} />
          <h1 className="h1">Label</h1>
          <p className="lead" style={{ maxWidth: "560px" }}>
            {INTRO.contatti}
          </p>
          <div className="rows" style={{ marginTop: "10px" }}>
            {sede(g) ? (
              <div className="rows__row">
                <span className="rows__key">Label</span>
                <span className="rows__val">{sede(g)}</span>
              </div>
            ) : null}
            <div className="rows__row">
              <span className="rows__key">Label</span>
              {/* `rows__val` invece dello stesso stile ricopiato in linea:
                  erano gli identici 16,5 px e 600 di peso che la classe già
                  dichiara, e ricopiarli qui voleva dire che il collegamento
                  non prendeva nient'altro di quella classe — compreso, da
                  oggi, l'allineamento a destra. */}
              <a href={`mailto:${g.email}`} className="rows__val">
                {g.email}
              </a>
            </div>
            {/* I profili del gruppo, con il nome che si cerca nell'app e non
                l'indirizzo: stessi dati e stessa regola del piede, quindi un
                profilo senza indirizzo in `lib/nav.ts` non ha la sua riga. L'icona
                accompagna il nome, non lo sostituisce. */}
            {SOCIAL.map((s) => (
              <div key={s.sigla} className="rows__row">
                <span className="rows__key rows__key--icona">
                  <IconaSocial sigla={s.sigla} misura={16} />
                  {s.nome}
                </span>
                <a href={s.href} className="rows__val" target="_blank" rel="noopener">
                  {s.profilo}
                </a>
              </div>
            ))}
          </div>
        </div>
        <div className="map">
          <img
            className="map__foto"
            src="/assets/mappa-sede-1200.webp"
            srcSet="/assets/mappa-sede-560.webp 560w, /assets/mappa-sede-800.webp 800w, /assets/mappa-sede-1200.webp 1200w"
            sizes="(max-width: 980px) 100vw, 530px"
            width={1200}
            height={800}
            loading="lazy"
            decoding="async"
            alt="Mappa della sede del gruppo"
          />
          <a className="btn btn--primary" href={MAPPA_SCHEDA} target="_blank" rel="noopener">
            Apri in Google Maps
          </a>
        </div>
      </div>

      <section className="wrap section stack gap-22" aria-labelledby="titolo-referenti">
        <div className="stack gap-12" style={{ maxWidth: "700px" }}>
          <span className="eyebrow">Label</span>
          <h2 id="titolo-referenti" className="h2 h2--sm">
            Label
          </h2>
          <p className="note" style={{ fontSize: "17.5px" }}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            nostrud exercitation.
          </p>
        </div>
        <div className="grid grid--2" style={{ gap: "16px" }}>
          {unita.map((u) => {
            const col = fascia(u.fascia);
            return (
              <div key={u.slug} className="leader" style={{ borderLeftColor: col.colore }}>
                <img
                  src={`/assets/${u.logo}`}
                  width={240}
                  height={240}
                  alt=""
                />
                <div className="leader__main">
                  <span className="leader__unit" style={{ color: col.accento }}>
                    {u.nome} · {u.ramoPlurale}
                  </span>
                  {/* Senza il nome del referente la scheda mostrava uno spazio vuoto
                      con sotto «Referente di unità»: un ruolo senza nome non è
                      un'informazione, è una scheda rotta. La stessa frase e lo
                      stesso tono di Chi siamo, per non dire la stessa cosa in
                      due modi. */}
                  {u.referente ? (
                    <>
                      <span className="leader__name">{nomeReferente(u.referente)}</span>
                      <span className="leader__role">{u.ruoloReferente}</span>
                    </>
                  ) : (
                    <span className="leader__role">
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed.
                    </span>
                  )}
                </div>
                <div className="leader__contacts">
                  {/* il telefono dell'unità è facoltativo: senza, resta la sola
                      email invece di una riga «tel:» che non chiama nessuno */}
                  {u.telefono ? (
                    <a className="leader__tel" href={`tel:${tel(u.telefono)}`}>
                      {u.telefono}
                    </a>
                  ) : null}
                  {/* l'indirizzo ufficiale del gruppo, non uno dell'unità: è
                      l'unico che il sito pubblica */}
                  <a className="leader__mail" href={`mailto:${g.email}`}>
                    {g.email}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
        <p className="tiny-note">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
          incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.
        </p>
      </section>

      <section className="wrap section--wide split split--faq" aria-labelledby="titolo-faq">
        <div className="stack gap-14">
          <span className="eyebrow">Label</span>
          <h2 id="titolo-faq" className="h2 h2--sm">
            Label
          </h2>
          <p className="note" style={{ fontSize: "17.5px" }}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore.
          </p>
          <a
            className="btn btn--ghost"
            href="#modulo-contatti"
            style={{ alignSelf: "flex-start", marginTop: "6px" }}
          >
            Label ↓
          </a>
        </div>
        <div className="stack gap-12">
          {domande.map((f, i) => (
            <details
              key={i}
              className="faq"
              style={{ borderLeftColor: COLORI_FAQ[f.fascia] }}
            >
              <summary>{f.domanda}</summary>
              <p>
                {f.risposta}
                {f.link ? (
                  <>
                    <Link href={f.link.href}>{f.link.testo}</Link>
                    {f.link.coda}
                  </>
                ) : null}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section
        id="modulo-contatti"
        className={conModulo ? "band--navy split split--form" : "band--navy stack gap-14"}
        style={{ marginTop: "80px", padding: "52px var(--gutter)" }}
        aria-labelledby="titolo-modulo"
      >
        <div className="stack gap-14">
          <span className="eyebrow eyebrow--yellow">Label</span>
          <h2 id="titolo-modulo" className="h2 h2--sm" style={{ color: "#fff" }}>
            Label
          </h2>
          <p
            style={{
              maxWidth: "480px",
              fontSize: "17.5px",
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.75)",
              textWrap: "pretty",
            }}
          >
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.
            {/* Senza il modulo la frase deve dire dove si scrive: accanto non
                c'è più una casella da compilare, e l'indirizzo è due righe
                sotto, nella stessa fascia. */}
            {conModulo ? null : " Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do."}
          </p>
          <div className="stack gap-10" style={{ paddingTop: "8px" }}>
            {/* I nomi vengono da CHI_SIAMO, non riscritti a mano: erano rimasti
                due «Nome Cognome» del mockup. L'arancione è il colore del gestore —
                sul navy dà 5:1, quindi si legge; gli altri nomi restano
                bianchi, perché quel colore non è loro. */}
            <span style={{ fontSize: "16.5px", color: "rgba(255,255,255,0.85)" }}>
              Label:{" "}
              {CHI_SIAMO.gestori
                .filter((p) => p.gestore)
                .map((p) => (
                  <strong key={p.nome} style={{ color: "var(--orange)" }}>
                    {p.nome}
                  </strong>
                ))}
            </span>
            <a
              href={`mailto:${g.email}`}
              style={{ fontSize: "16.5px", fontWeight: 600, color: "var(--yellow-soft)" }}
            >
              {g.email}
            </a>
            {g.telefonoGestori ? (
              <a
                href={`tel:${tel(g.telefonoGestori)}`}
                style={{ fontSize: "16.5px", fontWeight: 600, color: "var(--yellow-soft)" }}
              >
                {g.telefonoGestori}
              </a>
            ) : null}
          </div>
        </div>

        {conModulo ? <ModuloContatti email={g.email} /> : null}
      </section>
    </main>
  );
}
