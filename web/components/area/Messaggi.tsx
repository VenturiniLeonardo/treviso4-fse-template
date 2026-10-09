"use client";

import clsx from "clsx";
import { useActionState, useState } from "react";
import {
  eliminaMessaggio,
  segnaMessaggio,
} from "@/app/(area)/area-riservata/messaggi/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE, type StatoAzione } from "@/lib/contenuti";
import { quantoFa } from "@/lib/registro";
import { emailValida } from "@/lib/email";

/**
 * I messaggi arrivati dal modulo contatti.
 *
 * Non è una tabella da modificare: è posta da leggere. Per questo il testo si
 * vede per intero e non troncato in una colonna, e i due pulsanti principali
 * sono «rispondi» — che apre il programma di posta con l'indirizzo già dentro —
 * e «segna come risposto».
 *
 * **Chi scrive non riceve una notifica automatica.** Il modulo pubblico glielo
 * dice, e lo dice anche qui in cima: se questa schermata non la apre nessuno
 * per due settimane, nessuno se ne accorge. È l'unico modo di non far diventare
 * il silenzio una sorpresa.
 */

export interface VoceMessaggio {
  id: number;
  quando: string;
  nome: string;
  email: string;
  telefono: string;
  motivo: string;
  motivoLabel: string;
  messaggio: string;
  stato: "da_leggere" | "letto" | "risposto";
}

const PILL: Record<VoceMessaggio["stato"], string> = {
  da_leggere: "adm-pill adm-pill--wait",
  letto: "adm-pill",
  risposto: "adm-pill adm-pill--ok",
};

const ETICHETTA: Record<VoceMessaggio["stato"], string> = {
  da_leggere: "da leggere",
  letto: "letto",
  risposto: "risposto",
};

/** Un pulsante che è una Server Action con dei campi nascosti. */
function Comando({
  azione,
  campi,
  children,
  primary,
  conferma,
}: {
  azione: (stato: StatoAzione, dati: FormData) => Promise<StatoAzione>;
  campi: Record<string, string>;
  children: React.ReactNode;
  primary?: boolean;
  conferma?: string;
}) {
  const [stato, invia, inCorso] = useActionState(azione, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      {Object.entries(campi).map(([n, v]) => (
        <input type="hidden" name={n} value={v} key={n} />
      ))}
      <button
        className={clsx("adm-btn", primary && "adm-btn--primary")}
        type="submit"
        disabled={inCorso}
        onClick={(e) => {
          if (conferma && !window.confirm(conferma)) e.preventDefault();
        }}
      >
        {children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

export function Messaggi({
  voci,
  adesso,
  avvisiAttivi,
}: {
  voci: VoceMessaggio[];
  adesso: number;
  /**
   * Vero se la posta di §9 è configurata su questa installazione.
   *
   * Arriva dal server e non si deduce qui: è una variabile d'ambiente, e un
   * componente client non la vede. Cambia la fascia in cima, che è la sola
   * cosa in questa schermata che diceva una bugia appena la posta è stata
   * collegata.
   */
  avvisiAttivi: boolean;
}) {
  const [filtro, setFiltro] = useState<"tutti" | VoceMessaggio["stato"]>("tutti");
  const visibili = filtro === "tutti" ? voci : voci.filter((v) => v.stato === filtro);
  const daLeggere = voci.filter((v) => v.stato === "da_leggere").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="adm-notice">
        <span className="adm-notice__tag">Da sapere</span>
        {avvisiAttivi ? (
          <p>
            Quando qualcuno scrive dal sito, <strong>il messaggio intero arriva per posta</strong>{" "}
            all’indirizzo configurato, con nome, recapiti e testo: si risponde da lì, con
            «Rispondi». Qui ne resta una copia. Se l’invio per posta non riesce, il messaggio
            si salva comunque e lo trovate in questo elenco.
          </p>
        ) : (
          <p>
            Quando qualcuno scrive dal sito, <strong>nessuno riceve una notifica</strong>: il
            messaggio arriva qui e basta, perché la posta automatica non è configurata su
            questa installazione. Quindi questa schermata va guardata ogni tanto. Chi scrive
            lo sa — glielo diciamo — e ha anche l’indirizzo dei gestori per le cose
            urgenti.
          </p>
        )}
      </div>

      <div className="adm-actions">
        {(["tutti", "da_leggere", "letto", "risposto"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={clsx("adm-btn", filtro === f && "adm-btn--primary")}
            onClick={() => setFiltro(f)}
          >
            {f === "tutti" ? `tutti (${voci.length})` : ETICHETTA[f]}
            {f === "da_leggere" && daLeggere > 0 ? ` (${daLeggere})` : ""}
          </button>
        ))}
      </div>

      {visibili.length === 0 ? (
        <div className="adm-table__box">
          <div className="adm-tr adm-tr--vuota">
            <span className="c-muted">
              {voci.length === 0
                ? "Nessun messaggio. Quando qualcuno scrive dalla pagina Contatti, compare qui."
                : "Nessun messaggio con questo stato."}
            </span>
          </div>
        </div>
      ) : null}

      {visibili.map((v) => (
        <article key={v.id} className="adm-form">
          <div className="adm-table__head">
            <h2>{v.nome}</h2>
            <span className="adm-table__meta">
              <span className={PILL[v.stato]}>{ETICHETTA[v.stato]}</span>{" "}
              {v.motivoLabel} · {quantoFa(Date.parse(v.quando), adesso)}
            </span>
          </div>

          {/* `pre-line`: chi scrive va a capo, e le sue righe sono parte del
              messaggio. Schiacciarle in un paragrafo unico rende illeggibile
              un elenco di domande, che è la forma più comune di questi testi. */}
          <p className="adm-note" style={{ whiteSpace: "pre-line" }}>
            {v.messaggio}
          </p>

          <p className="adm-note">
            {/* L'indirizzo l'ha scritto un anonimo nel modulo pubblico: si
                codifica, e si rende cliccabile solo se è un indirizzo. Senza,
                un «?bcc=…» dentro il campo aggiungeva destinatari e testo
                alla bozza di chi rispondeva (audit di sicurezza, WEB-02). */}
            {emailValida(v.email) ? (
              <a
                href={`mailto:${encodeURIComponent(v.email).replace("%40", "@")}?subject=${encodeURIComponent(`Re: ${v.motivoLabel}`)}`}
              >
                {v.email}
              </a>
            ) : (
              v.email
            )}
            {v.telefono ? ` · ${v.telefono}` : ""}
          </p>

          <div className="adm-form__actions">
            {v.stato === "da_leggere" ? (
              <Comando azione={segnaMessaggio} campi={{ id: String(v.id), stato: "letto" }}>
                Segna come letto
              </Comando>
            ) : null}
            {v.stato !== "risposto" ? (
              <Comando
                azione={segnaMessaggio}
                campi={{ id: String(v.id), stato: "risposto" }}
                primary
              >
                Segna come risposto
              </Comando>
            ) : null}
            <Comando
              azione={eliminaMessaggio}
              campi={{ id: String(v.id) }}
              conferma={
                "Cancellare questo messaggio? Sparisce davvero, e con lui nome, " +
                "indirizzo e testo. Serve quando chi ha scritto chiede la cancellazione."
              }
            >
              Cancella
            </Comando>
          </div>
        </article>
      ))}
    </div>
  );
}
