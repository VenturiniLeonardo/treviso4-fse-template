"use client";

import { useActionState } from "react";
import { salvaScheda } from "@/app/(area)/area-riservata/unita/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import type { Unita } from "@/lib/data";
import {
  CAMPI_UNITA,
  daParagrafi,
  type DefinizioneCampo,
  type Proposta,
} from "@/lib/unita-contenuti";

/**
 * La scheda di un'unità: testi e recapiti.
 *
 * ## Il modulo dice che cosa succederà, prima che si prema
 *
 * Il «metà e metà» è invisibile finché non si salva, e una schermata che lo
 * rivela **dopo** insegna a non fidarsi del pulsante: chi ha scritto un
 * telefono e ha letto «salvato» crede di averlo pubblicato. Quindi i campi
 * stanno in due riquadri con due intestazioni diverse, e il secondo lo dichiara
 * in cima.
 *
 * Non è una decisione presa qui: `campo.approvazione` viene dal catalogo in
 * `lib/unita-contenuti.ts`, che è lo stesso che l'azione interroga. La
 * schermata e il server leggono la stessa riga — se un domani un campo cambia
 * gruppo, si sposta di riquadro da sé.
 *
 * ## Il controllo non sta qui
 *
 * Questo componente nasconde e dichiara; a decidere è `contesto("unita-scheda",
 * { unita })` nell'azione. `soloLettura` serve a non mostrare un campo che
 * produrrebbe un rifiuto, non a proteggerlo.
 */

/** Un campo in attesa: la proposta pendente, se c'è. */
export function inAttesa(proposte: readonly Proposta[], chiave: string): Proposta | undefined {
  return proposte.find((p) => p.campo === chiave);
}

export function Campo({
  campo,
  unita,
  proposta,
  propone,
  soloLettura,
}: {
  campo: DefinizioneCampo;
  unita: Unita;
  proposta?: Proposta;
  /** chi guarda propone invece di pubblicare: livello `limitato` */
  propone: boolean;
  soloLettura?: boolean;
}) {
  const online =
    campo.chiave === "storia"
      ? daParagrafi(unita.storia)
      : String((unita as unknown as Record<string, unknown>)[campo.chiave] ?? "");

  /*
   * Che cosa sta nella casella, e perché dipende da chi guarda.
   *
   * Per chi **pubblica** è il valore in linea: il modulo mostra lo stato del
   * sito, e la proposta di qualcun altro si dichiara accanto.
   *
   * Per chi **propone** è la sua proposta, se ce n'è una. Fino al 3 ottobre
   * 2026 era il valore in linea anche per lui, e aveva un effetto che nessuno
   * vedeva: il modulo rimanda tutti i campi, e riproporre il valore in linea
   * **ritira** la proposta (`proponiCampiUnita`). Un referente di unità che proponeva
   * il telefono e poi correggeva il motto ritirava il telefono salvando il
   * motto; il social media manager, che propone tutto, perdeva a ogni
   * salvataggio quello che aveva salvato prima. Il valore online resta
   * dichiarato accanto, e rimetterlo nella casella è il modo di ritirare.
   */
  const valore = propone && proposta ? proposta.proposto : online;

  const grande = campo.tipo === "paragrafi";

  return (
    <label className={grande ? "adm-field adm-field--larga" : "adm-field"}>
      <span className="adm-field__label">{campo.label}</span>
      {grande ? (
        <textarea
          name={campo.chiave}
          rows={10}
          defaultValue={valore}
          maxLength={campo.max}
          readOnly={soloLettura}
        />
      ) : (
        <input
          type={campo.tipo === "riga" ? "text" : campo.tipo}
          name={campo.chiave}
          defaultValue={valore}
          maxLength={campo.max}
          readOnly={soloLettura}
        />
      )}
      <span className="adm-field__hint">
        {campo.hint}
        {proposta && propone ? (
          <>
            {" "}
            <strong>
              Nella casella c’è la vostra proposta, in attesa di approvazione. Online
              adesso: «{online.length > 120 ? `${online.slice(0, 120)}…` : online || "(vuoto)"}».
            </strong>
          </>
        ) : proposta ? (
          <>
            {" "}
            <strong>
              In attesa di approvazione: «{proposta.proposto || "(vuoto)"}»
              {proposta.autore ? ` — proposto da ${proposta.autore}` : ""}.
            </strong>
          </>
        ) : null}
      </span>
    </label>
  );
}

