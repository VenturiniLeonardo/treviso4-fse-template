import Link from "next/link";
import { Crumbs } from "@/components/site/Crumbs";
import { conRitratti, ImmagineSlot, Photo, Ritratto } from "@/components/site/Photo";
import { inIndirizzo } from "@/lib/contenuti";
import { fascia, nomeReferente, tel, type Unita } from "@/lib/data";
import { leggiIdentita } from "@/lib/gruppo";
import { immaginiCaricate } from "@/lib/immagini-store";
import { inParagrafi } from "@/lib/unita-contenuti";

/**
 * Il corpo di una pagina d'unità.
 *
 * Estratto dalla rotta nella fase 14.8, perché adesso lo rendono **due** pagine:
 * `/unita/[slug]`, prerenderizzata, e `/anteprima/unita/[slug]`, dinamica e per
 * chi è entrato nell'area riservata.
 *
 * La ragione dell'estrazione è tutta qui: un'anteprima che disegna la pagina con
 * un secondo componente non è un'anteprima. Basta una differenza — una riga in
 * più, un colore, una sezione mancante — perché chi approva veda una cosa e le
 * famiglie ne vedano un'altra, e il modo in cui ci si accorge è che qualcuno
 * pubblica credendo di aver controllato. Con un componente solo la domanda non
 * si pone: quello che si vede in anteprima **è** la pagina.
 *
 * Non riceve niente che riguardi l'anteprima: la fascia che la dichiara la mette
 * la rotta, sopra. Questo componente non sa e non deve sapere in quale delle due
 * pagine sta.
 */
