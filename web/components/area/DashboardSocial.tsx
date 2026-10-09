import { livelloPer } from "@/lib/auth/contesto";
import Link from "next/link";
import type { VoceCoda } from "@/components/area/Coda";
import { Icona } from "@/components/area/Icone";
import { leggiAlbum } from "@/lib/album";
import { isoDaEvento, leggiAttivita } from "@/lib/attivita-store";
import { vociDellaCoda } from "@/lib/coda";
import { fasciaDiUnita, labelDiUnita } from "@/lib/data";
import { leggiIdentita } from "@/lib/gruppo";
import { immaginiCaricate } from "@/lib/immagini-store";
import type { Sessione } from "@/lib/sessione";
import { conAlbum, SLOT } from "@/lib/slot-immagini";
import { albumAttivi } from "@/lib/funzioni";
import { leggiUnita } from "@/lib/unita-store";

/**
 * La dashboard del social media manager: sua, non quella del gestore con
 * qualche riquadro in meno (richiesta del 4 ottobre 2026).
 *
 * Il suo lavoro sono tre cose — **contenuti, foto, calendario** — e la pagina è
 * costruita su quelle tre, nello stesso ordine del menu: un riquadro per
 * ciascuna con quello che aspetta i gestori e dove si fa, le prossime date
 * del calendario, e la sua parte della coda. Niente iscritti, messaggi,
 * documenti, recapiti o registro: non sono suoi, e una dashboard che li
 * contasse direbbe numeri che lui non può aprire.
 *
 * La coda è quella dei gestori vista da chi propone (`vista:
 * "chi-propone"`): le stesse voci, ristrette al suo perimetro.
 */

const accorda = (n: number, uno: string, tanti: string) => (n === 1 ? uno : tanti);

const ETICHETTA: Partial<Record<VoceCoda["tipo"], string>> = {
  pagina: "Testo",
  faq: "Domande",
  campo: "Unità",
  album: "Album",
  immagine: "Fotografia",
  copertina: "Copertina",
  attivita: "Attività",
};

const AREA_DI: Partial<Record<VoceCoda["tipo"], "contenuti" | "foto" | "calendario">> = {
  pagina: "contenuti",
  faq: "contenuti",
  campo: "contenuti",
  album: "foto",
  immagine: "foto",
  copertina: "foto",
  attivita: "calendario",
};

