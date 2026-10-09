import Link from "next/link";
import {
  type UnitaKey,
  type FasciaKey,
  fascia,
  labelDiUnita,
  unitaPerChiave,
  UNITA,
} from "@/lib/data";
import { unitaSalvataPerChiave, leggiUnita, leggiProposte, personeInRevisione } from "@/lib/unita-store";
import { attivitaDiUnita, leggiAttivita, isoDaEvento } from "@/lib/attivita-store";
import { leggiAlbum } from "@/lib/album";
import { albumAttivi } from "@/lib/funzioni";
import { documentiDiUnita, leggiDocumenti } from "@/lib/documenti-store";
import { elencoIscritti } from "@/lib/iscritti-store";
import { livelloPer } from "@/lib/auth/contesto";
import { registroDi, leggiRegistro } from "@/lib/registro-store";
import { elenco as elencoMessaggi } from "@/lib/messaggi-store";
import { leggiIdentita } from "@/lib/gruppo";
import { daSapere, quantoFa, quandoLeggibile } from "@/lib/registro";
import type { Sessione } from "@/lib/sessione";
import { Icona } from "@/components/area/Icone";
import { DashboardSviluppatore } from "@/components/area/DashboardSviluppatore";
import { DashboardSocial } from "@/components/area/DashboardSocial";
import { leggiProposteInAttesa } from "@/lib/proposte-store";

/** I riepiloghi rispettano gli stessi permessi delle sezioni di dettaglio. */
async function leggiSe<T>(azione: import("@/lib/permessi").Azione, leggi: () => T[] | Promise<T[]>): Promise<T[]> {
  return (await livelloPer(azione)) === "nessuno" ? [] : leggi();
}

/**
 * L'accordo di numero, che nei conteggi non è un vezzo.
 *
 * La dashboard mette un numero grande e sotto la sua etichetta al plurale, e
 * quando il numero è uno la coppia si smentisce: «1 / Album fotografici», «1 /
 * Attività programmate», «1 pubblicati». Il singolare non si può nemmeno
 * ricavare togliendo la «i» — *album* è invariabile, *attività* pure, e
 * *pubblicato / pubblicati* cambia la vocale — quindi le due forme si scrivono
 * entrambe e si sceglie in base al conto. Lo zero in italiano vuole il plurale
 * («0 attività programmate»), come ogni numero diverso da uno.
 */
function accorda(quanti: number, singolare: string, plurale: string): string {
  return quanti === 1 ? singolare : plurale;
}

/**
 * Dashboard moderna per l'Area Riservata (Referente Unità, Referente Gruppo, Sviluppatore).
 */
export async function Dashboard({
  sessione,
  ruolo,
  percorso,
  periodo,
}: {
  sessione: Sessione;
  ruolo: string;
  percorso: string;
  /** solo per la dashboard di sistema: il periodo dei suoi grafici */
  periodo?: string;
}) {
  void percorso;

  /* Tre viste, e la scelta è sul **ruolo della vista aperta**, non su quello
     dell'account: un gestore che apre la vista di unità vuole vedere la
     dashboard di unità, che è il senso di andare a guardarla. Quello che non
     può *fare* lo decide il cancello dei permessi, non questa riga.

     `sviluppatore` prende la dashboard di sistema (§ DashboardSviluppatore):
     fino a qui non ne aveva nessuna, perché la sua sezione `riepilogo` non
     esisteva, e cadeva nel ramo del gestore senza mai arrivarci. */
  if (ruolo === "sviluppatore") {
    return <DashboardSviluppatore sessione={sessione} periodo={periodo} />;
  }
  if (ruolo === "gestore") {
    return <DashboardGestore sessione={sessione} />;
  }
  // il social media manager ha la sua: senza, cadeva in quella del referente di unità,
  // che mostra iscritti e consensi — dati che la matrice non gli dà
  if (ruolo === "social") {
    return <DashboardSocial sessione={sessione} />;
  }

  return <DashboardReferente sessione={sessione} />;
}

/**
 * Dashboard completa per il Referente Unità.
 */
