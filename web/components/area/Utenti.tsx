"use client";

import { useActionState, useState } from "react";
import {
  invita,
  revocaUtente,
  rifaiInvito,
  salvaAccount,
} from "@/app/(area)/area-riservata/utenti/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";

/**
 * Utenti e inviti: l'elenco degli account e il modulo per crearne uno.
 *
 * Sostituisce `npm run db:invita`, che funzionava e chiedeva a chi amministra di
 * poter entrare nel server — quindi a settembre, quando i referenti cambiano, il
 * ricambio non si faceva.
 *
 * ## Che cosa mostra questa schermata di chi entra
 *
 * Nome utente, nome mostrato, ruolo, unità, stato, se ha una password e se ha il
 * secondo fattore. **Nessuna credenziale e nessuna impronta**: non c'è niente da
 * mostrare, perché nel database ci sono l'hash argon2id e il segreto TOTP, e
 * nessuno dei due serve a chi guarda un elenco.
 *
 * La colonna «2FA» distingue tre casi: «attivo», «da attivare» — l'account lo deve
 * avere e non l'ha ancora fatto, ed è l'informazione che serve a sollecitare — e
 * «non richiesto», quando uno sviluppatore ha deciso che a quell'account basta la
 * password. La scelta si fa alla creazione e dalla modifica dell'account, e solo
 * chi ha `completo` sugli utenti la vede: il predefinito è «richiesto» (§08).
 *
 * ## Il collegamento d'invito compare una volta
 *
 * Sta nel messaggio dell'azione e da nessun'altra parte: nel database c'è
 * l'impronta del token, non il token. Chi chiude la schermata prima di
 * copiarlo rifà l'invito — il vecchio si annulla da sé.
 */

export interface VoceUtente {
  id: number;
  utente: string;
  nome: string;
  iniziali: string;
  ruolo: string;
  ruoloLabel: string;
  unita?: string;
  unitaLabel?: string;
  email?: string;
  stato: string;
  haPassword: boolean;
  totpAttivo: boolean;
  /** falso se a quest'account basta la password: l'ha deciso uno sviluppatore */
  mfaRichiesto: boolean;
  /** vero se chi guarda può toccare quest'account: decide se i comandi si mostrano */
  gestibile: boolean;
  /** vero per l'account di chi sta guardando */
  sonoIo: boolean;
}

/** La pastiglia dello stato, con i colori che l'area usa già. */
function Stato({ voce }: { voce: VoceUtente }) {
  if (voce.stato === "revocato") return <span className="adm-pill adm-pill--stop">revocato</span>;
  if (voce.stato === "invitato" || !voce.haPassword) {
    return <span className="adm-pill adm-pill--wait">invito da usare</span>;
  }
  return <span className="adm-pill adm-pill--ok">attivo</span>;
}

/** Che cosa dice la colonna del secondo fattore, in una parola. */
function Mfa({ voce }: { voce: VoceUtente }) {
  if (!voce.mfaRichiesto) return <span className="c-muted">Verifica con codice non richiesta</span>;
  return <span>{voce.totpAttivo ? "Verifica con codice attiva" : "Verifica con codice da attivare"}</span>;
}

/** La scelta del secondo fattore: la vede solo chi può farla, cioè uno sviluppatore. */
function CampoMfa({ richiesto }: { richiesto: boolean }) {
  return (
    <label className="adm-field">
      <span className="adm-field__label">Verifica con codice</span>
      <select name="mfa" defaultValue={richiesto ? "1" : "0"}>
        <option value="1">Richiesto: password e codice dell’app</option>
        <option value="0">Non richiesto: basta la password</option>
      </select>
      <span className="adm-field__hint">
        Con «richiesto» la persona attiva l’app al primo accesso. Si può cambiare in
        qualunque momento: se lo togliete e lo rimettete, riparte dal codice che aveva.
      </span>
    </label>
  );
}

function Comando({
  azione,
  id,
  conferma,
  children,
}: {
  azione: typeof revocaUtente;
  id: number;
  conferma?: string;
  children: React.ReactNode;
}) {
  const [stato, invia, inCorso] = useActionState(azione, AZIONE_INIZIALE);
  return (
    <form action={invia} className="adm-comando">
      <input type="hidden" name="id" value={id} />
      <button
        className="adm-btn"
        type="submit"
        disabled={inCorso}
        onClick={(e) => {
          if (conferma && !window.confirm(conferma)) e.preventDefault();
        }}
      >
        {inCorso ? "…" : children}
      </button>
      <Esito stato={stato} />
    </form>
  );
}

