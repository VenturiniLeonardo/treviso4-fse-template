"use client";

import { useActionState } from "react";
import {
  caricaCopertina,
  rimuoviCopertina,
  salvaAnagrafica,
  salvaScheda,
} from "@/app/(area)/area-riservata/unita/actions";
import { indirizzoInAttesa } from "@/lib/proposte";
import { VistaCopertina } from "@/components/area/AnagraficaUnita";
import { Campo } from "@/components/area/SchedaUnita";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import type { Unita } from "@/lib/data";
import {
  CAMPI_ANAGRAFICA,
  CAMPI_UNITA,
  type CampoUnita,
  COPERTINA_CONSIGLIATA,
  COPERTINA_PESO_MAX,
} from "@/lib/unita-contenuti";

/**
 * La pagina di un'unità, a pezzi con un nome ciascuno.
 *
 * ## Perché non è più un modulo solo
 *
 * «Unità, nomi e loghi» era un modulo con quattro campi e due campi in sola
 * lettura («Logo», «Etichetta degli iscritti»), seguito da un modulo per la
 * copertina; i testi stavano in un'altra sezione, con i recapiti. Chi cercava
 * dove cambiare il luogo del ritrovo doveva indovinare. Adesso ogni cosa ha il
 * suo riquadro, intitolato per quello che contiene, nell'ordine in cui la pagina
 * pubblica la racconta:
 *
 *   Identità          nome, fascia d'età, iscritti, sigla
 *   Ritrovo           dove e quando
 *   Presentazione     riga sopra il titolo, motto, fondazione, storia
 *   Fotografie        copertina e foto d'archivio
 *   Responsabili precedenti
 *
 * Ogni riquadro si salva da sé: correggere il motto non rimette in gioco la
 * storia. I referenti in carica e il contatto per le famiglie stanno in «Referenti».
 *
 * Il controllo di chi può salvare non sta qui: sta nelle azioni.
 */

/** Il logo, il nome e un collegamento alla pagina pubblica: l'intestazione dell'unità. */
export function TestataUnita({
  unita,
  colore,
}: {
  unita: Unita;
  colore: string;
}) {
  return (
    <header className="adm-unita__testa" style={{ ["--colore" as string]: colore }}>
      <img src={`/assets/${unita.logo}`} width={56} height={56} alt="" />
      <div>
        <h2>{unita.nome}</h2>
        <span className="adm-table__meta">
          {unita.eta}
          {unita.iscritti > 0 ? ` · ${unita.iscrittiLabel}` : ""}
        </span>
      </div>
      <a className="adm-btn" href={`/unita/${unita.slug}`} target="_blank" rel="noreferrer">
        Vedi la pagina pubblica ↗
      </a>
    </header>
  );
}

/** L'indice dei riquadri: collegamenti dentro la pagina, per non scorrere a occhio. */
export function IndiceUnita() {
  const voci = [
    ["identita", "Identità"],
    ["ritrovo", "Ritrovo"],
    ["presentazione", "Presentazione"],
    ["fotografie", "Fotografie"],
    ["precedenti", "Responsabili precedenti"],
  ];
  return (
    <nav className="adm-unita__indice" aria-label="In questa pagina">
      {voci.map(([id, testo]) => (
        <a key={id} href={`#${id}`}>
          {testo}
        </a>
      ))}
    </nav>
  );
}

/** Nome, fascia d'età, iscritti e sigla. Modifiche immediate. */
export function IdentitaUnita({ unita }: { unita: Unita }) {
  const [stato, salva, salvando] = useActionState(salvaAnagrafica, AZIONE_INIZIALE);

  return (
    <form className="adm-form adm-unita__riquadro" action={salva} id="identita">
      <input type="hidden" name="unita" value={unita.chiave} />
      <h3>Identità</h3>
      <span className="adm-note">
        Compaiono in ogni pagina che nomina l’unità: la sua pagina, l’organigramma, Contatti e la
        ricerca. <strong>L’indirizzo della pagina non cambia</strong> — resta{" "}
        <code>/unita/{unita.slug}</code>, così i collegamenti salvati dalle famiglie continuano a
        funzionare. Il logo è quello ufficiale dell’organizzazione e non si sostituisce.
      </span>

      <div className="adm-form__grid">
        {CAMPI_ANAGRAFICA.map((c) => (
          <label className="adm-field" key={c.chiave}>
            <span className="adm-field__label">{c.label}</span>
            <input
              type={c.tipo === "numero" ? "number" : "text"}
              name={c.chiave}
              defaultValue={
                c.chiave === "iscritti"
                  ? String(unita.iscritti)
                  : String((unita as unknown as Record<string, unknown>)[c.chiave] ?? "")
              }
              maxLength={c.tipo === "numero" ? undefined : c.max}
              min={c.tipo === "numero" ? 0 : undefined}
              required={c.chiave === "nome"}
              aria-invalid={stato.campo === c.chiave || undefined}
            />
            <span className="adm-field__hint">{c.hint}</span>
          </label>
        ))}
      </div>

      <Esito stato={stato} />

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={salvando}>
          {salvando ? "Salvataggio…" : "Salva l’identità"}
        </button>
        <button className="adm-btn" type="reset">
          Annulla
        </button>
      </div>
    </form>
  );
}

