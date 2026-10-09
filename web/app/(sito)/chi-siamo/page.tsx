import type { Metadata } from "next";
import { metadatiPagina } from "@/lib/metadati";
import Link from "next/link";
import { Crumbs } from "@/components/site/Crumbs";
import { conRitratti, ImmagineSlot, Photo, Ritratto } from "@/components/site/Photo";
import { inIndirizzo } from "@/lib/contenuti";
import { fascia } from "@/lib/data";
import { leggiIdentita } from "@/lib/gruppo";
import { immaginiCaricate } from "@/lib/immagini-store";
import { leggiChiSiamo } from "@/lib/pagine-store";
import { leggiUnita } from "@/lib/unita-store";

export const metadata: Metadata = metadatiPagina(
  "Label",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.",
  "/chi-siamo",
);

export default async function ChiSiamo() {
  // lo staff di ogni unità è contenuto, e i referenti lo aggiornano dall'area
  const tutte = await leggiUnita();
  const CHI_SIAMO = await leggiChiSiamo();
  const immagini = await immaginiCaricate();
  const { email } = await leggiIdentita();

  const c = CHI_SIAMO;
  const fotoGruppo = immagini.get("chi-siamo.gruppo");
  const ritratti = conRitratti(
    immagini,
    c.gestori.map((p) => p.nome),
  );
  // il colore delle schede di chi non sta in una fascia sola
  const fasciaGruppo = fascia("gruppo");

  return (
    <main id="contenuto">
      {/*
        La fotografia di gruppo, quando c'è; senza, l'intestazione di testo
        delle altre pagine (Contatti, Documenti, Le unità).

        Fino al 2 ottobre 2026 qui c'era la colonna che cammina nella valle,
        cioè **la stessa** fotografia dell'eroe della home, con un taglio quasi
        uguale: chi passava dalla home a «Chi siamo» rivedeva l'immagine che
        aveva appena visto. Il gruppo ha dieci fotografie pubblicabili, e una
        sola foto su due eroi è un'immagine sprecata due volte. La colonna
        resta alla home, che è dove si arriva; il posto «Fotografia di gruppo»
        resta caricabile dall'area riservata, e una foto nuova riporta l'eroe.

        Con la foto, sta sotto lo scrim e sopra il colore, come la copertina di
        un'unità: senza scrim, una foto chiara renderebbe illeggibile il titolo
        bianco.
      */}
      {fotoGruppo ? (
        <section className="page-hero ph ph--hero" aria-labelledby="titolo-pagina">
          <ImmagineSlot img={fotoGruppo} className="page-hero__foto" />
          <div className="page-hero__scrim"></div>
          <div className="page-hero__body">
            <Crumbs onPhoto items={[{ label: "Home", href: "/" }, { label: "Label" }]} />
            <h1 id="titolo-pagina" className="page-hero__title">
              {c.titolo}
            </h1>
          </div>
        </section>
      ) : (
        <div className="wrap section--tight stack gap-14">
          <Crumbs items={[{ label: "Home", href: "/" }, { label: "Label" }]} />
          <h1 id="titolo-pagina" className="h1" style={{ maxWidth: "900px", textWrap: "balance" }}>
            {c.titolo}
          </h1>
        </div>
      )}

      <section className="wrap section split split--intro" aria-labelledby="titolo-gruppo">
        <div className="stack gap-18">
          <span className="eyebrow">Label</span>
          <h2 id="titolo-gruppo" className="h2">
            {c.sommario}
          </h2>
          {c.testi.map((t, i) => (
            <p key={i} className="prose" style={{ fontSize: "19px" }}>
              {t}
            </p>
          ))}
        </div>
        <div className="stack gap-14 offset-44">
          {c.schede.map((s, i) => (
            <div key={i} className={s.navy ? "card card--pad card--navy" : "card card--pad"}>
              <span
                className={s.navy ? "eyebrow eyebrow--yellow" : "eyebrow"}
                style={{ fontSize: "11px", letterSpacing: "0.12em" }}
              >
                {s.kicker}
              </span>
              <span
                style={{
                  fontSize: "17.5px",
                  fontWeight: 600,
                  color: s.navy ? "#fff" : "var(--ink)",
                }}
              >
                {s.valore}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section--wide stack gap-26" aria-labelledby="titolo-metodo">
        <div className="stack gap-14 measure">
          <span className="eyebrow">Label</span>
          <h2 id="titolo-metodo" className="h2">
            Label
          </h2>
        </div>
        <div className="grid grid--4 grid--hair" style={{ borderRadius: "14px" }}>
          {c.pilastri.map((p, i) => (
            <div key={i} className="pillar">
              <span className="pillar__dot" style={{ background: p.colore }}></span>
              <h3>{p.titolo}</h3>
              <p>{p.testo}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="band--navy" style={{ marginTop: "88px" }} aria-labelledby="titolo-storia">
        <div className="wrap stack gap-34" style={{ paddingTop: "72px", paddingBottom: "72px" }}>
          <div className="stack gap-14 measure">
            <span className="eyebrow eyebrow--yellow">Label</span>
            <h2 id="titolo-storia" className="h2" style={{ color: "#fff" }}>
              Label
            </h2>
          </div>
          <div className="tl">
            {c.storia.map((t) => (
              <div key={t.anno} className={t.first ? "tl__item tl__item--first" : "tl__item"}>
                <span className="tl__year">{t.anno}</span>
                <p>{t.testo}</p>
              </div>
            ))}
          </div>
          {/* 0.62 e non 0.45: sul navy il 45% dava 4,25:1, appena sotto il 4,5
              che serve a 12 px. Misurato, non stimato. */}
          <p className="tiny-note" style={{ color: "rgba(255,255,255,0.62)" }}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.
          </p>
        </div>
      </section>

      <section
        className="wrap section--wide stack gap-26"
        aria-labelledby="titolo-organizzazione"
      >
        <div className="headrow">
          <div className="stack gap-14">
            <span className="eyebrow">Label</span>
            <h2 id="titolo-organizzazione" className="h2">
              Label
            </h2>
          </div>
          <Link className="btn btn--ghost" href="/unita">
            Label
          </Link>
        </div>
        <div className="grid grid--3">
          {c.fasce.map((b) => {
            const col = fascia(b.chiave);
            return (
              <article key={b.chiave} className="brief" style={{ borderLeftColor: col.colore }}>
                <span className="brief__kicker" style={{ color: col.accento }}>
                  {b.kicker}
                </span>
                <h3 className="h3">{b.titolo}</h3>
                <p>{b.testo}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="wrap section--wide stack gap-26" aria-labelledby="titolo-referenti">
        <div className="stack gap-14 measure">
          <span className="eyebrow">Label</span>
          <h2 id="titolo-referenti" className="h2">
            Label
          </h2>
          {/* Il ruolo come lo descrive lo statuto dell'organizzazione: il
              testo non attribuisce ai gestori responsabilità che lo statuto
              assegna ad altri organi. */}
          <p className="prose">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
          </p>
        </div>
        <div className="grid grid--4">
          {/* Anche queste schede portano il filo della loro fascia — che per
              chi guida tutto il gruppo è «tutto il gruppo», cioè il navy.
              L'eccezione è il gestore, che ha un colore suo: l'arancione
              della fase 12, e quello vince sul navy. Senza questa riga
              una scheda di referente restava senza colore in cima, accanto
              a una che ce l'aveva. */}
          {c.gestori.map((p, i) => (
            <article
              key={i}
              className={p.gestore ? "card card--gestore" : "card card--referente"}
              style={p.gestore ? undefined : { borderTopColor: fasciaGruppo.colore }}
            >
              {/* Il ritratto, se quella persona ne ha caricato uno; l'avatar
                  anonimo per gli altri, ma solo se almeno uno ce l'ha. Senza
                  nessun ritratto la scheda è il nome e il ruolo, che è quello
                  che serve a una famiglia. Vedi `conRitratti` in
                  components/site/Photo.tsx. */}
              {ritratti ? (
                <Photo className="staff__media">
                  <Ritratto
                    img={immagini.get(`referente.${inIndirizzo(p.nome)}`)}
                    className="slot__foto"
                    sizes="(max-width: 900px) 50vw, 280px"
                  />
                </Photo>
              ) : null}
              <div className="staff__body">
                <span className="staff__name">{p.nome}</span>
                <span className="staff__role">{p.ruolo}</span>
              </div>
            </article>
          ))}
          <div className="contact-card" style={{ background: "var(--navy-600)" }}>
            <span style={{ color: "var(--yellow)" }}>Label</span>
            <strong style={{ color: "#fff", fontSize: "22px" }}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            </strong>
            <Link
              href="/contatti"
              style={{ fontSize: "16.5px", fontWeight: 600, color: "var(--yellow-soft)" }}
            >
              Label →
            </Link>
          </div>
        </div>

        <div
          className="stack gap-18"
          style={{ marginTop: "34px", paddingTop: "34px", borderTop: "1px solid var(--line)" }}
        >
          <div className="headrow">
            <h3 className="h3" style={{ fontSize: "26px" }}>
              Label
            </h3>
            <span className="tiny-note" style={{ color: "var(--muted-2)" }}>
              Lorem ipsum dolor sit amet{" "}
              <Link href="/contatti" style={{ fontWeight: 600 }}>
                Label
              </Link>
            </span>
          </div>
          <div className="grid grid--3" style={{ gap: "16px" }}>
            {tutte.map((u) => {
              const col = fascia(u.fascia);
              return (
                <div key={u.slug} className="gestorecard" style={{ borderTopColor: col.colore }}>
                  <span className="gestorecard__unit" style={{ color: col.accento }}>
                    {u.nome} · {u.ramoPlurale}
                  </span>
                  <div className="stack gap-8">
                    {/* Un'unità di cui non conosciamo ancora i referenti lasciava una
                        scheda con il solo nome e sotto il vuoto. La riga qui
                        dice che cosa manca e dove chiedere, che è più utile di
                        un riquadro che sembra rotto. */}
                    {u.staff.length === 0 ? (
                      <span className="gestorecard__row" style={{ color: "var(--muted-2)" }}>
                        Lorem ipsum dolor sit amet{" "}
                        <a href={`mailto:${email}`} style={{ fontWeight: 600 }}>
                          {email}
                        </a>
                      </span>
                    ) : null}
                    {u.staff.map(([nome, ruolo], i) => (
                      <span key={i} className="gestorecard__row">
                        <strong>{nome}</strong> {ruolo}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="band--green" style={{ marginTop: "88px" }}>
        <div className="cta-row">
          <div className="stack gap-12" style={{ maxWidth: "640px" }}>
            <span className="eyebrow eyebrow--light">Label</span>
            <h2 className="h2 h2--sm" style={{ color: "#fff" }}>
              Label
            </h2>
          </div>
          <div className="cta-row__buttons">
            <Link className="btn btn--yellow" href="/contatti">
              Label
            </Link>
            <Link className="btn btn--onnavy" href="/documenti">
              Label
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
