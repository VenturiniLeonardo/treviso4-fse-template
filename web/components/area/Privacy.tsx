"use client";

import clsx from "clsx";
import Link from "next/link";
import { useActionState } from "react";
import {
  nuovaRichiesta,
  rimuoviRichiesta,
  segnaRichiesta,
} from "@/app/(area)/area-riservata/privacy/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE, DESCRIZIONE_GDPR_MAX, type StatoAzione } from "@/lib/contenuti";

/**
 * Privacy e consensi: il registro delle richieste, e il controllo di conformità.
 *
 * Due riquadri, e il primo è quello che conta: **gli album pubblicati che
 * violano la regola dei consensi**. Non dovrebbero esistere — il trigger lo
 * impedisce e la revoca li ritira — e proprio per questo un elenco che si
 * riempie è il segnale che qualcosa è entrato da una porta che non conosciamo.
 * Un controllo che dice sempre «zero» non è inutile: è la cosa che si guarda per
 * sapere che le altre funzionano.
 */

export interface VoceRichiesta {
  id: number;
  arrivataIl: string;
  diritto: string;
  dirittoLabel: string;
  descrizione: string;
  stato: string;
  statoLabel: string;
  chiusaIl: string | null;
  apertaDa: string | null;
  giorni: number;
}

export interface NonConforme {
  slug: string;
  titolo: string;
  nomi: string[];
}

