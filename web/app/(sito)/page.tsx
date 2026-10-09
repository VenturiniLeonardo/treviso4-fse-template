import type { Metadata } from "next";
import Link from "next/link";
import { Counters } from "@/components/site/Counters";
import { HomeHero } from "@/components/site/HomeHero";
import { ImmagineSlot, Photo, trama } from "@/components/site/Photo";
import { fascia } from "@/lib/data";
import { albumAttivi } from "@/lib/funzioni";
import { leggiIdentita } from "@/lib/gruppo";
import { sede } from "@/lib/identita";
import { immaginiCaricate } from "@/lib/immagini-store";
import { leggiHome } from "@/lib/pagine-store";

/**
 * La home non aveva metadati suoi e prendeva quelli del layout, che per titolo
 * e descrizione vanno benissimo: sono del sito, e la home *è* il sito. Le
 * mancava però il proprio `canonical`, cioè la dichiarazione che l'indirizzo
 * buono è `https://…/` e non una delle sue varianti — con parametri di
 * campagna appesi, o raggiunta da un rimando. Le altre pagine ce l'hanno da
 * `metadatiPagina()`; questa la scrive qui perché titolo e descrizione li
 * eredita già.
 */
export const metadata: Metadata = { alternates: { canonical: "/" }, openGraph: { url: "/" } };

