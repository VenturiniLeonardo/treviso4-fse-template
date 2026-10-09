import Link from "next/link";
import {
  ETICHETTA_TIPO,
  quandoCompleto,
  quandoLeggibile,
  quantoFa,
  STILE_TIPO,
  type TipoOperazione,
  type Voce,
} from "@/lib/registro";

/**
 * Il registro delle operazioni, nelle due forme in cui serve.
 *
 * È l'unica tabella dell'area riservata che si riempie da sola e di dati veri:
 * ogni azione che scrive lascia una riga. Per questo non ha «Modifica» né
 * «Elimina» — un registro che si corregge non prova niente — ma ha i filtri,
 * che sono quello che serve davvero quando le righe diventano centinaia.
 */

function Vuoto({ testo }: { testo: string }) {
  return (
    <div className="adm-table__box">
      <div className="adm-tr adm-tr--vuota">
        <span className="c-muted">{testo}</span>
      </div>
    </div>
  );
}

/** Forma breve: le ultime cose fatte da chi sta guardando. */
export function UltimeModifiche({ voci, adesso }: { voci: Voce[]; adesso: number }) {
  const ultime = voci.slice(0, 8);

  return (
    <div className="adm-table">
      <div className="adm-table__head">
        <h2>Ultime modifiche</h2>
        <span className="adm-table__meta">
          {voci.length === 0 ? "registro personale" : `le vostre ultime ${ultime.length} operazioni`}
        </span>
      </div>

      {ultime.length === 0 ? (
        <Vuoto testo="Non avete ancora fatto niente da registrare. Ogni modifica che salvate comparirà qui." />
      ) : (
        <div className="adm-table__box">
          <div className="adm-tr adm-tr--head" style={{ gridTemplateColumns: GRIGLIA_BREVE }}>
            <span className="adm-th">Quando</span>
            <span className="adm-th">Operazione</span>
            <span className="adm-th">Sezione</span>
          </div>
          {ultime.map((v, i) => (
            <div className="adm-tr" style={{ gridTemplateColumns: GRIGLIA_BREVE }} key={i}>
              <span className="c-mono" title={quandoLeggibile(v.quando)}>
                {quantoFa(v.quando, adesso)}
              </span>
              <span className="c-txt">{v.operazione}</span>
              <span className={`c-${STILE_TIPO[v.tipo]} c-a-destra`}>{v.origine}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const GRIGLIA_BREVE = "130px minmax(0, 1fr) 160px";
const GRIGLIA_PIENA = "110px minmax(150px, 0.8fr) minmax(0, 2fr) 120px 110px";
/** Con l'IP: la data per intero è più larga, e c'è una colonna in più. */
const GRIGLIA_SVILUPPATORE =
  "160px minmax(130px, 0.7fr) minmax(0, 2fr) minmax(110px, 0.6fr) 110px 110px";

/**
 * Gli indicatori in cima al registro: calcolati, non scritti.
 *
 * È la differenza fra un cruscotto e una decorazione — questi quattro numeri si
 * ricavano dalle stesse voci mostrate sotto, quindi non possono mentire.
 */
export function IndicatoriRegistro({ voci, adesso }: { voci: Voce[]; adesso: number }) {
  const ultimeOre = voci.filter((v) => v.quando > adesso - 24 * 60 * 60 * 1000);
  const oggi = new Date(adesso).setHours(0, 0, 0, 0);

  const celle = [
    { label: "Eventi 24 h", valore: ultimeOre.length },
    {
      label: "Accessi oggi",
      valore: voci.filter((v) => v.tipo === "accesso" && !v.esito && v.quando >= oggi).length,
    },
    {
      label: "Accessi negati",
      valore: voci.filter((v) => v.esito === "rifiutato").length,
      allarme: true,
    },
    { label: "Voci in registro", valore: voci.length },
  ];

  return (
    <div className="adm-kpi">
      {celle.map((c) => (
        <div className="adm-kpi__cell" key={c.label}>
          <span className="adm-kpi__label">{c.label}</span>
          <span
            className={
              c.allarme && c.valore > 0 ? "adm-kpi__value adm-kpi__value--red" : "adm-kpi__value"
            }
          >
            {c.valore}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Forma piena: tutto il registro, con i filtri. */
export function RegistroPieno({
  voci,
  totale,
  percorso,
  utenti,
  filtri,
  conIndirizzi = false,
}: {
  voci: Voce[];
  totale: number;
  percorso: string;
  utenti: { utente: string; nome: string }[];
  filtri: { utente?: string; tipo?: string; giorni?: number };
  /** la vista dello sviluppatore: data completa e indirizzo IP */
  conIndirizzi?: boolean;
}) {
  const griglia = conIndirizzi ? GRIGLIA_SVILUPPATORE : GRIGLIA_PIENA;
  const attivo = filtri.utente || filtri.tipo || filtri.giorni;

  /** Costruisce l'indirizzo del filtro, tenendo gli altri già scelti. */
  const con = (chiave: string, valore?: string) => {
    const q = new URLSearchParams();
    if (filtri.utente) q.set("chi", filtri.utente);
    if (filtri.tipo) q.set("che", filtri.tipo);
    if (filtri.giorni) q.set("quando", String(filtri.giorni));
    if (valore) q.set(chiave, valore);
    else q.delete(chiave);
    const s = q.toString();
    return s ? `${percorso}?${s}` : percorso;
  };

  const TIPI = Object.keys(ETICHETTA_TIPO) as TipoOperazione[];

  return (
    <>
      <div className="adm-filtri">
        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Chi</span>
          <Link className={pill(!filtri.utente)} href={con("chi")}>
            tutti
          </Link>
          {utenti.map((u) => (
            <Link
              key={u.utente}
              className={pill(filtri.utente === u.utente)}
              href={con("chi", u.utente)}
            >
              {u.nome}
            </Link>
          ))}
        </div>

        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Che cosa</span>
          <Link className={pill(!filtri.tipo)} href={con("che")}>
            tutto
          </Link>
          {TIPI.map((t) => (
            <Link key={t} className={pill(filtri.tipo === t)} href={con("che", t)}>
              {ETICHETTA_TIPO[t]}
            </Link>
          ))}
        </div>

        <div className="adm-filtri__riga">
          <span className="adm-filtri__etichetta">Quando</span>
          <Link className={pill(!filtri.giorni)} href={con("quando")}>
            sempre
          </Link>
          {[1, 7, 30].map((g) => (
            <Link key={g} className={pill(filtri.giorni === g)} href={con("quando", String(g))}>
              {g === 1 ? "oggi" : `ultimi ${g} giorni`}
            </Link>
          ))}
        </div>
      </div>

      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Ultime operazioni</h2>
          <span className="adm-table__meta">
            {attivo ? `${voci.length} di ${totale} voci` : `${totale} voci`}
          </span>
          {attivo ? (
            <span className="adm-table__comandi">
              <Link className="adm-btn" href={percorso}>
                Azzera i filtri
              </Link>
            </span>
          ) : null}
        </div>

        {voci.length === 0 ? (
          <Vuoto
            testo={
              attivo
                ? "Nessuna operazione con questi filtri."
                : "Il registro è vuoto: si riempie da solo alla prima modifica salvata."
            }
          />
        ) : (
          <div className="adm-table__box">
            <div className="adm-tr adm-tr--head" style={{ gridTemplateColumns: griglia }}>
              <span className="adm-th">Data</span>
              <span className="adm-th">Utente</span>
              <span className="adm-th">Operazione</span>
              <span className="adm-th">Origine</span>
              {conIndirizzi ? <span className="adm-th">IP</span> : null}
              <span className="adm-th">Tipo</span>
            </div>
            {voci.map((v, i) => (
              <div
                className={v.esito === "rifiutato" ? "adm-tr adm-tr--rifiutata" : "adm-tr"}
                style={{ gridTemplateColumns: griglia }}
                key={i}
              >
                <span className="c-mono">
                  {conIndirizzi ? quandoCompleto(v.quando) : quandoLeggibile(v.quando)}
                </span>
                <span className="c-strong" title={conIndirizzi ? `${v.utente} · ${v.ruolo}` : undefined}>
                  {v.nome}
                </span>
                <span className="c-txt">{v.operazione}</span>
                {/* Le ultime due celle vogliono la loro etichetta nella scheda
                    del telefono. Sul largo sono due colonne con
                    l'intestazione sopra — «Origine» e «Tipo» — e si capisce
                    che dicono due cose diverse: dov'è stato fatto, e che
                    genere di operazione era. Impilate senza intestazione
                    diventavano due righe identiche: sotto ogni voce degli
                    iscritti si leggeva «iscritti» e poi ancora «iscritti»,
                    che sembra un difetto invece di due informazioni. */}
                <span className="c-muted" data-etichetta="Origine">
                  {v.origine}
                </span>
                {conIndirizzi ? (
                  <span className="c-mono-dim" data-etichetta="IP">
                    {v.indirizzo ?? "—"}
                  </span>
                ) : null}
                <span className={`c-${STILE_TIPO[v.tipo]} c-a-destra`} data-etichetta="Tipo">
                  {ETICHETTA_TIPO[v.tipo]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const pill = (attivo: boolean) => (attivo ? "adm-pillfiltro is-attivo" : "adm-pillfiltro");