export async function DashboardSocial({ sessione }: { sessione: Sessione }) {
  const albumAperti = (await albumAttivi()) && (await livelloPer("album-carica")) !== "nessuno";
  const [identita, { voci }, tuttiAlbum, tutteAttivita, immagini, unita] = await Promise.all([
    leggiIdentita(),
    vociDellaCoda({ vista: "chi-propone" }),
    // con gli album spenti la sezione non c'è: niente conti, niente collegamento
    albumAperti ? leggiAlbum() : [],
    (await livelloPer("attivita")) === "nessuno" ? [] : leggiAttivita(),
    immaginiCaricate(),
    leggiUnita(),
  ]);

  // tutti, non solo i suoi: dal 6 ottobre 2026 tiene aggiornati album e
  // calendario per tutte le unità, anche quello che hanno inserito i referenti
  const album = tuttiAlbum;
  const attivita = tutteAttivita;

  const base = "/area-riservata/social";
  const inAttesa = (area: "contenuti" | "foto" | "calendario") =>
    voci.filter((v) => AREA_DI[v.tipo] === area).length;

  // Contenuti
  const testiInCoda = inAttesa("contenuti");

  // Foto: i ritratti non sono suoi, si contano i soli riquadri che può riempire
  const fotoInCoda = inAttesa("foto");
  const inBozza = album.filter((a) => a.stato === "bozza").length;
  const pubblicati = album.filter((a) => a.stato === "pubblicato").length;
  const riquadri = SLOT.filter((s) => !s.persona).filter(conAlbum(albumAperti));
  const pieni = riquadri.filter((s) => immagini.has(s.chiave)).length;
  const conCopertina = unita.filter((u) => u.copertina).length;

  // Calendario: le prossime date, comprese quelle che aspettano o sono in bozza
  const calendarioInCoda = inAttesa("calendario");
  const oggi = new Date().toISOString().slice(0, 10);
  const prossime = attivita
    .map((a) => ({ ...a, iso: isoDaEvento(a.giorno, a.mese, a.anno) ?? "" }))
    .filter((a) => a.iso >= oggi)
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(0, 5);
  const inCalendario = attivita.filter((a) => a.stato === "pubblicato").length;

  return (
    <div className="adm-dash">
      <div className="adm-dash__hero adm-dash__hero--group">
        <div className="adm-dash__hero-main">
          <div className="adm-dash__hero-badge adm-dash__hero-badge--group">
            <img
              src={identita.marchio.src}
              alt={identita.nome}
              width={56}
              height={56}
              className="adm-dash__hero-logo"
            />
          </div>
          <div className="adm-dash__hero-text">
            <div className="adm-dash__hero-pills">
              <span className="adm-dash__pill adm-dash__pill--dark">Contenuti · Foto · Calendario</span>
              <span className="adm-dash__pill adm-dash__pill--outline">tutte le unità</span>
            </div>
            <h2 className="adm-dash__hero-title">Buon lavoro, {sessione.n}!</h2>
            <p className="adm-dash__hero-sub">
              I testi, le fotografie e il calendario del <strong>{identita.nome}</strong>.
              Quello che salvate va ai gestori, che lo approvano e lo mettono online.
            </p>
          </div>
        </div>
        <div className="adm-dash__hero-actions">
          <Link href="/" target="_blank" className="adm-btn adm-dash__btn-accent">
            Apri sito pubblico ↗
          </Link>
          <Link href={`${base}/in-attesa`} className="adm-btn adm-btn--primary">
            In attesa ({voci.length})
          </Link>
        </div>
      </div>

      <div className="adm-dash__kpis adm-dash__kpis--tre">
        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="matita" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Contenuti</span>
          </div>
          <div className="adm-dash__kpi-number">{testiInCoda}</div>
          <div className="adm-dash__kpi-label">
            {accorda(testiInCoda, "Testo in attesa", "Testi in attesa")} di approvazione
          </div>
          <div className="adm-dash__kpi-meta">
            <span>Home, Chi siamo, domande frequenti e le pagine delle sei unità</span>
          </div>
          <div className="adm-dash__kpi-links">
            <Link href={`${base}/pagine`} className="adm-dash__kpi-link">
              Testi delle pagine →
            </Link>
            <Link href={`${base}/testi-unita`} className="adm-dash__kpi-link">
              Testi e foto delle unità →
            </Link>
          </div>
        </div>

        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="foto" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Foto</span>
          </div>
          <div className="adm-dash__kpi-number">{fotoInCoda}</div>
          <div className="adm-dash__kpi-label">
            {albumAperti
              ? accorda(fotoInCoda, "Album o fotografia", "Album e fotografie")
              : accorda(fotoInCoda, "Fotografia", "Fotografie")}{" "}
            in attesa
          </div>
          <div className="adm-dash__kpi-meta">
            <span>
              {albumAperti ? (
                <>
                  {inBozza} {accorda(inBozza, "album in bozza", "album in bozza")} · {pubblicati}{" "}
                  {accorda(pubblicati, "pubblicato", "pubblicati")} ·{" "}
                </>
              ) : null}
              riquadri {pieni}/{riquadri.length} · copertine {conCopertina}/{unita.length}
            </span>
          </div>
          <div className="adm-dash__kpi-links">
            {albumAperti ? (
              <Link href={`${base}/album`} className="adm-dash__kpi-link">
                Album e foto →
              </Link>
            ) : null}
            <Link href={`${base}/immagini`} className="adm-dash__kpi-link">
              Foto del sito →
            </Link>
          </div>
        </div>

        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="calendario" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Calendario</span>
          </div>
          <div className="adm-dash__kpi-number">{calendarioInCoda}</div>
          <div className="adm-dash__kpi-label">
            {accorda(calendarioInCoda, "Attività in attesa", "Attività in attesa")} di approvazione
          </div>
          <div className="adm-dash__kpi-meta">
            <span>
              {inCalendario} nel calendario pubblico, di tutte le unità e del gruppo
            </span>
          </div>
          <div className="adm-dash__kpi-links">
            <Link href={`${base}/calendario`} className="adm-dash__kpi-link">
              Calendario attività →
            </Link>
          </div>
        </div>
      </div>

      <div className="adm-dash__grid">
        <div className="adm-dash__col-main">
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">Prossime date in calendario</h3>
                <span className="adm-dash__section-subtitle">
                  Quelle da raccontare sui social, e quelle che aspettano ancora i gestori
                </span>
              </div>
              <Link href={`${base}/calendario`} className="adm-btn">
                Tutto il calendario →
              </Link>
            </div>

            {prossime.length === 0 ? (
              <div className="adm-dash__empty">
                <p>Nessuna attività in programma da oggi in avanti.</p>
                <Link href={`${base}/calendario`} className="adm-btn adm-btn--primary">
                  Aggiungi un’attività
                </Link>
              </div>
            ) : (
              <div className="adm-dash__event-list">
                {prossime.map((e) => {
                  const diGruppo = e.unita.includes("gruppo") || e.unita.length !== 1;
                  const colori = diGruppo ? null : fasciaDiUnita(e.unita[0]);
                  return (
                    <div key={e.id} className="adm-dash__event-item">
                      <div
                        className="adm-dash__event-date"
                        style={{
                          backgroundColor: colori ? colori.colore : "var(--navy-800)",
                          color: colori ? colori.inchiostro : "#ffffff",
                        }}
                      >
                        <span className="adm-dash__event-dow">{e.dow}</span>
                        <span className="adm-dash__event-day">{e.giorno}</span>
                        <span className="adm-dash__event-month">{e.mese.slice(0, 3)}</span>
                      </div>
                      <div className="adm-dash__event-content">
                        <div className="adm-dash__event-top">
                          <h4 className="adm-dash__event-title">{e.titolo}</h4>
                          {e.stato === "pubblicato" ? (
                            <span className="adm-dash__pill adm-dash__pill--outline">
                              {e.unita.includes("gruppo")
                                ? "Gruppo"
                                : e.unita.map(labelDiUnita).join(" e ")}
                            </span>
                          ) : (
                            <span className="adm-dash__pill adm-dash__pill--warn">
                              {e.stato === "in-revisione" ? "In attesa" : "Bozza"}
                            </span>
                          )}
                        </div>
                        <div className="adm-dash__event-details">
                          {e.luogo ? (
                            <span className="adm-dash__event-detail">
                              <Icona nome="luogo" misura={13} />
                              {e.luogo}
                            </span>
                          ) : null}
                          <span className="adm-dash__event-detail adm-dash__event-detail--tipo">
                            <Icona nome="etichetta" misura={13} />
                            {e.tipo}
                          </span>
                        </div>
                      </div>
                      <div className="adm-dash__event-actions">
                        <Link
                          href={`${base}/calendario?att=${e.id}`}
                          className="adm-btn adm-dash__btn-sm"
                        >
                          Apri
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="adm-dash__col-side">
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">In attesa dei gestori</h3>
                <span className="adm-dash__section-subtitle">
                  Sul sito resta quello di adesso finché non approvano
                </span>
              </div>
            </div>

            {voci.length === 0 ? (
              <div className="adm-dash__empty-ok">
                <span className="adm-dash__empty-icon">
                  <Icona nome="spunta" misura={24} />
                </span>
                <strong>Niente in attesa</strong>
                <span>Tutto quello che avete mandato è già stato deciso.</span>
              </div>
            ) : (
              <div className="adm-dash__coda-preview">
                {voci.slice(-6).reverse().map((v) => (
                  <div key={`${v.tipo}|${v.chiave}`} className="adm-dash__coda-item">
                    <span className="adm-dash__pill adm-dash__pill--warn">{ETICHETTA[v.tipo]}</span>
                    <strong>{v.titolo}</strong>
                    <span className="adm-dash__coda-meta">{v.ambito}</span>
                  </div>
                ))}
                <Link
                  href={`${base}/in-attesa`}
                  className="adm-btn adm-btn--primary adm-dash__btn-block"
                >
                  Tutto quello che aspetta ({voci.length}) →
                </Link>
              </div>
            )}
          </div>

          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">Non passano da qui</h3>
                <span className="adm-dash__section-subtitle">
                  Li gestiscono i gestori: per una correzione, scrivete a loro
                </span>
              </div>
            </div>
            <ul className="adm-dash__fuori">
              <li>Documenti, circolari e informative</li>
              <li>Recapiti: telefoni, indirizzi, email, luoghi di ritrovo</li>
              <li>Nomi dei referenti, iscritti e consensi</li>
              <li>Account, permessi e impostazioni del sito</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="adm-notice">
        <span className="adm-notice__tag">Regola</span>
        <span>
          Sul sito non vanno fotografie in cui si riconosca il volto di qualcuno, ragazzi o
          referenti, nemmeno piccolo. I gestori le guardano prima di approvare, ma il
          controllo comincia da chi carica.
        </span>
      </div>
    </div>
  );
}
