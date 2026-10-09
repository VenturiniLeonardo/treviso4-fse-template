/**
 * La sezione «Stato del sistema»: tutti i controlli, riga per riga.
 *
 * È il posto dove si legge. La dashboard dello sviluppatore mostra il
 * verdetto e le sole righe che non sono a posto; qui ci sono tutte, divise
 * per gruppo, con l'ambiente in cui il processo gira e l'inventario del
 * database — le due cose che si guardano dopo un ripristino o un trasloco.
 *
 * Legge, non scrive. Sostituisce la tabella «Servizi» del prototipo, che era
 * vuota e aveva sotto un modulo per aggiungere righe a mano, mentre la nota
 * della sezione diceva che «lo stato dei servizi lo misura il sistema». I
 * controlli arrivano da `lib/stato-sistema.ts`, lo stesso posto da cui li
 * prende la dashboard: le due schermate non possono dire cose diverse.
 */

import Link from "next/link";
import { RiquadroControlli, type GruppoControlli } from "@/components/area/Controlli";
import { InterruttoreFoto } from "@/components/area/InterruttoreFoto";
import { ambiente, inventario } from "@/lib/diagnostica";
import { albumAttivi } from "@/lib/funzioni";
import { lavoriFalliti } from "@/lib/foto/coda";
import { statoSistema } from "@/lib/stato-sistema";

/** L'ordine dei gruppi: prima quello che sta dentro il processo, poi fuori. */
const ORDINE: GruppoControlli[] = ["motore", "sicurezza", "servizi", "macchina", "certificati", "cloudflare", "ovh"];

export async function StatoSistema() {
  const stato = await statoSistema();
  const amb = ambiente();
  const fotoAccese = await albumAttivi();
  const righe = inventario(fotoAccese);
  const falliti = lavoriFalliti();

  const guasti = stato.tutti.filter((c) => c.esito === "guasto").length;
  const aperti = stato.tutti.filter((c) => c.esito === "aperto").length;

  return (
    <>
      <div className="adm-kpi">
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">A posto</span>
          <span className="adm-kpi__value">
            {stato.tutti.length - guasti - aperti}/{stato.tutti.length}
          </span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Da configurare</span>
          <span className="adm-kpi__value">{aperti}</span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Guasti</span>
          <span className={guasti > 0 ? "adm-kpi__value adm-kpi__value--red" : "adm-kpi__value"}>{guasti}</span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Processo</span>
          <span className="adm-kpi__value">
            {amb.modo} · {amb.inPiediDa}
          </span>
        </div>
      </div>

      {/* Il percorso del database per intero, in monospazio: è la risposta a
          «sto guardando la macchina che credo?», e accorciarlo vorrebbe dire
          togliergli il senso. */}
      <div className="adm-filtro">
        <span>
          Node <strong>{amb.node}</strong> · database aperto: <code>{amb.database}</code>
        </span>
      </div>

      <InterruttoreFoto accesi={fotoAccese} />

      <div className="adm-dash__controlli">
        {ORDINE.map((g) => (
          <RiquadroControlli key={g} gruppo={g} controlli={stato.gruppi[g]} />
        ))}
      </div>

      {falliti.length > 0 ? (
        <div className="adm-notice">
          <span className="adm-notice__tag">Conversioni fallite</span>
          <p>
            Queste fotografie non hanno le versioni ridotte: la pagina serve l’originale, che è più
            pesante e porta con sé i metadati. Si riprovano dalla sezione «Album fotografici», nella
            scheda dell’album. {falliti.slice(0, 10).map((l) => l.file).join(", ")}
            {falliti.length > 10 ? ` e altre ${falliti.length - 10}.` : ""}
          </p>
        </div>
      ) : null}

      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Che cosa c’è nel database</h2>
          <span className="adm-table__meta">
            {righe === null
              ? "non misurabile"
              : `${righe.reduce((n, r) => n + r.righe, 0)} righe in tutto`}
          </span>
        </div>
        <div className="adm-table__box">
          {righe === null ? (
            <div className="adm-tr adm-tr--vuota">
              <span className="c-muted">Il database non risponde: il numero dei contenuti non è disponibile.</span>
            </div>
          ) : (
            <>
              <div className="adm-tr adm-tr--head" style={{ gridTemplateColumns: GRIGLIA }}>
                <span className="adm-th">Contenuto</span>
                <span className="adm-th">Tabella</span>
                <span className="adm-th">Righe</span>
              </div>
              {righe.map((r) => (
                <div key={r.tabella} className="adm-tr" style={{ gridTemplateColumns: GRIGLIA }}>
                  <span className="c-txt">{r.href ? <Link href={r.href}>{r.etichetta}</Link> : r.etichetta}</span>
                  <span className="c-mono-dim">{r.tabella}</span>
                  <span className="c-mono-right" data-etichetta="Righe">
                    {r.righe}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

const GRIGLIA = "minmax(0, 1fr) minmax(0, 1fr) 90px";