export default async function Home() {
  const immagini = await immaginiCaricate();
  // i testi editoriali dallo store: `lib/data.ts` con sopra quello che i referenti
  // gruppo hanno cambiato. La forma è la stessa di `HOME`, quindi il corpo della
  // pagina non cambia.
  const HOME = await leggiHome();
  const album = await albumAttivi();
  // «Dove siamo» prende la sede dai Dati del gruppo, come il piede e Contatti:
  // scritta in `lib/data.ts` restava quella vecchia anche dopo averla cambiata
  // o tolta dall'area riservata. Senza sede resta la città del gruppo.
  const dove = sede(await leggiIdentita()) || "Label";
  const info = HOME.info.map((c, i) => (i === 0 ? { ...c, valore: dove } : c));

  return (
    <main id="contenuto">
      <HomeHero occhiello={HOME.occhiello} titolo={HOME.titolo} intro={HOME.intro} />

      <div className="home-sheet">
        <div className="wrap stack gap-18">
          <div className="grid grid--3">
            {info.map((c, i) => {
              const navy = i === 2;
              return (
                <div key={i} className={navy ? "card card--pad card--navy" : "card card--pad"}>
                  <span className={navy ? "eyebrow eyebrow--yellow" : "eyebrow"}>{c.kicker}</span>
                  <span style={{ fontSize: "17.5px", fontWeight: 600 }}>{c.valore}</span>
                  {c.href ? (
                    <Link
                      href={c.href}
                      style={{
                        fontSize: "15.5px",
                        fontWeight: 600,
                        ...(navy ? { color: "#ffdd66" } : {}),
                      }}
                    >
                      {c.azione}
                    </Link>
                  ) : (
                    <span style={{ fontSize: "15.5px", color: "var(--muted)" }}>{c.azione}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <section
          className="wrap section--wide split split--home"
          aria-labelledby="titolo-chi-siamo"
        >
          <div className="stack gap-18">
            <span className="eyebrow">Label</span>
            <h2 id="titolo-chi-siamo" className="h2" style={{ fontSize: "42px", lineHeight: 1.08 }}>
              {HOME.chiSiamoTitolo}
            </h2>
            {HOME.chiSiamoTesti.map((t, i) => (
              <p key={i} className="prose" style={{ fontSize: "19px", lineHeight: 1.6 }}>
                {t}
              </p>
            ))}
          </div>
          <blockquote className="quote">
            <p>{HOME.citazione}</p>
            <cite>{HOME.citazioneAutore}</cite>
          </blockquote>
        </section>

        {/* La fascia dei contatori c'è solo con dei numeri da mostrare: finché il
            gruppo non li indica in `HOME.contatori` (lib/data.ts) la fascia non c’è. */}
        {HOME.contatori.length > 0 ? (
          <div className="wrap section--wide">
            <Counters contatori={HOME.contatori} />
          </div>
        ) : null}

        <section className="wrap section--wide stack gap-26" aria-labelledby="titolo-fasce">
          <div className="headrow">
            <div className="stack gap-14">
              <span className="eyebrow">Label</span>
              <h2 id="titolo-fasce" className="h2" style={{ fontSize: "42px", lineHeight: 1.08 }}>
                Label
              </h2>
            </div>
            <Link className="btn btn--ghost" href="/unita">
              Label
            </Link>
          </div>
          <div className="grid grid--3">
            {HOME.fasce.map((b) => {
              const col = fascia(b.fascia);
              const gialla = b.fascia === "gialla";
              return (
                <article key={b.fascia} className="card">
                  {/* La fotografia della fascia, quando un gestore l'ha
                      caricata. Senza, resta il riquadro nel colore di fascia:
                      prima ci stava sopra scritto «foto fascia gialla», che
                      era la nota del progetto grafico su che immagine ci
                      sarebbe andata — servita a un genitore. */}
                  <Photo
                    className="branch-card__media"
                    style={trama(col.colore, gialla ? 0.22 : 0.16)}
                  >
                    <ImmagineSlot
                      img={immagini.get(`home.fascia-${b.fascia}`)}
                      className="slot__foto"
                      sizes="(max-width: 900px) 100vw, 380px"
                    />
                  </Photo>
                  <div className="card__body">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span className="branch-card__dot" style={{ background: col.colore }}></span>
                      <span
                        className="eyebrow"
                        style={{ color: col.accento, letterSpacing: "0.16em", fontSize: "12px" }}
                      >
                        {col.label}
                      </span>
                    </div>
                    <h3 className="h3" style={{ fontSize: "25px" }}>
                      {b.titolo}
                    </h3>
                    <p style={{ fontSize: "17.5px", lineHeight: 1.55, textWrap: "pretty" }}>
                      {b.testo}
                    </p>
                    <div className="branch-card__foot">
                      <span>{b.eta}</span>
                      <Link href="/unita" aria-label="Vai alla pagina">
                        →
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="wrap section--wide stack gap-26" aria-labelledby="titolo-cosa">
          <div className="stack gap-14" style={{ maxWidth: "660px" }}>
            <span className="eyebrow">Label</span>
            <h2 id="titolo-cosa" className="h2" style={{ fontSize: "42px", lineHeight: 1.08 }}>
              Label
            </h2>
          </div>
          <div className="grid grid--2 grid--hair">
            {HOME.cosaFacciamo.map((s) => (
              <div key={s.num} className="steps__cell">
                <span className="steps__num">{s.num}</span>
                <h3>{s.titolo}</h3>
                <p style={{ fontSize: "17px", lineHeight: 1.55, textWrap: "pretty" }}>{s.testo}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap section--wide stack gap-22" aria-labelledby="titolo-resto">
          <span className="eyebrow" id="titolo-resto">
            Label
          </span>
          <div className={album ? "grid grid--3" : "grid grid--2"}>
            {/* la scheda «Foto» c'è solo con gli album accesi (`lib/funzioni.ts`);
                senza, le due che restano prendono metà riga ciascuna invece di
                lasciare vuota la terza colonna */}
            {album ? (
              <Link className="promo promo--navy" href="/foto">
                <Photo className="ph--dark" style={{ height: "150px" }}>
                  <ImmagineSlot
                    img={immagini.get("home.galleria")}
                    className="slot__foto"
                    sizes="(max-width: 900px) 100vw, 380px"
                  />
                </Photo>
                <div className="stack gap-8" style={{ padding: "4px 26px 26px" }}>
                  <h3 className="h3" style={{ fontSize: "24px" }}>
                    Label
                  </h3>
                  <p
                    style={{
                      fontSize: "16.5px",
                      lineHeight: 1.5,
                      color: "rgba(255,255,255,0.75)",
                    }}
                  >
                    Lorem ipsum dolor sit amet, consectetur.
                  </p>
                  <span
                    style={{
                      paddingTop: "6px",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "var(--yellow-soft)",
                    }}
                  >
                    Label →
                  </span>
                </div>
              </Link>
            ) : null}

            <Link className="promo promo--white" href="/documenti">
              <div className="stack gap-10">
                <span className="eyebrow">Label</span>
                <h3 className="h3" style={{ fontSize: "24px" }}>
                  Label
                </h3>
                <p style={{ fontSize: "16.5px", lineHeight: 1.5, textWrap: "pretty" }}>
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod
                  tempor incididunt ut labore et dolore.
                </p>
              </div>
              <div style={{ paddingTop: "4px", borderTop: "1px solid var(--line-soft)" }}>
                <span
                  style={{
                    display: "block",
                    paddingTop: "10px",
                    fontSize: "16px",
                    fontWeight: 600,
                    color: "var(--navy-600)",
                  }}
                >
                  Label →
                </span>
              </div>
            </Link>

            <Link className="promo promo--blue" href="/contatti">
              <div className="stack gap-10">
                <span className="eyebrow eyebrow--yellow">Label</span>
                <h3 className="h3" style={{ fontSize: "24px" }}>
                  Label
                </h3>
                <p
                  style={{
                    fontSize: "16.5px",
                    lineHeight: 1.5,
                    color: "rgba(255,255,255,0.8)",
                    textWrap: "pretty",
                  }}
                >
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.
                </p>
              </div>
              <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--yellow-soft)" }}>
                Label →
              </span>
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