const PILL: Record<string, string> = {
  ricevuta: "adm-pill adm-pill--wait",
  in_corso: "adm-pill adm-pill--wait",
  eseguita: "adm-pill adm-pill--ok",
  respinta: "adm-pill",
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

export function Privacy({
  richieste,
  diritti,
  nonConformi,
  giorniLimite,
  puoEliminare = false,
}: {
  richieste: VoceRichiesta[];
  diritti: { chiave: string; label: string }[];
  nonConformi: NonConforme[];
  giorniLimite: number;
  /**
   * Togliere una riga dal registro delle richieste: solo chi ha la riga `gdpr`.
   * Il gestore le apre e le segue, ma una richiesta registrata è anche la
   * prova che è arrivata, e non la cancella chi deve rispondere nei termini.
   */
  puoEliminare?: boolean;
}) {
  const [stato, crea, inCorso] = useActionState(nuovaRichiesta, AZIONE_INIZIALE);
  const invalido = (campo: string) => (stato.campo === campo ? true : undefined);
  const aperte = richieste.filter((r) => r.stato === "ricevuta" || r.stato === "in_corso");

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------------------------------------- conformità dei consensi */}
      {/* `.adm-notice` dispone in riga: qui dentro ci sono un paragrafo e un
          elenco, e vanno incolonnati. Due proprietà in `style` bastano, e
          non valgono una classe nuova in `admin.css`. */}
      <div
        className="adm-notice"
        style={{ flexDirection: "column", gap: "8px" }}
        role={nonConformi.length > 0 ? "alert" : undefined}
      >
        <span className="adm-notice__tag">
          {nonConformi.length > 0 ? "Da sistemare subito" : "Consensi"}
        </span>
        {nonConformi.length === 0 ? (
          <p>
            Nessun album pubblicato viola la regola dei consensi. Il controllo rilegge tutto
            da zero e non si fida di nessun percorso: se un giorno mostrasse qualcosa,
            vorrebbe dire che una riga è entrata da una porta che non conosciamo.
          </p>
        ) : (
          <>
            <p>
              {nonConformi.length === 1
                ? "Un album pubblicato contiene"
                : `${nonConformi.length} album pubblicati contengono`}{" "}
              un’unità e un anno in cui manca un consenso, e nessuno ha dichiarato quelle
              persone assenti. <strong>Non dovrebbe essere possibile</strong>: il database lo
              impedisce e la revoca ritira. Ritiratelo a mano e guardate come è arrivato lì.
            </p>
            <ul className="adm-note" style={{ listStyleType: "disc", paddingLeft: "1.4em" }}>
              {nonConformi.map((a) => (
                <li key={a.slug} style={{ marginBottom: "4px" }}>
                  <Link href={`/area-riservata/gestore/album?album=${a.slug}`}>
                    {a.titolo}
                  </Link>{" "}
                  — {a.nomi.join(" · ")}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ------------------------------------------------------- le richieste */}
      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Richieste degli interessati</h2>
          <span className="adm-table__meta">
            {aperte.length} aperte · {richieste.length} in tutto
          </span>
        </div>

        {richieste.length === 0 ? (
          <div className="adm-table__box">
            <div className="adm-tr adm-tr--vuota">
              <span className="c-muted">
                Nessuna richiesta registrata. Quando una famiglia chiede di vedere,
                correggere o cancellare dei dati, scrivetela qui: serve il giorno in cui
                qualcuno dirà «l’avevo chiesto a novembre».
              </span>
            </div>
          </div>
        ) : (
          <div className="adm-table__box">
            {richieste.map((r) => {
              const inRitardo =
                (r.stato === "ricevuta" || r.stato === "in_corso") && r.giorni > giorniLimite;
              return (
                <div
                  className="adm-tr"
                  key={r.id}
                  style={{ gridTemplateColumns: "minmax(0,1fr) 130px 210px" }}
                >
                  <span>
                    <strong>{r.dirittoLabel}</strong>
                    <br />
                    <span className="adm-note" style={{ whiteSpace: "pre-line" }}>
                      {r.descrizione}
                    </span>
                    <br />
                    <span className="c-muted adm-note">
                      arrivata il {r.arrivataIl} · {r.giorni}{" "}
                      {r.giorni === 1 ? "giorno" : "giorni"}
                      {inRitardo ? " — oltre il mese dell’art. 12" : ""}
                      {r.apertaDa ? ` · aperta da ${r.apertaDa}` : ""}
                      {r.chiusaIl ? ` · chiusa il ${r.chiusaIl.slice(0, 10)}` : ""}
                    </span>
                  </span>
                  <span className={clsx(PILL[r.stato], inRitardo && "adm-pill--stop")}>
                    {r.statoLabel}
                  </span>
                  <span className="adm-actions">
                    {r.stato === "ricevuta" ? (
                      <Comando
                        azione={segnaRichiesta}
                        campi={{ id: String(r.id), stato: "in_corso" }}
                      >
                        Presa in carico
                      </Comando>
                    ) : null}
                    {r.stato !== "eseguita" && r.stato !== "respinta" ? (
                      <Comando
                        azione={segnaRichiesta}
                        campi={{ id: String(r.id), stato: "eseguita" }}
                        primary
                      >
                        Eseguita
                      </Comando>
                    ) : null}
                    {puoEliminare ? (
                      <Comando
                        azione={rimuoviRichiesta}
                        campi={{ id: String(r.id) }}
                        conferma="Cancellare questa riga dal registro? Serve per gli sbagli, non per ripulire la storia."
                      >
                        Cancella
                      </Comando>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* --------------------------------------------------- nuova richiesta */}
      <form action={crea} className="adm-form">
        <h2>Nuova richiesta</h2>
        <span className="adm-note">
          La data è quella in cui la richiesta <strong>è arrivata</strong>, non quella di
          oggi: da lì decorre il mese dell’art. 12, e registrare «oggi» farebbe sembrare in
          orario una risposta in ritardo.
        </span>

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Arrivata il</span>
            <input
              name="arrivata"
              type="date"
              required
              aria-invalid={invalido("arrivata")}
            />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Di che cosa si tratta</span>
            <select name="diritto" defaultValue="accesso" aria-invalid={invalido("diritto")}>
              {diritti.map((d) => (
                <option key={d.chiave} value={d.chiave}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="adm-field">
          <span className="adm-field__label">Che cosa è stato chiesto</span>
          <textarea
            name="descrizione"
            rows={3}
            required
            maxLength={DESCRIZIONE_GDPR_MAX}
            aria-invalid={invalido("descrizione")}
          />
          <span className="adm-field__hint">
            Con le parole di chi l’ha chiesto. Non scrivete il nome del ragazzo se la
            richiesta si capisce senza: questo registro non ha una scadenza automatica.
          </span>
        </label>

        <Esito stato={stato} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
            {inCorso ? "Salvataggio…" : "Registra la richiesta"}
          </button>
        </div>
      </form>
    </div>
  );
}