export async function CorpoUnita({
  u,
  tutte,
}: {
  u: Unita;
  /** le altre unità, per la barra in fondo */
  tutte: Unita[];
}) {
  const col = fascia(u.fascia);
  const immagini = await immaginiCaricate();
  const archivio = immagini.get(`unita.${u.chiave}.archivio`);
  // i ritratti si mostrano solo se almeno uno dei referenti ne ha caricato uno:
  // vedi `conRitratti` in components/site/Photo.tsx
  const ritratti = conRitratti(
    immagini,
    u.responsabili.map(([nome]) => nome),
  );
  // le unità non hanno più un indirizzo proprio: si scrive a quello ufficiale
  // del gruppo, l'unico che il sito pubblica (23 settembre 2026)
  const { email } = await leggiIdentita();
  const gialla = u.fascia === "gialla";
  const chipInk = gialla ? "rgba(0,33,68,0.8)" : "rgba(255,255,255,0.92)";
  const titoloContatto = gialla ? "#002144" : "#fff";
  const linkContatto = gialla ? "#003366" : "#ffdd66";

  // Righe che l'archivio non sempre ha: la sigla di tesseramento e l'anno di
  // fondazione. Quelle vuote si tolgono, invece di mostrare una chiave senza
  // valore — che a schermo è una riga rotta, non un'informazione mancante.
  const schede: [string, string][] = [
    ...(u.fondazione ? ([["Label", u.fondazione]] as [string, string][]) : []),
    ["Label", u.eta],
    /*
     * Il motto.
     *
     * Era un campo di `Unita`, modificabile dall'area riservata, indicizzato
     * dalla ricerca — e non stampato da nessuna pagina: chi cercava il motto
     * arrivava sulla pagina dell'unità e non lo trovava.
     *
     * L'etichetta della riga può dipendere dall'unità: per questo la scelta
     * passa dalla chiave, anche se oggi le etichette coincidono.
     */
    ...(u.motto
      ? ([[u.chiave === "u1" ? "Label" : "Label", u.motto]] as [string, string][])
      : []),
    // zero vuol dire «non indicato»: vedi `iscritti` in lib/data.ts
    ...(u.iscritti > 0 ? ([["Label", String(u.iscritti)]] as [string, string][]) : []),
    ["Label", u.ritrovo],
    ...(u.sigla ? ([["Label", u.sigla]] as [string, string][]) : []),
  ];

  // nel mockup la pastiglia mostra il solo nome, senza il ruolo
  const referenteBreve = nomeReferente(u.referente);

  return (
    <main id="contenuto">
      <section
        className="page-hero page-hero--unit ph ph--unit"
        style={{ backgroundColor: col.colore }}
        aria-labelledby="titolo-unita"
      >
        {/*
          La copertina, se c'è; altrimenti il colore di fascia e basta.

          Senza copertina ci stava scritto «foto dell'unità», che è la nota del
          progetto grafico su che immagine ci sarebbe andata: il nome di una
          cosa assente, servito a chi legge. Il nome dell'unità sta già nel
          titolo qui sotto.

          L'`img` sta **dentro** l'eroe e sotto lo scrim, con `object-fit:
          cover`: il colore di fascia resta come fondo — si vede finché
          l'immagine non è arrivata, e sui lati se la proporzione non combacia —
          e lo scrim tiene il contrasto del titolo bianco sopra qualunque
          fotografia. Senza lo scrim, una foto chiara renderebbe illeggibile il
          nome dell'unità, che è il difetto d'accessibilità più facile da
          introdurre mettendo un'immagine dietro del testo.

          `width` e `height` sono le misure vere, lette al caricamento: servono a
          riservare lo spazio (soglia CLS di §04). `sizes="100vw"` perché l'eroe
          è a tutta larghezza, e il `srcSet` usa i tre lati che la rotta serve.
        */}
        {u.copertina ? (
          <img
            className="page-hero__foto"
            src={u.copertina.src}
            srcSet={`${u.copertina.src}?l=400 400w, ${u.copertina.src}?l=800 800w, ${u.copertina.src}?l=1600 1600w`}
            sizes="100vw"
            width={u.copertina.larghezza}
            height={u.copertina.altezza}
            alt=""
            // la copertina è decorativa: il nome dell'unità è già nel titolo,
            // e descriverla («un gruppo di persone all'aperto») sarebbe
            // una didascalia che nessuno tiene aggiornata quando la foto cambia
            aria-hidden="true"
          />
        ) : null}
        <div className="page-hero__scrim"></div>
        <div className="page-hero__body" style={{ gap: "18px", paddingBottom: "44px" }}>
          <Crumbs
            onPhoto
            items={[
              { label: "Home", href: "/" },
              { label: "Label", href: "/unita" },
              { label: u.nome },
            ]}
          />
          <div className="unit-head">
            <img
              src={`/assets/${u.logo}`}
              width={240}
              height={240}
              alt="Logo dell’unità"
            />
            <div className="stack gap-10">
              <span className="unit-head__kicker">
                {u.ramoPlurale} · {u.eta}
              </span>
              <h1 id="titolo-unita" className="page-hero__title">
                {u.nome}
              </h1>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {u.occhiello ? (
              <span
                className="hero-chip hero-chip--solid"
                style={{ background: col.colore, color: chipInk }}
              >
                {u.occhiello}
              </span>
            ) : null}
            {u.iscritti > 0 ? <span className="hero-chip">{u.iscrittiLabel}</span> : null}
            {/* senza il nome del referente la pastiglia sparisce: «Referente di unità:»
                seguito dal nulla è peggio di una pastiglia in meno */}
            {referenteBreve ? <span className="hero-chip">Label: {referenteBreve}</span> : null}
          </div>
        </div>
      </section>

      <section
        className="wrap section--tight split split--storia"
        style={{ paddingTop: "64px" }}
        aria-labelledby="titolo-storia"
      >
        <div className="stack gap-18">
          {u.presentazione ? (
            // dal 6 ottobre 2026 la scrivono i referenti dall'area: una riga vuota
            // separa i paragrafi, come nella storia
            <div className="stack gap-18" style={{ paddingBottom: "22px" }}>
              {inParagrafi(u.presentazione).map((p, i) => (
                <p key={i} className="lead">
                  {p}
                </p>
              ))}
            </div>
          ) : null}
          <span className="eyebrow" style={{ color: col.accento }}>
            Label
          </span>
          <h2 id="titolo-storia" className="h2" style={{ fontSize: "38px" }}>
            {u.storiaTitolo ?? "Label"}
          </h2>
          {u.storia.map((t, i) => (
            <p key={i} className="prose">
              {t}
            </p>
          ))}
        </div>
        <div className="stack gap-14 offset-42">
          {/* La fotografia d'archivio dell'unità, quando c'è; senza, il
              riquadro non c'è e la colonna è la sola scheda qui sotto.

              Prima restava il riquadro rigato nel colore di fascia, e con le
              poche fotografie che il gruppo può pubblicare (niente volti, dal
              23 settembre 2026) era vuoto su sei pagine su sei: un rettangolo
              a righe accanto alla storia si legge come un'immagine che non si
              è caricata. È un elemento secondario — la fotografia che conta è
              quella dell'eroe, e gli scatti buoni vanno lì (vedi
              `scripts/foto-sito.mjs`) — e un elemento secondario senza foto
              si toglie, non si riempie di righe. */}
          {archivio ? (
            <Photo style={{ height: "240px", borderRadius: "12px" }}>
              <ImmagineSlot
                img={archivio}
                className="slot__foto"
                sizes="(max-width: 900px) 100vw, 420px"
              />
            </Photo>
          ) : null}
          <div className="rows">
            {schede.map(([k, v], i) => (
              <div key={i} className="rows__row">
                <span className="rows__key">{k}</span>
                <span className="rows__val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap section stack gap-22" aria-labelledby="titolo-responsabili">
        <div className="stack gap-12 measure">
          <span className="eyebrow" style={{ color: col.accento }}>
            Label
          </span>
          <h2 id="titolo-responsabili" className="h2 h2--sm">
            Label
          </h2>
          <p className="note" style={{ fontSize: "17.5px" }}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis.
          </p>
        </div>
        <div className="grid grid--4">
          {/* Stato vuoto, per le unità di cui l'archivio non riporta i nomi.
              Senza, restavano un titolo e il solo riquadro dei contatti, che
              a schermo sembra una scheda persa per strada. La frase dice che
              cosa fare adesso — scrivere — invece di scusarsi. */}
          {u.responsabili.length === 0 ? (
            <p className="note" style={{ gridColumn: "1 / -1", fontSize: "17px" }}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
              nostrud.
            </p>
          ) : null}
          {u.responsabili.map(([nome, ruolo, dal], i) => (
            /* Il filo in cima è il colore della fascia dell’unità: chi apre la
               pagina di un'unità gialla ritrova il giallo che ha appena visto
               nell’eroe, e le schede dei referenti smettono di essere l’unico
               riquadro grigio di una pagina che per il resto ha un colore suo.
               Il colore sta in linea e non nella classe perché dipende
               dall’unità: la classe porta solo lo spessore. */
            <article key={i} className="card card--referente" style={{ borderTopColor: col.colore }}>
              {/* Il ritratto, se quella persona ne ha caricato uno; l'avatar
                  anonimo per chi non ce l'ha, ma solo se qualcuno della
                  griglia ce l'ha. Se nessuno ha una fotografia — oggi è così
                  su tutte le pagine — la scheda è nome, ruolo e anno, senza
                  riquadro. Vedi `conRitratti` in components/site/Photo.tsx. */}
              {ritratti ? (
                <Photo className="people-card__media">
                  <Ritratto
                    img={immagini.get(`referente.${inIndirizzo(nome)}`)}
                    className="slot__foto"
                    sizes="(max-width: 900px) 50vw, 300px"
                  />
                </Photo>
              ) : null}
              <div className="people-card__body">
                <span className="people-card__name">{nome}</span>
                <span className="people-card__role">{ruolo}</span>
                <span className="people-card__since" style={{ color: col.accento }}>
                  {dal}
                </span>
              </div>
            </article>
          ))}
          <div className="contact-card" style={{ background: col.colore }}>
            <span style={{ color: chipInk }}>Label</span>
            <strong style={{ color: titoloContatto }}>Label</strong>
            <a
              href={`mailto:${email}`}
              style={{ fontSize: "16.5px", fontWeight: 600, color: linkContatto }}
            >
              {email} →
            </a>
            {/* il telefono è facoltativo, come su Contatti: senza, resta l'email */}
            {u.telefono ? (
              <a
                href={`tel:${tel(u.telefono)}`}
                style={{ fontSize: "16.5px", fontWeight: 600, color: linkContatto }}
              >
                {referenteBreve ? `${referenteBreve}: ` : ""}
                {u.telefono}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* Lo storico sparisce quando è vuoto. A differenza della sezione qui
          sopra non contiene nient'altro, e una tabella con la sola riga di
          intestazione — «Anni · Referente di unità · Note» e poi il niente — è
          esattamente ciò che fa sembrare non finita una pagina. Torna da sé
          appena qualcuno inserisce una riga dall'area riservata. */}
      {u.storico.length > 0 ? (
      <section className="wrap section stack gap-22" aria-labelledby="titolo-storico">
        <div className="stack gap-12 measure">
          <span className="eyebrow" style={{ color: col.accento }}>
            Label
          </span>
          <h2 id="titolo-storico" className="h2 h2--sm">
            Label
          </h2>
        </div>
        <div className="history">
          <div className="history__row history__row--head">
            <span>Label</span>
            <span>{u.ruoloReferente}</span>
            <span>Label</span>
          </div>
          {u.storico.map(([anni, nome, nota], i) => (
            <div key={i} className="history__row">
              <span className="history__years">{anni}</span>
              <span className="history__name">{nome}</span>
              <span className="history__note">{nota}</span>
            </div>
          ))}
        </div>
        {/* La riga sotto la tabella è una didascalia che scrivono i referenti
            dall'area riservata, e compare solo se l'hanno scritta. Prima
            c'era un ripiego — «testi e nomi segnaposto, da compilare con
            l'archivio» — che raccontava al visitatore lo stato di
            avanzamento del sito invece di dirgli qualcosa dell'unità. Una
            pagina pubblica non è il posto in cui si tiene il verbale dei
            lavori: se la didascalia non c'è, non c'è. */}
        {u.notaStorico ? <p className="tiny-note">{u.notaStorico}</p> : null}
      </section>
      ) : null}

      <nav className="band" style={{ marginTop: "72px" }} aria-label="Altre unità">
        <div className="unit-switch">
          <Link className="btn" href="/unita">
            ← Label
          </Link>
          <div className="unit-switch__list">
            {tutte.map((altra) => (
              <Link
                key={altra.slug}
                className="unit-tab"
                href={`/unita/${altra.slug}`}
                aria-current={altra.slug === u.slug ? "page" : undefined}
              >
                <img src={`/assets/${altra.logo}`} width={240} height={240} alt="" />
                {altra.nome}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </main>
  );
}