async function DashboardReferente({ sessione }: { sessione: Sessione }) {
  const fotoAccese = await albumAttivi();
  // le circolari sono la sezione «documenti» della matrice: chiusa, la pagina
  // non c'è, e il riquadro e l'azione rapida porterebbero a un 404
  const circolariAperte = (await livelloPer("documenti")) !== "nessuno";
  const quantiRiquadri = 2 + (fotoAccese ? 1 : 0) + (circolariAperte ? 1 : 0);
  const miaChiave = (sessione.un ?? "u1") as UnitaKey;
  const unita = (await unitaSalvataPerChiave(miaChiave)) ?? unitaPerChiave(miaChiave) ?? UNITA[0];
  const fasciaInfo = fascia(unita.fascia as FasciaKey);

  // Caricamento dati in parallelo
  const [tuttiAlbum, documenti, attivita, registro] = await Promise.all([
    leggiSe("album-carica", leggiAlbum),
    leggiSe("documenti", () => documentiDiUnita(miaChiave)),
    leggiSe("attivita", () => attivitaDiUnita(miaChiave)),
    registroDi(sessione.u),
  ]);

  // anche i soli conteggi seguono la matrice: una riga chiusa non lascia
  // passare l'elenco dalla porta della dashboard (audit degli accessi, M-2)
  const iscritti =
    (await livelloPer("iscritti-elenco")) === "nessuno" ? [] : elencoIscritti({ unita: miaChiave });
  const suoiAlbum = tuttiAlbum.filter((a) => a.unita === miaChiave);
  const totaleFoto = suoiAlbum.reduce((acc, a) => acc + (a.foto?.length ?? 0), 0);

  // Calcoli metriche
  const tesseratiCount = iscritti.length > 0 ? iscritti.length : unita.iscritti;
  const consensiOk = iscritti.filter((i) => i.consenso).length;
  const quoteSaldate = iscritti.filter((i) => i.quota === "saldata").length;

  const adesso = Date.now();
  const oggiIso = new Date(adesso).toISOString().slice(0, 10);

  // Prossime attività (future o in ordine di data)
  const attivitaConData = attivita.map((a) => {
    const iso = isoDaEvento(a.giorno, a.mese, a.anno) ?? "";
    return { ...a, iso };
  });

  const prossimeAttivita = attivitaConData
    .filter((a) => !a.iso || a.iso >= oggiIso)
    .sort((a, b) => (a.iso && b.iso ? a.iso.localeCompare(b.iso) : 0));

  const elencoEventi = prossimeAttivita.length > 0 ? prossimeAttivita.slice(0, 4) : attivitaConData.slice(0, 4);
  const primaAttivita = elencoEventi[0];

  const saluto = `Ciao, ${sessione.n}!`;

  return (
    <div className="adm-dash">
      {/* Banner di benvenuto */}
      <div
        className="adm-dash__hero"
        style={{ borderLeftColor: fasciaInfo.colore }}
      >
        <div className="adm-dash__hero-main">
          <div
            className="adm-dash__hero-badge"
            style={{ borderColor: fasciaInfo.colore }}
          >
            <img
              src={`/assets/${unita.logo}`}
              alt={unita.nome}
              width={56}
              height={56}
              className="adm-dash__hero-logo"
            />
          </div>
          <div className="adm-dash__hero-text">
            <div className="adm-dash__hero-pills">
              <span
                className="adm-dash__pill adm-dash__pill--fascia"
                style={{ background: fasciaInfo.colore, color: fasciaInfo.inchiostro }}
              >
                {unita.ramo}
              </span>
              <span className="adm-dash__pill adm-dash__pill--dark">
                Anno sociale 2026 – 2027
              </span>
              <span className="adm-dash__pill adm-dash__pill--outline">
                {unita.eta}
              </span>
            </div>
            <h2 className="adm-dash__hero-title">{saluto}</h2>
            <p className="adm-dash__hero-sub">
              Pannello direttivo di <strong>{unita.nome}</strong>. Motto: <em>«{unita.motto}»</em>
            </p>
          </div>
        </div>
        <div className="adm-dash__hero-actions">
          <Link
            href={`/unita/${unita.slug}`}
            target="_blank"
            className="adm-btn adm-dash__btn-accent"
          >
            Vedi pagina pubblica ↗
          </Link>
          <Link
            href="/area-riservata/referente/presentazione"
            className="adm-btn"
          >
            Modifica scheda unità
          </Link>
        </div>
      </div>

      {/* Griglia KPI / Indicatori in tempo reale */}
      <div
        className={`adm-dash__kpis${quantiRiquadri === 3 ? " adm-dash__kpis--tre" : quantiRiquadri === 2 ? " adm-dash__kpis--due" : ""}`}
      >
        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="persone" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Tesseramento</span>
          </div>
          <div className="adm-dash__kpi-number">{tesseratiCount}</div>
          <div className="adm-dash__kpi-label">Iscritti tesserati</div>
          <div className="adm-dash__kpi-meta">
            {iscritti.length > 0 ? (
              <span>
                <strong>{consensiOk}</strong> consensi foto firmati ({quoteSaldate} quote regolarizzate)
              </span>
            ) : (
              <span>Dato anagrafico di fascia · In attesa di importazione nominativi</span>
            )}
          </div>
          <Link href="/area-riservata/referente/iscritti" className="adm-dash__kpi-link">
            Gestisci iscritti e consensi →
          </Link>
        </div>

        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="calendario" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Calendario</span>
          </div>
          <div className="adm-dash__kpi-number">{attivita.length}</div>
          <div className="adm-dash__kpi-label">
            {accorda(attivita.length, "Attività programmata", "Attività programmate")}
          </div>
          <div className="adm-dash__kpi-meta">
            {primaAttivita ? (
              <span>
                Prossima: <strong>{primaAttivita.giorno} {primaAttivita.mese.slice(0, 3)}</strong> · {primaAttivita.titolo}
              </span>
            ) : (
              <span>Nessuna data futura a calendario</span>
            )}
          </div>
          <Link href="/area-riservata/referente/attivita" className="adm-dash__kpi-link">
            Apri calendario e uscite →
          </Link>
        </div>

        {/* spenta con gli album: vedi `lib/funzioni.ts` */}
        {fotoAccese ? (
          <div className="adm-dash__kpi-card">
            <div className="adm-dash__kpi-head">
              <span className="adm-dash__kpi-icon">
                <Icona nome="foto" misura={20} />
              </span>
              <span className="adm-dash__kpi-tag">Fotografie</span>
            </div>
            <div className="adm-dash__kpi-number">{suoiAlbum.length}</div>
            <div className="adm-dash__kpi-label">
              {accorda(suoiAlbum.length, "Album fotografico", "Album fotografici")}
            </div>
            <div className="adm-dash__kpi-meta">
              <span>
                <strong>{totaleFoto}</strong>{" "}
                {accorda(totaleFoto, "fotografia caricata", "fotografie caricate")} ·{" "}
                {suoiAlbum.filter((a) => a.stato === "pubblicato").length}{" "}
                {accorda(
                  suoiAlbum.filter((a) => a.stato === "pubblicato").length,
                  "pubblicato",
                  "pubblicati",
                )}
              </span>
            </div>
            <Link href="/area-riservata/referente/album" className="adm-dash__kpi-link">
              Carica foto e album →
            </Link>
          </div>
        ) : null}

        {circolariAperte ? (
          <div className="adm-dash__kpi-card">
            <div className="adm-dash__kpi-head">
              <span className="adm-dash__kpi-icon">
                <Icona nome="documento" misura={20} />
              </span>
              <span className="adm-dash__kpi-tag">Circolari</span>
            </div>
            <div className="adm-dash__kpi-number">{documenti.length}</div>
            <div className="adm-dash__kpi-label">
              {accorda(documenti.length, "Documento o lista materiale", "Documenti e liste materiale")}
            </div>
            <div className="adm-dash__kpi-meta">
              <span>
                <strong>{documenti.filter((d) => Boolean(d.file)).length}</strong> con il file
                PDF allegato
              </span>
            </div>
            <Link href="/area-riservata/referente/circolari" className="adm-dash__kpi-link">
              Circolari e materiali →
            </Link>
          </div>
        ) : null}
      </div>

      {/* Barra Scorciatoie / Azioni Rapide */}
      <div className="adm-dash__quickbar">
        <span className="adm-dash__quickbar-title">Azioni rapide</span>
        <div className="adm-dash__quickbar-actions">
          <Link href="/area-riservata/referente/attivita" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="piu" misura={15} />
            </span>
            <span>Nuova attività</span>
          </Link>
          {fotoAccese ? (
            <Link href="/area-riservata/referente/album" className="adm-dash__action-btn">
              <span className="adm-dash__action-symbol">
                <Icona nome="foto" misura={15} />
              </span>
              <span>Carica foto e album</span>
            </Link>
          ) : null}
          {circolariAperte ? (
            <Link href="/area-riservata/referente/circolari" className="adm-dash__action-btn">
              <span className="adm-dash__action-symbol">
                <Icona nome="documento" misura={15} />
              </span>
              <span>Nuova circolare</span>
            </Link>
          ) : null}
          <Link href="/area-riservata/referente/iscritti" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="persone" misura={15} />
            </span>
            <span>Elenco iscritti</span>
          </Link>
          <Link href="/area-riservata/referente/presentazione" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="matita" misura={15} />
            </span>
            <span>Scheda e referenti</span>
          </Link>
          <Link href="/area-riservata/referente/immagini" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="immagine" misura={15} />
            </span>
            <span>Foto delle pagine</span>
          </Link>
        </div>
      </div>

      {/* Griglia a due colonne */}
      <div className="adm-dash__grid">
        {/* Colonna Principale: Prossimi Appuntamenti */}
        <div className="adm-dash__col-main">
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">Prossimi appuntamenti in calendario</h3>
                <span className="adm-dash__section-subtitle">
                  Uscite, riunioni e campi programmati per la tua unità e per il gruppo
                </span>
              </div>
              <Link href="/area-riservata/referente/attivita" className="adm-btn">
                Tutte le attività →
              </Link>
            </div>

            {elencoEventi.length === 0 ? (
              <div className="adm-dash__empty">
                <p>Nessuna attività registrata a calendario.</p>
                <Link href="/area-riservata/referente/attivita" className="adm-btn adm-btn--primary">
                  Aggiungi la prima attività
                </Link>
              </div>
            ) : (
              <div className="adm-dash__event-list">
                {elencoEventi.map((e) => {
                  const eDiGruppo = e.unita.includes("gruppo");
                  return (
                    <div key={e.id} className="adm-dash__event-item">
                      <div
                        className="adm-dash__event-date"
                        style={{
                          backgroundColor: eDiGruppo ? "var(--navy-800)" : fasciaInfo.colore,
                          color: eDiGruppo ? "#ffffff" : fasciaInfo.inchiostro,
                        }}
                      >
                        <span className="adm-dash__event-dow">{e.dow}</span>
                        <span className="adm-dash__event-day">{e.giorno}</span>
                        <span className="adm-dash__event-month">{e.mese.slice(0, 3)}</span>
                      </div>
                      <div className="adm-dash__event-content">
                        <div className="adm-dash__event-top">
                          <h4 className="adm-dash__event-title">{e.titolo}</h4>
                          <span
                            className={
                              eDiGruppo
                                ? "adm-dash__pill adm-dash__pill--dark"
                                : "adm-dash__pill adm-dash__pill--fascia"
                            }
                            style={
                              !eDiGruppo
                                ? { background: fasciaInfo.colore, color: fasciaInfo.inchiostro }
                                : undefined
                            }
                          >
                            {eDiGruppo ? "Gruppo" : unita.ramo}
                          </span>
                        </div>
                        <div className="adm-dash__event-details">
                          {e.luogo ? (
                            <span className="adm-dash__event-detail">
                              <Icona nome="luogo" misura={13} />
                              {e.luogo}
                            </span>
                          ) : null}
                          {e.durata ? (
                            <span className="adm-dash__event-detail">
                              <Icona nome="durata" misura={13} />
                              {e.durata}
                            </span>
                          ) : null}
                          <span className="adm-dash__event-detail adm-dash__event-detail--tipo">
                            <Icona nome="etichetta" misura={13} />
                            {e.tipo}
                          </span>
                        </div>
                        {e.nota ? (
                          <p className="adm-dash__event-note">{e.nota}</p>
                        ) : null}
                      </div>
                      <div className="adm-dash__event-actions">
                        <Link
                          href={`/area-riservata/referente/attivita?att=${e.id}`}
                          className="adm-btn adm-dash__btn-sm"
                        >
                          Modifica
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Colonna Laterale: Stato Unità & Ultime Modifiche */}
        <div className="adm-dash__col-side">
          {/* Checklist Stato dell'Unità */}
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">Stato dell’unità</h3>
                <span className="adm-dash__section-subtitle">
                  Riepilogo completezza contenuti pubblici
                </span>
              </div>
            </div>

            <div className="adm-dash__checklist">
              <div className="adm-dash__check-row">
                <div className="adm-dash__check-info">
                  <span className="adm-dash__check-status adm-dash__check-status--ok">
                    <Icona nome="spunta" misura={13} />
                  </span>
                  <div>
                    <strong className="adm-dash__check-label">Foto di copertina</strong>
                    <span className="adm-dash__check-desc">
                      {unita.copertina ? "Immagine attiva nella pagina pubblica" : "Predefinita di fascia"}
                    </span>
                  </div>
                </div>
                <Link href="/area-riservata/referente/immagini" className="adm-dash__check-action">
                  {unita.copertina ? "Aggiorna" : "Carica"}
                </Link>
              </div>

              <div className="adm-dash__check-row">
                <div className="adm-dash__check-info">
                  <span className="adm-dash__check-status adm-dash__check-status--ok">
                    <Icona nome="spunta" misura={13} />
                  </span>
                  <div>
                    <strong className="adm-dash__check-label">Recapiti e sede</strong>
                    <span className="adm-dash__check-desc">{unita.ritrovo || "Sede di gruppo"}</span>
                  </div>
                </div>
                <Link href="/area-riservata/referente/presentazione" className="adm-dash__check-action">
                  Verifica
                </Link>
              </div>

              <div className="adm-dash__check-row">
                <div className="adm-dash__check-info">
                  <span className="adm-dash__check-status adm-dash__check-status--ok">
                    <Icona nome="spunta" misura={13} />
                  </span>
                  <div>
                    <strong className="adm-dash__check-label">Referenti dell’unità</strong>
                    <span className="adm-dash__check-desc">{unita.referente} ({unita.ruoloReferente})</span>
                  </div>
                </div>
                <Link href="/area-riservata/referente/presentazione" className="adm-dash__check-action">
                  Gestisci
                </Link>
              </div>

              <div className="adm-dash__check-row">
                <div className="adm-dash__check-info">
                  <span className="adm-dash__check-status adm-dash__check-status--warn">!</span>
                  <div>
                    <strong className="adm-dash__check-label">Consensi per le foto</strong>
                    <span className="adm-dash__check-desc">
                      {iscritti.length > 0 ? `${consensiOk}/${iscritti.length} registrati` : "Controllare i moduli prima degli album"}
                    </span>
                  </div>
                </div>
                <Link href="/area-riservata/referente/iscritti" className="adm-dash__check-action">
                  Apri
                </Link>
              </div>
            </div>
          </div>

          {/* Ultime modifiche / Attività recenti */}
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">Attività recenti</h3>
                <span className="adm-dash__section-subtitle">
                  Ultime operazioni effettuate dal tuo account
                </span>
              </div>
            </div>

            {registro.length === 0 ? (
              <div className="adm-dash__empty-muted">
                <p>Nessuna operazione registrata di recente.</p>
                <span>Ogni salvataggio di attività, album o documenti comparirà qui in automatico.</span>
              </div>
            ) : (
              <div className="adm-dash__timeline">
                {registro.slice(0, 5).map((r, i) => (
                  <div key={i} className="adm-dash__timeline-item">
                    <span
                      className="adm-dash__timeline-time"
                      title={quandoLeggibile(r.quando)}
                    >
                      {quantoFa(r.quando, adesso)}
                    </span>
                    <div className="adm-dash__timeline-body">
                      <strong className="adm-dash__timeline-op">{r.operazione}</strong>
                      <span className="adm-dash__timeline-sec">{r.origine}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard completa per il Referente Gruppo.
 */
async function DashboardGestore({ sessione }: { sessione: Sessione }) {
  const fotoAccese = await albumAttivi();
  const identita = await leggiIdentita();
  const tutteLeUnita = await leggiUnita();

  // Caricamento parallelo
  const [
    tuttiAlbum,
    tuttiDocumenti,
    tutteAttivita,
    proposte,
    personeRev,
    registro,
    messaggi,
    dalSocial,
  ] = await Promise.all([
    leggiSe("album-carica", leggiAlbum),
    leggiSe("documenti", leggiDocumenti),
    leggiSe("attivita", leggiAttivita),
    leggiSe("unita-scheda", leggiProposte),
    leggiSe("referenti", personeInRevisione),
    leggiSe("registro", leggiRegistro),
    leggiSe("messaggi", elencoMessaggi),
    // testi delle pagine, domande frequenti e fotografie proposte (`proposte`)
    leggiSe("album-pubblica", leggiProposteInAttesa),
  ]);

  const tuttiIscritti = await leggiSe("iscritti-elenco", elencoIscritti);

  // Coda approvazioni
  // con gli album spenti la coda non li conta: non c'è una schermata in cui
  // approvarli, e un numero che non porta da nessuna parte è un falso allarme
  const albumInRevisione = fotoAccese ? tuttiAlbum.filter((a) => a.stato === "in-revisione") : [];
  const docInRevisione = tuttiDocumenti.filter((d) => d.stato === "in-revisione");
  const attInRevisione = tutteAttivita.filter((a) => a.stato === "in-revisione");
  const totaleInCoda =
    albumInRevisione.length +
    docInRevisione.length +
    attInRevisione.length +
    proposte.length +
    personeRev.reduce((acc, p) => acc + p.proposte.length, 0) +
    dalSocial.length;

  const messaggiDaLeggere = messaggi.filter((m) => m.stato === "da_leggere");
  const totaleTesserati = tuttiIscritti.length > 0
    ? tuttiIscritti.length
    : tutteLeUnita.reduce((acc, u) => acc + (u.iscritti || 0), 0);

  const adesso = Date.now();

  /* Quanti sono, e su quante fasce. Erano scritti a mano — «6 Unità attive»,
     «Distribuiti su 6 unità e 3 fasce educative», «Le 6 Unità del Gruppo» —
     e sono i numeri che una dashboard non può inventarsi: bastava chiudere
     un'unità o aprirne una nuova e la schermata diceva una cosa falsa
     con l'aria di averla contata. `leggiUnita()` è già stato letto qui sopra.
     Le fasce si contano dalle unità presenti e non dalle quattro dichiarate
     in `FASCE`, perché una di quelle è «gruppo», che non è una fascia
     educativa ma l'insieme. */
  const quanteUnita = tutteLeUnita.length;
  const quanteFasce = new Set(
    tutteLeUnita.map((u) => u.fascia).filter((b) => b !== "gruppo"),
  ).size;

  return (
    <div className="adm-dash">
      {/* Banner di Benvenuto Direzione di Gruppo */}
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
              <span className="adm-dash__pill adm-dash__pill--dark">
                Direzione di Gruppo
              </span>
              <span className="adm-dash__pill adm-dash__pill--gold">
                Label
              </span>
              <span className="adm-dash__pill adm-dash__pill--outline">
                {quanteUnita} {accorda(quanteUnita, "unità attiva", "unità attive")}
              </span>
            </div>
            <h2 className="adm-dash__hero-title">
              Buon lavoro, {sessione.n}!
            </h2>
            <p className="adm-dash__hero-sub">
              Pannello di coordinamento generale del <strong>{identita.nome}</strong>.
            </p>
          </div>
        </div>
        <div className="adm-dash__hero-actions">
          <Link href="/" target="_blank" className="adm-btn adm-dash__btn-accent">
            Apri sito pubblico ↗
          </Link>
          <Link href="/area-riservata/gestore/approvazioni" className="adm-btn adm-btn--primary">
            Coda approvazioni ({totaleInCoda})
          </Link>
        </div>
      </div>

      {/* Indicatori Direzione di Gruppo */}
      <div className="adm-dash__kpis">
        <div className={`adm-dash__kpi-card ${totaleInCoda > 0 ? "adm-dash__kpi-card--alert" : ""}`}>
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="coda" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Approvazioni</span>
          </div>
          <div className={`adm-dash__kpi-number ${totaleInCoda > 0 ? "adm-dash__kpi-number--alert" : ""}`}>
            {totaleInCoda}
          </div>
          <div className="adm-dash__kpi-label">Voci in attesa di revisione</div>
          <div className="adm-dash__kpi-meta">
            <span>
              {fotoAccese ? `${albumInRevisione.length} album · ` : ""}
              {docInRevisione.length}{" "}
              {accorda(docInRevisione.length, "circolare", "circolari")} ·{" "}
              {attInRevisione.length} attività
              {dalSocial.length > 0
                ? ` · ${dalSocial.length} ${accorda(dalSocial.length, "testo o foto del sito", "testi o foto del sito")}`
                : ""}
            </span>
          </div>
          <Link href="/area-riservata/gestore/approvazioni" className="adm-dash__kpi-link">
            Revisiona e pubblica →
          </Link>
        </div>

        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="messaggio" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Messaggi</span>
          </div>
          <div className="adm-dash__kpi-number">{messaggi.length}</div>
          <div className="adm-dash__kpi-label">Richieste dal sito pubblico</div>
          <div className="adm-dash__kpi-meta">
            <span>
              <strong>{messaggiDaLeggere.length}</strong>{" "}
              {accorda(
                messaggiDaLeggere.length,
                "messaggio ancora da leggere",
                "messaggi ancora da leggere",
              )}
            </span>
          </div>
          <Link href="/area-riservata/gestore/messaggi" className="adm-dash__kpi-link">
            Apri casella messaggi →
          </Link>
        </div>

        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="persone" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Tesseramento</span>
          </div>
          <div className="adm-dash__kpi-number">{totaleTesserati}</div>
          <div className="adm-dash__kpi-label">Tesserati totali del gruppo</div>
          <div className="adm-dash__kpi-meta">
            <span>
              Distribuiti su {quanteUnita} unità e {quanteFasce}{" "}
              {accorda(quanteFasce, "fascia educativa", "fasce educative")}
            </span>
          </div>
          <Link href="/area-riservata/gestore/utenti" className="adm-dash__kpi-link">
            Utenti →
          </Link>
        </div>

        <div className="adm-dash__kpi-card">
          <div className="adm-dash__kpi-head">
            <span className="adm-dash__kpi-icon">
              <Icona nome="calendario" misura={20} />
            </span>
            <span className="adm-dash__kpi-tag">Attività</span>
          </div>
          <div className="adm-dash__kpi-number">{tutteAttivita.length}</div>
          <div className="adm-dash__kpi-label">Attività a calendario</div>
          <div className="adm-dash__kpi-meta">
            <span>Uscite, vacanze e campi di gruppo e di unità</span>
          </div>
          <Link href="/area-riservata/gestore/calendario" className="adm-dash__kpi-link">
            Calendario generale →
          </Link>
        </div>
      </div>

      {/* Scorciatoie di Gruppo */}
      <div className="adm-dash__quickbar">
        <span className="adm-dash__quickbar-title">Azioni rapide di gruppo</span>
        <div className="adm-dash__quickbar-actions">
          <Link href="/area-riservata/gestore/approvazioni" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="coda" misura={15} />
            </span>
            <span>Coda approvazioni</span>
          </Link>
          <Link href="/area-riservata/gestore/messaggi" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="messaggio" misura={15} />
            </span>
            <span>Messaggi dal sito</span>
          </Link>
          <Link href="/area-riservata/gestore/calendario" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="calendario" misura={15} />
            </span>
            <span>Nuova data di gruppo</span>
          </Link>
          <Link href="/area-riservata/gestore/utenti" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="persone" misura={15} />
            </span>
            <span>Gestisci gli utenti</span>
          </Link>
          <Link href="/area-riservata/gestore/identita" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="etichetta" misura={15} />
            </span>
            <span>Dati del gruppo</span>
          </Link>
          <Link href="/area-riservata/gestore/unita" className="adm-dash__action-btn">
            <span className="adm-dash__action-symbol">
              <Icona nome="elenco" misura={15} />
            </span>
            <span>Anagrafica unità</span>
          </Link>
        </div>
      </div>

      {/* Due Colonne: Panoramica Unità & Audit Log */}
      <div className="adm-dash__grid">
        <div className="adm-dash__col-main">
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">
                  {accorda(quanteUnita, "L’unità", `Le ${quanteUnita} unità`)} del{" "}
                  {identita.nome}
                </h3>
                <span className="adm-dash__section-subtitle">
                  Stato e collegamenti diretti alla gestione di ciascuna unità
                </span>
              </div>
              <Link href="/area-riservata/gestore/referenti" className="adm-btn">
                Tutti i recapiti →
              </Link>
            </div>

            <div className="adm-dash__units-grid">
              {tutteLeUnita.map((u) => {
                const b = fascia(u.fascia as FasciaKey);
                return (
                  <div
                    key={u.chiave}
                    className="adm-dash__unit-card"
                    style={{ borderTopColor: b.colore }}
                  >
                    <div className="adm-dash__unit-top">
                      <img
                        src={`/assets/${u.logo}`}
                        alt={u.nome}
                        width={40}
                        height={40}
                        className="adm-dash__unit-logo"
                      />
                      <div>
                        <h4 className="adm-dash__unit-name">{u.nome}</h4>
                        <span
                          className="adm-dash__unit-branch"
                          style={{ color: `light-dark(${b.accento}, ${b.accentoScuro})` }}
                        >
                          {u.ramo} · {u.eta}
                        </span>
                      </div>
                    </div>
                    <div className="adm-dash__unit-details">
                      <div>
                        <span className="adm-dash__unit-meta-label">Referente di unità:</span>{" "}
                        <strong>{u.referente}</strong>
                      </div>
                      <div>
                        <span className="adm-dash__unit-meta-label">Iscritti:</span>{" "}
                        <strong>{u.iscritti} ragazzi</strong>
                      </div>
                      <div>
                        <span className="adm-dash__unit-meta-label">Copertina:</span>{" "}
                        <span
                          className={
                            u.copertina
                              ? "adm-dash__copertina adm-dash__copertina--ok"
                              : "adm-dash__copertina"
                          }
                        >
                          {u.copertina ? (
                            <>
                              <Icona nome="spunta" misura={12} /> Caricata
                            </>
                          ) : (
                            "— Predefinita"
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="adm-dash__unit-links">
                      <Link
                        href={`/area-riservata/gestore/referenti?u=${u.chiave}`}
                        className="adm-btn adm-dash__btn-sm"
                      >
                        Recapiti
                      </Link>
                      <Link
                        href={`/area-riservata/gestore/unita?u=${u.chiave}`}
                        className="adm-btn adm-dash__btn-sm"
                      >
                        Anagrafica
                      </Link>
                      <Link
                        href={`/unita/${u.slug}`}
                        target="_blank"
                        className="adm-btn adm-dash__btn-sm"
                      >
                        Sito ↗
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="adm-dash__col-side">
          {/* Coda rapida di approvazione */}
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">In attesa di conferma</h3>
                <span className="adm-dash__section-subtitle">
                  Richieste di pubblicazione da validare
                </span>
              </div>
            </div>

            {totaleInCoda === 0 ? (
              <div className="adm-dash__empty-ok">
                <span className="adm-dash__empty-icon">
                  <Icona nome="spunta" misura={24} />
                </span>
                <strong>Coda approvazioni in pari</strong>
                <span>Nessun contenuto in attesa di approvazione.</span>
              </div>
            ) : (
              <div className="adm-dash__coda-preview">
                {albumInRevisione.map((a) => (
                  <div key={a.slug} className="adm-dash__coda-item">
                    <span className="adm-dash__pill adm-dash__pill--warn">Album</span>
                    <strong>{a.titolo}</strong>
                    <span className="adm-dash__coda-meta">{labelDiUnita(a.unita)}</span>
                  </div>
                ))}
                {docInRevisione.map((d) => (
                  <div key={d.id} className="adm-dash__coda-item">
                    <span className="adm-dash__pill adm-dash__pill--warn">Circolare</span>
                    <strong>{d.titolo}</strong>
                    <span className="adm-dash__coda-meta">{d.anno}</span>
                  </div>
                ))}
                {attInRevisione.map((a) => (
                  <div key={a.id} className="adm-dash__coda-item">
                    <span className="adm-dash__pill adm-dash__pill--warn">Attività</span>
                    <strong>{a.titolo}</strong>
                    <span className="adm-dash__coda-meta">{a.giorno} {a.mese}</span>
                  </div>
                ))}
                <Link href="/area-riservata/gestore/approvazioni" className="adm-btn adm-btn--primary adm-dash__btn-block">
                  Apri coda e approva ({totaleInCoda}) →
                </Link>
              </div>
            )}
          </div>

          {/*
            «Da sapere»: quello che l'amministratore ha fatto con i privilegi che
            il gestore non ha — matrice dei permessi, account di pari grado,
            cancellazioni dei dati, accessi eccezionali agli elenchi. È la
            notifica dell'audit degli accessi (SoD-3, M-5, M-8), dentro il sito:
            un registro che nessuno guarda non controlla niente.
          */}
          {daSapere(registro, adesso).length > 0 ? (
            <div className="adm-dash__section-box">
              <div className="adm-dash__section-head">
                <div>
                  <h3 className="adm-dash__section-title">Da sapere</h3>
                  <span className="adm-dash__section-subtitle">
                    Permessi, account, cancellazioni e accessi eccezionali degli ultimi 30 giorni
                  </span>
                </div>
              </div>
              <div className="adm-dash__timeline">
                {daSapere(registro, adesso)
                  .slice(0, 8)
                  .map((r, i) => (
                    <div key={i} className="adm-dash__timeline-item">
                      <span className="adm-dash__timeline-time" title={quandoLeggibile(r.quando)}>
                        {quantoFa(r.quando, adesso)}
                      </span>
                      <div className="adm-dash__timeline-body">
                        <strong className="adm-dash__timeline-op">{r.operazione}</strong>
                        <span className="adm-dash__timeline-sec">
                          {r.nome} · {r.origine}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          {/* Registro generale di gruppo */}
          <div className="adm-dash__section-box">
            <div className="adm-dash__section-head">
              <div>
                <h3 className="adm-dash__section-title">Ultime operazioni di gruppo</h3>
                <span className="adm-dash__section-subtitle">
                  Registro globale accessi e modifiche
                </span>
              </div>
              {/* era la vista dello sviluppatore, che rimandava indietro (audit, B-2) */}
              <Link href="/area-riservata/gestore/log" className="adm-btn adm-dash__btn-sm">
                Log completo
              </Link>
            </div>

            <div className="adm-dash__timeline">
              {registro.slice(0, 6).map((r, i) => (
                <div key={i} className="adm-dash__timeline-item">
                  <span className="adm-dash__timeline-time" title={quandoLeggibile(r.quando)}>
                    {quantoFa(r.quando, adesso)}
                  </span>
                  <div className="adm-dash__timeline-body">
                    <strong className="adm-dash__timeline-op">{r.operazione}</strong>
                    <span className="adm-dash__timeline-sec">
                      {r.nome} · {r.origine}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