function ModificaAccount({ voce, unita, ruoli, puoScegliereMfa, aperto, onChiudi }: {
  voce: VoceUtente;
  unita: { chiave: string; label: string }[];
  ruoli: { chiave: string; label: string }[];
  puoScegliereMfa: boolean;
  aperto: boolean;
  onChiudi: () => void;
}) {
  const [stato, salva, inCorso] = useActionState(salvaAccount, AZIONE_INIZIALE);
  return (
    <form action={salva} className="adm-form adm-form--incassato" hidden={!aperto}>
      <input type="hidden" name="id" value={voce.id} />
      <h3>Modifica «{voce.utente}»</h3>
      {/* `key` sui valori salvati: dopo un'azione React rimette i campi al loro
          valore **del primo montaggio**, e un secondo salvataggio avrebbe riportato
          indietro, in silenzio, quello appena cambiato — il secondo fattore compreso. */}
      <div
        className="adm-form__grid"
        key={`${voce.nome}|${voce.iniziali}|${voce.email}|${voce.ruolo}|${voce.unita}|${voce.mfaRichiesto}`}
      >
        <label className="adm-field"><span className="adm-field__label">Nome mostrato</span><input name="nome" required maxLength={80} defaultValue={voce.nome} /></label>
        <label className="adm-field"><span className="adm-field__label">Iniziali</span><input name="iniziali" required maxLength={3} defaultValue={voce.iniziali} /></label>
        <label className="adm-field"><span className="adm-field__label">Email</span><input type="email" name="email" maxLength={120} defaultValue={voce.email ?? ""} /></label>
        <label className="adm-field"><span className="adm-field__label">Ruolo</span>
          {voce.sonoIo ? <><input type="hidden" name="ruolo" value={voce.ruolo} /><span>{voce.ruoloLabel}</span></> : <select name="ruolo" defaultValue={voce.ruolo}>{ruoli.map((r) => <option key={r.chiave} value={r.chiave}>{r.label}</option>)}</select>}
        </label>
        <label className="adm-field"><span className="adm-field__label">Unità</span>
          {voce.sonoIo ? <><input type="hidden" name="unita" value={voce.unita ?? ""} /><span>{voce.unitaLabel ?? "nessuna"}</span></> : <select name="unita" defaultValue={voce.unita ?? ""}><option value="">nessuna</option>{unita.map((u) => <option key={u.chiave} value={u.chiave}>{u.label}</option>)}</select>}
          <span className="adm-field__hint">Obbligatoria soltanto per un referente di unità. Un cambio di ruolo o unità chiude gli accessi aperti.</span>
        </label>
        {puoScegliereMfa ? <CampoMfa richiesto={voce.mfaRichiesto} /> : null}
      </div>
      <Esito stato={stato} />
      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" disabled={inCorso}>{inCorso ? "Salvataggio…" : "Salva account"}</button>
        <button className="adm-btn" type="button" onClick={onChiudi}>Chiudi</button>
      </div>
    </form>
  );
}

/**
 * Un account: quattro colonne e, a destra, i comandi.
 *
 * «Modifica account» è un pulsante come «Rifai l'invito» e «Revoca», nella stessa
 * colonna e allineato a destra con loro; il modulo si apre sotto la riga, a tutta
 * larghezza. Era un `<details>` sotto la riga, con il suo sommario fuori dalla
 * griglia: stava a sinistra, da solo, e le righe sembravano due cose diverse.
 */
