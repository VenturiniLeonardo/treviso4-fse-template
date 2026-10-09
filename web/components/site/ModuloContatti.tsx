"use client";

import clsx from "clsx";
import { useActionState, useEffect, useRef, useState } from "react";
import { inviaMessaggio } from "@/app/(sito)/contatti/actions";
import { LIMITI_CONTATTI, STATO_INIZIALE } from "@/lib/contatti";
import { emailValida } from "@/lib/email";
import { MOTIVI_CONTATTO } from "@/lib/data";

const SUGGERIMENTO = "Rispondiamo di solito entro pochi giorni.";

/**
 * Modulo contatti. L'azione è una Server Action passata direttamente al form:
 * funziona anche a JavaScript spento (§04 del piano). Con JavaScript attivo si
 * aggiunge la risposta immediata già presente nel sito consegnato — il pulsante
 * si accende quando i campi obbligatori sono a posto.
 *
 * L'email si controlla con `emailValida`, la stessa di `lib/contatti.ts`:
 * pulsante e server devono concordare.
 */

export function ModuloContatti({ email }: { email: string }) {
  const [stato, azione, inCorso] = useActionState(inviaMessaggio, STATO_INIZIALE);
  const [pronto, setPronto] = useState(false);
  const [riscrivi, setRiscrivi] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const conferma = useRef<HTMLElement>(null);
  const primoCampo = useRef<HTMLInputElement>(null);

  const ricevuto = stato.stato === "ricevuto" && riscrivi === 0;
  const daRecapitare = stato.stato === "nonRecapitato" && riscrivi === 0;
  const errore = stato.stato === "errore" || stato.stato === "bloccato";

  // il messaggio di conferma prende il fuoco, come nel sito consegnato
  useEffect(() => {
    if (daRecapitare || ricevuto) conferma.current?.focus();
  }, [daRecapitare, ricevuto]);

  const verifica = () => {
    const f = form.current;
    if (!f) return;
    const dati = new FormData(f);
    const testo = (nome: string) => String(dati.get(nome) ?? "").trim();
    setPronto(
      testo("nome") !== "" &&
        emailValida(testo("email")) &&
        testo("messaggio").length > 8 &&
        dati.get("privacy") !== null,
    );
  };

  const invalido = (campo: string) =>
    errore && stato.campi?.includes(campo) ? true : undefined;

  if (ricevuto) {
    /*
     * Due conferme, e quella che si vede dipende da che cosa è **successo
     * davvero**.
     *
     * `avvisati` è vero solo se la posta ai gestori è partita: non
     * se la posta è configurata, ma se il server l'ha accettato. Un server
     * fermo, delle credenziali scadute o una casella piena riportano alla
     * seconda frase, che è quella che il sito ha detto per tutte le fasi prima
     * di questa.
     *
     * La distinzione non è pignoleria: chi ha appena scritto per iscrivere un
     * figlio decide, in base a questa riga, se restare ad aspettare o
     * telefonare. Promettere sempre l'avviso sarebbe comodo e a volte falso.
     */
    const avvisati = stato.avvisati === true;
    return (
      <div className="form-panel">
        <div className="form-sent">
          <strong tabIndex={-1} ref={conferma}>
            Messaggio ricevuto
          </strong>
          <p>
            {avvisati
              ? "È arrivato, e lo abbiamo ricevuto anche per email. Rispondiamo di solito entro pochi giorni."
              : "È arrivato: lo leggiamo quando entriamo nell’area riservata, e rispondiamo di solito entro pochi giorni."}
          </p>
          <p className="tiny-note">
            {avvisati ? "Se è urgente, potete scrivere anche a " : "Non riceviamo una notifica automatica, quindi se è urgente scrivete anche a "}
            <a href={`mailto:${email}`}>{email}</a>.
          </p>
          <button
            type="button"
            onClick={() => {
              setRiscrivi((n) => n + 1);
              setPronto(false);
            }}
          >
            Scrivi un altro messaggio
          </button>
        </div>
      </div>
    );
  }

  if (daRecapitare) {
    // Quello che l'utente ha scritto non va perso: diventa il corpo di un
    // messaggio di posta già pronto. È l'unica strada che oggi arriva davvero
    // ai gestori, e chiedergli di ricopiare tutto a mano sarebbe scortese.
    const v = stato.valori;
    const motivo =
      MOTIVI_CONTATTO.find((m) => m.chiave === v?.motivo)?.label ?? "Richiesta dal sito";
    const corpo = [
      v?.messaggio ?? "",
      "",
      "—",
      `Nome: ${v?.nome ?? ""}`,
      `Email: ${v?.email ?? ""}`,
      v?.telefono ? `Telefono: ${v.telefono}` : null,
      "Scritto dal modulo del sito.",
    ]
      .filter((r) => r !== null)
      .join("\n");
    const posta = `mailto:${email}?subject=${encodeURIComponent(
      motivo,
    )}&body=${encodeURIComponent(corpo)}`;

    return (
      <div className="form-panel">
        <div className="form-sent">
          <strong tabIndex={-1} ref={conferma}>
            Il messaggio non è stato salvato
          </strong>
          {/*
            Questo ramo diceva «il modulo non è ancora collegato», ed era vero
            fino alla fase 8.1: allora il messaggio non veniva scritto da nessuna
            parte. Adesso viene salvato, e qui si arriva **solo se il
            salvataggio è fallito** — un guasto momentaneo del server. Dirgli
            che il modulo non è collegato manderebbe a cercare una funzione
            mancante invece di far riprovare fra un minuto.
            Trovato dall'audit della fase 13.
          */}
          <p>
            C’è stato un problema sul server e il messaggio non è arrivato. Non
            avete perso niente: quello che avete scritto è già pronto qui sotto in
            un messaggio di posta, e potete anche riprovare fra qualche minuto.
          </p>
          <p>
            <a className="btn btn--primary" href={posta}>
              Apri il messaggio nell’app di posta →
            </a>
          </p>
          <p className="tiny-note">
            Oppure scrivete direttamente a{" "}
            <a href={`mailto:${email}`}>{email}</a>.
          </p>
          <button
            type="button"
            onClick={() => {
              setRiscrivi((n) => n + 1);
              setPronto(false);
            }}
          >
            Torna al modulo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="form-panel">
      <form
        id="modulo-gestori"
        className="stack gap-14"
        action={azione}
        ref={form}
        onInput={verifica}
        onChange={verifica}
        noValidate
      >
        <div className="form-grid">
          <label className="field">
            <span>Nome e cognome</span>
            <input
              id="c-nome"
              name="nome"
              type="text"
              autoComplete="name"
              placeholder="es. Mario Rossi"
              defaultValue={stato.valori?.nome}
              aria-invalid={invalido("nome")}
              ref={primoCampo}
              maxLength={LIMITI_CONTATTI.nome}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              id="c-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Il vostro indirizzo email"
              defaultValue={stato.valori?.email}
              aria-invalid={invalido("email")}
              maxLength={LIMITI_CONTATTI.email}
              required
            />
          </label>
          <label className="field">
            <span>
              Telefono <em>(facoltativo)</em>
            </span>
            <input
              id="c-tel"
              name="telefono"
              type="tel"
              autoComplete="tel"
              placeholder="es. +39 340 1234567"
              defaultValue={stato.valori?.telefono}
              maxLength={LIMITI_CONTATTI.telefono}
            />
          </label>
          <label className="field">
            <span>Motivo</span>
            <select id="c-motivo" name="motivo" defaultValue={stato.valori?.motivo}>
              {MOTIVI_CONTATTO.map((m) => (
                <option key={m.chiave} value={m.chiave}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Messaggio</span>
          <textarea
            id="c-messaggio"
            name="messaggio"
            rows={5}
            defaultValue={stato.valori?.messaggio}
            aria-invalid={invalido("messaggio")}
            placeholder="Scrivete qui la vostra domanda."
            maxLength={LIMITI_CONTATTI.messaggio}
            required
          />
        </label>
        <label className="consent">
          <input
            id="c-privacy"
            name="privacy"
            type="checkbox"
            required
            aria-invalid={invalido("privacy")}
          />
          <span>
            {/* si apre in una scheda nuova per non perdere quello che è già scritto.
                È una presa visione, non un consenso: la base giuridica dichiarata
                nell'informativa è la richiesta stessa (art. 6.1.b), e chiamarla
                «consenso» qui direbbe un'altra cosa */}
            Ho letto l’
            <a href="/legale/privacy" target="_blank" rel="noopener">
              informativa privacy
            </a>
            : i dati servono solo a rispondere a questa richiesta e si cancellano dopo 24
            mesi.
          </span>
        </label>
        <div className="submit-row">
          <button
            className={clsx("btn-submit", pronto && "is-ready")}
            type="submit"
            aria-disabled={!pronto}
          >
            {inCorso ? "Invio in corso…" : "Invia"}
          </button>
          <span className={clsx("form-hint", errore && "is-error")} role="status">
            {errore ? stato.errore : SUGGERIMENTO}
          </span>
        </div>
      </form>
    </div>
  );
}