/**
 * Un riquadro di campi della scheda, scelti per chiave.
 *
 * Usa `salvaScheda`, che salta i campi assenti dal modulo: un riquadro che manda
 * solo il ritrovo non tocca il motto. I campi si leggono dal catalogo
 * (`CAMPI_UNITA`), lo stesso che l'azione interroga.
 */
export function RiquadroCampi({
  id,
  titolo,
  nota,
  unita,
  campi,
  etichettaSalva,
}: {
  id: string;
  titolo: string;
  nota: string;
  unita: Unita;
  campi: CampoUnita[];
  etichettaSalva: string;
}) {
  const [stato, salva, inCorso] = useActionState(salvaScheda, AZIONE_INIZIALE);
  const definizioni = campi
    .map((k) => CAMPI_UNITA.find((c) => c.chiave === k))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  return (
    <form className="adm-form adm-unita__riquadro" action={salva} id={id}>
      <input type="hidden" name="unita" value={unita.chiave} />
      <h3>{titolo}</h3>
      <span className="adm-note">{nota}</span>

      <div className="adm-form__grid">
        {definizioni.map((c) => (
          <Campo key={c.chiave} campo={c} unita={unita} propone={false} />
        ))}
      </div>

      <Esito stato={stato} />

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : etichettaSalva}
        </button>
        <button className="adm-btn" type="reset">
          Annulla
        </button>
      </div>
    </form>
  );
}

/**
 * La copertina dell'unità come riquadro, dello stesso disegno delle altre
 * fotografie (`PostoFoto`): l'anteprima in alto, sotto il nome e i pulsanti.
 *
 * Fa le stesse due cose di `CopertinaUnita` — carica, toglie — con le stesse
 * azioni; quella resta per la schermata del social media manager, che propone
 * invece di pubblicare. Qui si pubblica: chi apre «Unità» ha `completo`.
 */
export function CopertinaScheda({
  unita,
  proposta,
}: {
  unita: Unita;
  proposta?: { file: string | null; mostra?: boolean };
}) {
  const [statoFile, invia, caricando] = useActionState(caricaCopertina, AZIONE_INIZIALE);
  const [statoTolta, togli, togliendo] = useActionState(rimuoviCopertina, AZIONE_INIZIALE);
  // quella che c'è, visibile o nascosta
  const vista = unita.copertina ?? unita.copertinaNascosta;

  return (
    <article className="adm-foto">
      <div className="adm-foto__anteprima">
        {vista ? (
          <img
            src={`${vista.src}?l=800`}
            width={vista.larghezza}
            height={vista.altezza}
            alt="Copertina caricata"
            loading="lazy"
            style={unita.copertina ? undefined : { opacity: 0.45 }}
          />
        ) : (
          <span className="adm-foto__vuoto">Nessuna fotografia</span>
        )}
      </div>
      <div className="adm-foto__corpo">
        <h4>Copertina</h4>
        <span className="adm-foto__dove">
          In cima alla pagina dell’unità. Viene ridotta a {COPERTINA_CONSIGLIATA.larghezza}×
          {COPERTINA_CONSIGLIATA.altezza} circa e tagliata al centro, e ripulita dai dati del
          telefono. Niente ritratti di ragazzi in primo piano: è pubblica e non passa dal controllo
          dei consensi.
        </span>
        <span className={unita.copertina ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--draft"}>
          {unita.copertina
            ? `online · ${unita.copertina.larghezza}×${unita.copertina.altezza}`
            : unita.copertinaNascosta
              ? "nascosta"
              : "vuota"}
        </span>

        {proposta ? (
          <div className="adm-notice">
            <span className="adm-notice__tag">In attesa</span>
            <span>
              {proposta.mostra
                ? "C’è la richiesta di rimettere la copertina nascosta."
                : proposta.file
                  ? "C’è una copertina nuova da approvare."
                  : "C’è la richiesta di togliere la copertina."}
            </span>
            {proposta.file ? (
              <img
                src={indirizzoInAttesa(proposta.file, 400)}
                alt="Copertina proposta"
                loading="lazy"
                style={{ maxWidth: "160px", height: "auto", borderRadius: "4px" }}
              />
            ) : null}
          </div>
        ) : null}

        <form className="adm-foto__carica" action={invia} encType="multipart/form-data">
          <input type="hidden" name="unita" value={unita.chiave} />
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png"
            required
            aria-label="Fotografia di copertina"
            aria-invalid={statoFile.campo === "file" || undefined}
          />
          <span className="adm-field__hint">JPEG o PNG, fino a {COPERTINA_PESO_MAX / 1024 / 1024} MB.</span>
          <div className="adm-foto__azioni">
            <button className="adm-btn adm-btn--primary" type="submit" disabled={caricando}>
              {caricando ? "Caricamento…" : unita.copertina ? "Sostituisci" : "Carica"}
            </button>
          </div>
          <Esito stato={statoFile} />
        </form>

        <VistaCopertina unita={unita} />

        {vista ? (
          <form action={togli}>
            <input type="hidden" name="unita" value={unita.chiave} />
            <button
              className="adm-btn"
              type="submit"
              disabled={togliendo}
              onClick={(e) => {
                if (!window.confirm("Togliere la copertina di quest’unità?")) e.preventDefault();
              }}
            >
              {togliendo ? "…" : "Togli la copertina"}
            </button>
          </form>
        ) : null}
        <Esito stato={statoTolta} />
      </div>
    </article>
  );
}
