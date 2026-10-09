"use client";

import clsx from "clsx";
import { useActionState } from "react";
import { verificaModulo } from "@/app/(area)/area-riservata/iscritti/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";

/**
 * La verifica a campione dei consensi (audit degli accessi, I-1).
 *
 * Il consenso alle immagini lo registra il referente di unità, con la data della firma;
 * il gestore pubblica le fotografie fidandosi di quella riga. Il modulo
 * firmato resta di carta, in sede — niente scansioni sul server, decisione del
 * 7 ottobre 2026 —, e questo riquadro è il modo di controllare che ci sia:
 * ogni settimana il sistema estrae qualche consenso, chi verifica cerca il
 * modulo e dice se l'ha trovato.
 *
 * Chi verifica vede **solo** il campione: nome, unità, data della firma e dove
 * dovrebbe stare il modulo. L'elenco degli iscritti resta del referente di unità.
 */

export interface VoceCampione {
  id: number;
  nome: string;
  unita: string;
  firmatoIl: string;
  modulo: string;
}

export interface VoceMancante {
  id: number;
  nome: string;
  unita: string;
  quando: string;
  da: string;
}

function Esame({ voce, esito, children, primary }: {
  voce: { id: number };
  esito: "conforme" | "mancante";
  children: React.ReactNode;
  primary?: boolean;
}) {
  const [stato, invia, inCorso] = useActionState(verificaModulo, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      <input type="hidden" name="id" value={voce.id} />
      <input type="hidden" name="esito" value={esito} />
      <button
        className={clsx("adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso}
      >
        {children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

export function VerificaConsensi({
  anno,
  consensi,
  verificati,
  campione,
  mancanti,
}: {
  /** l'anno sociale, come lo scrive il sito: «2026 – 2027» */
  anno: string;
  consensi: number;
  verificati: number;
  campione: VoceCampione[];
  mancanti: VoceMancante[];
}) {
  return (
    <div className="adm-table">
      <div className="adm-table__head">
        <h2>Verifica a campione dei consensi</h2>
        <span className="adm-table__meta">
          anno {anno} · {verificati} verificati su {consensi}{" "}
          {consensi === 1 ? "consenso" : "consensi"}
        </span>
      </div>
      <span className="adm-note">
        Ogni settimana il sito estrae qualche consenso registrato. Cercate in sede il modulo
        firmato e dite se c’è: data e firma devono corrispondere. Il campione cambia il lunedì;
        i consensi che avete registrato voi non vi vengono proposti.
      </span>

      <div className="adm-table__box">
        {campione.length === 0 ? (
          <div className="adm-tr adm-tr--vuota">
            <span className="c-muted">
              {consensi === 0
                ? "Quest’anno non ci sono ancora consensi registrati."
                : "Niente da verificare: i consensi di quest’anno sono già stati controllati."}
            </span>
          </div>
        ) : (
          campione.map((v) => (
            <div
              className="adm-tr"
              key={v.id}
              style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) auto" }}
            >
              <span>
                <strong>{v.nome}</strong>
                <br />
                <span className="c-muted adm-note">
                  {v.unita} · firmato il {v.firmatoIl}
                </span>
              </span>
              <span className="c-muted">{v.modulo || "dove sta il modulo: non indicato"}</span>
              <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <Esame voce={v} esito="conforme" primary>
                  Modulo trovato
                </Esame>
                <Esame voce={v} esito="mancante">
                  Non c’è
                </Esame>
              </span>
            </div>
          ))
        )}
      </div>

      {mancanti.length > 0 ? (
        <div className="adm-notice" role="alert" style={{ flexDirection: "column", gap: "8px" }}>
          <span className="adm-notice__tag">Moduli non trovati</span>
          <p>
            Per questi consensi il modulo non si è trovato. Il consenso resta registrato — può
            essere solo fuori posto — ma il referente di unità lo vede accanto al nome: se il modulo
            non salta fuori, il consenso va revocato, e gli album di quell’unità tornano in
            bozza. Se lo ritrovate voi, segnatelo qui.
          </p>
          {mancanti.map((m) => (
            <div
              key={m.id}
              style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}
            >
              <span>
                <strong>{m.nome}</strong> · {m.unita} · verificato il {m.quando}
                {m.da ? ` da ${m.da}` : ""}
              </span>
              <Esame voce={m} esito="conforme">
                Ritrovato
              </Esame>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