export function SchedaUnita({
  unita,
  livello,
  proposte,
  inCoda = false,
}: {
  unita: Unita;
  /** quello che il cancello ha riconosciuto: decide se si pubblica o si propone */
  livello: "completo" | "limitato";
  /** le proposte pendenti su quest'unità, per dichiararle accanto al campo */
  proposte: Proposta[];
  /**
   * Chi salva propone **tutto**: il social media manager (`vaInCoda`). Vede i
   * soli testi — ritrovo, recapiti e nomi dei referenti non sono suoi (`contenuto`
   * nel catalogo) — in un riquadro solo, perché per lui non c'è metà e metà:
   * ogni campo aspetta un gestore.
   */
  inCoda?: boolean;
}) {
  const [stato, invia, inCorso] = useActionState(salvaScheda, AZIONE_INIZIALE);

  const subito = CAMPI_UNITA.filter((c) => !c.approvazione);
  // Con `completo` non c'è un secondo gruppo: chi approva pubblica tutto, e
  // dividere i campi in due riquadri annuncerebbe un'attesa che non ci sarà.
  const daApprovare =
    livello === "limitato" && !inCoda ? CAMPI_UNITA.filter((c) => c.approvazione) : [];
  const tuttiInsieme =
    livello === "completo"
      ? CAMPI_UNITA
      : inCoda
        ? CAMPI_UNITA.filter((c) => c.contenuto)
        : subito;

  return (
    <form className="adm-form" action={invia}>
      <input type="hidden" name="unita" value={unita.chiave} />

      <h2>{livello === "completo" ? "Testi e recapiti" : "Testi dell’unità"}</h2>
      <span className="adm-note">
        {livello === "completo" ? (
          <>
            Compaiono nella pagina dell’unità, in Contatti e nella ricerca del sito. Le
            modifiche vanno online appena salvate.
          </>
        ) : inCoda ? (
          <>
            Compaiono nella pagina dell’unità e nella ricerca del sito. Le modifiche{" "}
            <strong>vanno ai gestori</strong>: sul sito resta il testo di adesso finché non
            le approvano, e accanto a ogni campo compare quello che aspetta.
          </>
        ) : (
          <>
            Compaiono nella pagina della vostra unità. Questi <strong>vanno online
            appena salvati</strong>: se sbagliate una parola, si corregge subito.
          </>
        )}
      </span>

      <div className="adm-form__grid">
        {tuttiInsieme.map((c) => (
          <Campo
            key={c.chiave}
            campo={c}
            unita={unita}
            proposta={inAttesa(proposte, c.chiave)}
            propone={livello === "limitato" && (inCoda || c.approvazione)}
          />
        ))}
      </div>

      {daApprovare.length > 0 ? (
        <>
          <h2>Recapiti e nomi dei referenti</h2>
          <span className="adm-note">
            Questi <strong>passano dai gestori</strong>. Non è una diffidenza: un
            recapito sbagliato manda le famiglie nel vuoto e resta online finché
            qualcuno non se ne accorge, e i nomi dei referenti sono dati personali — di cui
            risponde chi ha l’elenco completo, come per i consensi delle fotografie.
            Quello che scrivete qui compare nella loro coda; sul sito resta il valore di
            adesso finché non lo approvano.
          </span>

          <div className="adm-form__grid">
            {daApprovare.map((c) => (
              <Campo
                key={c.chiave}
                campo={c}
                unita={unita}
                proposta={inAttesa(proposte, c.chiave)}
                propone
              />
            ))}
          </div>
        </>
      ) : null}

      <Esito stato={stato} />

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : inCoda ? "Invia ai gestori" : "Salva la scheda"}
        </button>
        <button className="adm-btn" type="reset">
          Annulla
        </button>
        <a className="adm-btn" href={`/unita/${unita.slug}`} target="_blank" rel="noreferrer">
          Vedi la pagina pubblica ↗
        </a>
        {/*
          L'anteprima compare **solo se c'è qualcosa in attesa**. Senza proposte
          mostrerebbe una pagina identica a quella pubblica, e un pulsante che
          promette di far vedere una differenza che non c'è si smette di premere.
        */}
        {proposte.length > 0 ? (
          <a
            className="adm-btn"
            href={`/anteprima/unita/${unita.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            Anteprima delle modifiche in attesa ↗
          </a>
        ) : null}
      </div>
    </form>
  );
}