function RigaAccount({ v, livello, unita, ruoliAmmessi, puoScegliereMfa }: {
  v: VoceUtente;
  livello: "completo" | "limitato";
  unita: { chiave: string; label: string }[];
  ruoliAmmessi: { chiave: string; label: string }[];
  puoScegliereMfa: boolean;
}) {
  const [aperto, setAperto] = useState(false);
  // ogni apertura rimonta il modulo: si riparte dai valori salvati, senza
  // l'esito o le modifiche lasciate a metà l'ultima volta
  const [apertura, setApertura] = useState(0);
  const modificabile = v.gestibile && v.stato !== "revocato";
  return (
    <div>
      <div className="adm-persone__riga adm-persone__riga--account">
        <div className="adm-field">
          <span className="adm-field__label">Utente</span>
          <span>
            <strong>{v.utente}</strong>
            {v.sonoIo ? " · siete voi" : ""}
            <br />
            {v.nome}
            {v.email ? ` · ${v.email}` : ""}
          </span>
        </div>
        <div className="adm-field">
          <span className="adm-field__label">Ruolo</span>
          <span>
            {v.ruoloLabel}
            {v.unitaLabel ? (
              <>
                <br />
                {v.unitaLabel}
              </>
            ) : null}
          </span>
        </div>
        <div className="adm-field">
          <span className="adm-field__label">Stato · verifica con codice</span>
          <span>
            <Stato voce={v} />
            <br />
            <Mfa voce={v} />
          </span>
        </div>
        <div className="adm-field adm-field--comandi">
          <span className="adm-field__label">Gestione</span>
          {v.gestibile ? (
            <>
              {modificabile ? (
                <button
                  className="adm-btn"
                  type="button"
                  aria-expanded={aperto}
                  onClick={() => {
                    if (!aperto) setApertura((n) => n + 1);
                    setAperto(!aperto);
                  }}
                >
                  {aperto ? "Chiudi la modifica" : "Modifica account"}
                </button>
              ) : null}
              {/* un account in uso lo rinnova chi amministra: il nuovo
                  invito ne azzera la password (audit, M-6) */}
              {v.stato !== "revocato" && (livello === "completo" || v.stato !== "attivo") ? (
                <Comando azione={rifaiInvito} id={v.id}>
                  Rifai l’invito
                </Comando>
              ) : null}
              {v.stato !== "revocato" && !v.sonoIo ? (
                <Comando
                  azione={revocaUtente}
                  id={v.id}
                  conferma={`Revocare «${v.utente}»? Non entrerà più, e se è dentro adesso viene buttato fuori.`}
                >
                  Revoca
                </Comando>
              ) : null}
            </>
          ) : (
            <span className="c-muted">
              {v.sonoIo ? "il vostro account" : "lo gestisce lo sviluppatore"}
            </span>
          )}
        </div>
      </div>
      {/* Sempre nella pagina, nascosto finché la riga è chiusa: così il modulo
          esiste anche nell'HTML del server, dove lo cerca
          `scripts/verifica-accessi-http.mjs`, che il pulsante non può premerlo
          (QA, BUG-002). */}
      {modificabile ? (
        <ModificaAccount
          key={apertura}
          aperto={aperto}
          voce={v}
          unita={unita}
          ruoli={ruoliAmmessi}
          puoScegliereMfa={puoScegliereMfa}
          onChiudi={() => setAperto(false)}
        />
      ) : null}
    </div>
  );
}

