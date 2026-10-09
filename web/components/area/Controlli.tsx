/**
 * I controlli di sistema, in riquadri: uno per gruppo.
 *
 * Stavano nella dashboard dello sviluppatore, tutti e sette i gruppi, una
 * quarantina di righe. Adesso la dashboard mostra solo quelli che non sono a
 * posto (§ DashboardSviluppatore.tsx), e l'elenco completo vive nella sezione
 * «Stato del sistema», che è il posto dove si va a leggere riga per riga.
 */

import { Icona, type NomeIcona } from "@/components/area/Icone";
import type { Controllo, EsitoControllo } from "@/lib/diagnostica";

export type GruppoControlli = Controllo["gruppo"];

export const TITOLO_GRUPPO: Record<GruppoControlli, string> = {
  motore: "Motore e archivio",
  sicurezza: "Sicurezza e accessi",
  servizi: "Servizi esterni",
  macchina: "Macchina",
  certificati: "Certificati HTTPS",
  cloudflare: "Cloudflare",
  ovh: "OVH",
};

const ICONA_GRUPPO: Record<GruppoControlli, NomeIcona> = {
  motore: "database",
  sicurezza: "scudo",
  servizi: "ingranaggio",
  macchina: "server",
  certificati: "lucchetto",
  cloudflare: "nuvola",
  ovh: "calendario",
};

export const ICONA_ESITO: Record<EsitoControllo, NomeIcona> = {
  ok: "spunta",
  aperto: "attesa",
  guasto: "allarme",
};

/**
 * Un controllo, in riga.
 *
 * Il segno è un'icona e non una lettera, ma il segno **non è l'unica
 * informazione**: accanto c'è sempre il valore misurato in monospazio e sotto
 * la nota. Un pallino colorato da solo lascerebbe fuori chi non distingue il
 * giallo dal verde.
 */
export function RigaControllo({ c, conGruppo = false }: { c: Controllo; conGruppo?: boolean }) {
  return (
    <div className="adm-dash__check-row">
      <div className="adm-dash__check-info">
        <span className={`adm-dash__check-status adm-dash__check-status--${c.esito}`}>
          <Icona nome={ICONA_ESITO[c.esito]} misura={13} />
        </span>
        <div>
          <strong className="adm-dash__check-label">
            {conGruppo ? <span className="adm-dash__check-gruppo">{TITOLO_GRUPPO[c.gruppo]} · </span> : null}
            {c.cosa}
          </strong>
          <span className="adm-dash__check-desc">{c.nota}</span>
        </div>
      </div>
      <span className="adm-dash__check-valore">{c.valore}</span>
    </div>
  );
}

/** L'esito peggiore di un gruppo: con un guasto e otto righe a posto, è rosso. */
export function esitoPeggiore(controlli: Controllo[]): EsitoControllo {
  if (controlli.some((c) => c.esito === "guasto")) return "guasto";
  if (controlli.some((c) => c.esito === "aperto")) return "aperto";
  return "ok";
}

/** Un riquadro con i controlli di un gruppo, e il conto in testa. */
export function RiquadroControlli({ gruppo, controlli }: { gruppo: GruppoControlli; controlli: Controllo[] }) {
  const aPosto = controlli.filter((c) => c.esito === "ok").length;
  const stato = esitoPeggiore(controlli);

  return (
    <div className="adm-dash__section-box">
      <div className="adm-dash__section-head">
        <div className="adm-dash__gruppo-titolo">
          <span className="adm-dash__gruppo-icona">
            <Icona nome={ICONA_GRUPPO[gruppo]} misura={17} />
          </span>
          <div>
            <h3 className="adm-dash__section-title">{TITOLO_GRUPPO[gruppo]}</h3>
            <span className="adm-dash__section-subtitle">
              {aPosto} {aPosto === 1 ? "controllo" : "controlli"} su {controlli.length} a posto
            </span>
          </div>
        </div>
        <span className={`adm-dash__pill adm-dash__pill--esito-${stato}`}>
          {stato === "ok" ? "tutto a posto" : stato === "aperto" ? "da configurare" : "da guardare"}
        </span>
      </div>
      <div className="adm-dash__checklist">
        {controlli.map((c) => (
          <RigaControllo key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}