export function Utenti({
  voci,
  unita,
  ruoliAmmessi,
  livello,
}: {
  voci: VoceUtente[];
  unita: { chiave: string; label: string }[];
  /** i ruoli che chi guarda può assegnare: uno solo, per il gestore */
  ruoliAmmessi: { chiave: string; label: string }[];
  livello: "completo" | "limitato";
}) {
  const [stato, crea, inCorso] = useActionState(invita, AZIONE_INIZIALE);
  const soloReferenti = livello === "limitato";
  // il secondo fattore lo sceglie solo lo sviluppatore (`completo` sugli utenti)
  const puoScegliereMfa = livello === "completo";

  return (
    <>
      <div className="adm-kpi">
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Account</span>
          <span className="adm-kpi__value">{voci.length}</span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Attivi</span>
          <span className="adm-kpi__value">
            {voci.filter((v) => v.stato === "attivo" && v.haPassword).length}
          </span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Inviti da usare</span>
          <span className="adm-kpi__value">
            {voci.filter((v) => v.stato !== "revocato" && !v.haPassword).length}
          </span>
        </div>
        <div className="adm-kpi__cell">
          <span className="adm-kpi__label">Codice da attivare</span>
          {/* rosso perché §08 lo vuole obbligatorio per gestore e admin */}
          <span
            className={
              voci.some((v) => v.haPassword && v.mfaRichiesto && !v.totpAttivo)
                ? "adm-kpi__value adm-kpi__value--red"
                : "adm-kpi__value"
            }
          >
            {voci.filter((v) => v.haPassword && v.mfaRichiesto && !v.totpAttivo).length}
          </span>
        </div>
      </div>

      <div className="adm-table">
        <div className="adm-table__head">
          <h2>Account</h2>
          <span className="adm-table__meta">
            {voci.length} {voci.length === 1 ? "account" : "account"}
            {soloReferenti ? " · potete gestire i referenti di unità e il social media manager" : ""}
          </span>
        </div>
        <div className="adm-table__box">
          <div className="adm-persone">
            {voci.map((v) => (
              <RigaAccount
                key={v.id}
                v={v}
                livello={livello}
                unita={unita}
                ruoliAmmessi={ruoliAmmessi}
                puoScegliereMfa={puoScegliereMfa}
              />
            ))}
          </div>
        </div>
      </div>

      <form className="adm-form" action={crea}>
        <h2>Invita una persona</h2>
        <span className="adm-note">
          L’account nasce <strong>senza password</strong>: si entra la prima volta dal
          collegamento d’invito. Quando la posta è configurata e l’account ha un indirizzo,
          viene inviato al destinatario; altrimenti compare qui una volta sola, da consegnare.
          {soloReferenti ? (
            <>
              {" "}
              <strong>Potete invitare referenti di unità e il social media manager.</strong> Un
              altro gestore o uno sviluppatore li crea chi amministra: è la regola che
              impedisce di darsi da sé un pari grado.
            </>
          ) : null}
        </span>

        <div className="adm-form__grid">
          <label className="adm-field">
            <span className="adm-field__label">Nome utente</span>
            <input
              type="text"
              name="utente"
              maxLength={32}
              required
              placeholder="ref1"
              aria-invalid={stato.campo === "utente" || undefined}
            />
            <span className="adm-field__hint">
              Con cui accede. Minuscole, cifre, punto o trattino. Non si cambia più.
            </span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Nome mostrato</span>
            <input
              type="text"
              name="nome"
              maxLength={80}
              required
              placeholder="Ref1 — Mario Rossi"
              aria-invalid={stato.campo === "nome" || undefined}
            />
            <span className="adm-field__hint">Come compare nella barra dell’area.</span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Iniziali</span>
            <input
              type="text"
              name="iniziali"
              maxLength={3}
              required
              placeholder="AK"
              aria-invalid={stato.campo === "iniziali" || undefined}
            />
            <span className="adm-field__hint">Una, due o tre lettere: la pastiglia in barra.</span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Ruolo</span>
            <select
              name="ruolo"
              required
              defaultValue={ruoliAmmessi[0]?.chiave}
              aria-invalid={stato.campo === "ruolo" || undefined}
            >
              {/*
                I ruoli che si possono assegnare arrivano dal server, non da una
                lista scritta qui: per un gestore la tendina ha due voci,
                referente di unità e social media manager. La protezione resta
                nell'azione — `autorizzaSuUtente` confronta il ruolo inviato con
                il livello — ma offrire quattro voci di cui due danno un rifiuto
                è un modo di far sbagliare.
              */}
              {ruoliAmmessi.map((r) => (
                <option value={r.chiave} key={r.chiave}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Unità</span>
            <select name="unita" defaultValue="" aria-invalid={stato.campo === "unita" || undefined}>
              <option value="">nessuna</option>
              {unita.map((u) => (
                <option value={u.chiave} key={u.chiave}>
                  {u.label}
                </option>
              ))}
            </select>
            <span className="adm-field__hint">
              Obbligatoria per un referente di unità, vietata agli altri: senza, non potrebbe
              gestire né album né circolari.
            </span>
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Email (facoltativa)</span>
            <input
              type="email"
              name="email"
              maxLength={120}
              placeholder="Indirizzo email della persona"
              aria-invalid={stato.campo === "email" || undefined}
            />
            <span className="adm-field__hint">
              Serve a ricevere gli inviti. Per accedere si usa il nome utente.
            </span>
          </label>
          {puoScegliereMfa ? <CampoMfa richiesto /> : null}
        </div>

        <Esito stato={stato} />

        <div className="adm-form__actions">
          <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
            {inCorso ? "Creazione…" : "Crea l’account e l’invito"}
          </button>
          <button className="adm-btn" type="reset">
            Annulla
          </button>
        </div>
      </form>
    </>
  );
}
