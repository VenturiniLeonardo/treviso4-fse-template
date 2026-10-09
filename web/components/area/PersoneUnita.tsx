"use client";

import { useActionState, useState } from "react";
import { salvaPersone } from "@/app/(area)/area-riservata/unita/actions";
import { Esito } from "@/components/area/Esito";
import { AZIONE_INIZIALE } from "@/lib/contenuti";
import type { UnitaKey } from "@/lib/data";
import { ETICHETTA_TIPO_PERSONA, type TipoPersona } from "@/lib/unita-contenuti";

/**
 * Gli elenchi di persone di un'unità: responsabili, staff, storico.
 *
 * Tre moduli con la stessa forma, uno per tipo, perché sono tre elenchi con tre
 * significati: chi guida l'unità adesso, chi aiuta, chi l'ha guidata prima. Si
 * salvano separatamente — nessuno vuole rimettere in gioco lo storico per
 * correggere un ruolo.
 *
 * ## Le righe vuote in fondo, e perché sono due
 *
 * Aggiungere e togliere una riga sono gesti di JavaScript: lo stato sta nel
 * componente. Ma l'area riservata funziona anche a JavaScript spento — è una
 * proprietà di tutto il progetto, non una gentilezza — e con lo stato in un
 * `useState` chi lo ha spento non potrebbe aggiungere nessuno.
 *
 * Quindi il modulo rende **sempre due righe vuote oltre a quelle piene**. A
 * JavaScript spento si aggiungono fino a due persone per salvataggio, che è
 * quello che serve a inizio anno; con JavaScript «Aggiungi una riga» ne mette
 * quante se ne vuole. Le righe senza nome le scarta il server, quindi due
 * caselle lasciate bianche non producono due schede vuote in pagina.
 *
 * ## Che cosa si vede nel modulo
 *
 * L'elenco **in linea**, non quello proposto — la stessa scelta della scheda, e
 * per lo stesso motivo: il modulo mostra lo stato del sito. Se c'è una proposta
 * pendente lo dice il riquadro in cima, con quanti nomi contiene.
 */

/** Una persona nel modulo: solo testo, l'ordine lo dà la posizione. */
interface Riga {
  nome: string;
  ruolo: string;
  periodo: string;
  nota: string;
}

const VUOTA: Riga = { nome: "", ruolo: "", periodo: "", nota: "" };

/** Quante caselle vuote lasciare in fondo. Vedi la nota in cima. */
const VUOTE_IN_FONDO = 2;

/** Le etichette cambiano per tipo: «dal 2022» non è «2018 – 2022». */
const COLONNE: Record<TipoPersona, { ruolo: string; periodo: string; nota?: string }> = {
  responsabile: { ruolo: "Ruolo", periodo: "Da quando" },
  staff: { ruolo: "Ruolo", periodo: "Da quando" },
  storico: { ruolo: "Ruolo", periodo: "Anni", nota: "Nota" },
};

const AIUTO: Record<TipoPersona, string> = {
  responsabile:
    "Chi guida l’unità quest’anno. Compaiono nella pagina dell’unità, con il ruolo e da quando.",
  staff:
    "Chi affianca i responsabili. Compaiono nella pagina «Chi siamo», nella scheda dell’unità.",
  storico:
    "Chi ha guidato l’unità prima. Gli anni che l’archivio non registra si scrivono «—»: " +
    "un anno plausibile ma non documentato vale meno di niente.",
};

export function PersoneUnita({
  unita,
  tipo,
  persone,
  livello,
  inRevisione,
}: {
  unita: UnitaKey;
  tipo: TipoPersona;
  /** l'elenco che è in pagina adesso */
  persone: Riga[];
  livello: "completo" | "limitato";
  /** quanti nomi aspettano l'approvazione, se ce n'è una in coda */
  inRevisione?: number;
}) {
  const [stato, invia, inCorso] = useActionState(salvaPersone, AZIONE_INIZIALE);
  const [righe, setRighe] = useState<Riga[]>([
    ...persone,
    ...Array.from({ length: VUOTE_IN_FONDO }, () => ({ ...VUOTA })),
  ]);

  const colonne = COLONNE[tipo];
  const conNota = colonne.nota !== undefined;

  const cambia = (i: number, campo: keyof Riga, valore: string) =>
    setRighe((r) => r.map((x, j) => (j === i ? { ...x, [campo]: valore } : x)));

  return (
    <form className="adm-form" action={invia}>
      <input type="hidden" name="unita" value={unita} />
      <input type="hidden" name="tipo" value={tipo} />

      <h2>{ETICHETTA_TIPO_PERSONA[tipo]}</h2>
      <span className="adm-note">
        {AIUTO[tipo]}{" "}
        {livello === "limitato" ? (
          <strong>
            L’elenco passa dai gestori: sono nomi pubblicati sul sito. Finché non lo
            approvano, in pagina resta quello di adesso.
          </strong>
        ) : null}
      </span>

      {inRevisione ? (
        <span className="adm-note">
          <strong>
            C’è già una proposta in attesa su quest’elenco, con {inRevisione}{" "}
            {inRevisione === 1 ? "nome" : "nomi"}.
          </strong>{" "}
          Salvando di nuovo la sostituite: in coda ne resta una sola, la più recente.
        </span>
      ) : null}

      <div className="adm-persone">
        {righe.map((r, i) => (
          <div
            className={conNota ? "adm-persone__riga" : "adm-persone__riga adm-persone__riga--senza-nota"}
            key={i}
          >
            <label className="adm-field">
              <span className="adm-field__label">Nome</span>
              <input
                type="text"
                name={`nome-${i}`}
                value={r.nome}
                maxLength={80}
                onChange={(e) => cambia(i, "nome", e.target.value)}
              />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">{colonne.ruolo}</span>
              <input
                type="text"
                name={`ruolo-${i}`}
                value={r.ruolo}
                maxLength={60}
                onChange={(e) => cambia(i, "ruolo", e.target.value)}
              />
            </label>
            <label className="adm-field">
              <span className="adm-field__label">{colonne.periodo}</span>
              <input
                type="text"
                name={`periodo-${i}`}
                value={r.periodo}
                maxLength={40}
                onChange={(e) => cambia(i, "periodo", e.target.value)}
              />
            </label>
            {conNota ? (
              <label className="adm-field">
                <span className="adm-field__label">{colonne.nota}</span>
                <input
                  type="text"
                  name={`nota-${i}`}
                  value={r.nota}
                  maxLength={160}
                  onChange={(e) => cambia(i, "nota", e.target.value)}
                />
              </label>
            ) : (
              // La nota non c'è per questo tipo, ma il server legge `nota-<i>`
              // per tutti: senza questo campo, `formData.has("nome-0")` andrebbe
              // avanti e `nota-0` mancherebbe. Meglio mandarla vuota che far
              // dipendere il server dal tipo di elenco.
              <input type="hidden" name={`nota-${i}`} value="" />
            )}
            <button
              className="adm-btn"
              type="button"
              onClick={() => setRighe((x) => x.filter((_, j) => j !== i))}
              aria-label={`Togli la riga ${i + 1}`}
            >
              Togli
            </button>
          </div>
        ))}
      </div>

      {righe.length === 0 ? (
        <p className="adm-persone__vuoto">
          Nessun nome. Salvando così, la pagina dell’unità torna a mostrare i nomi
          predefiniti: un elenco vuoto conta come «non compilato».
        </p>
      ) : null}

      <Esito stato={stato} />

      <div className="adm-form__actions">
        <button className="adm-btn adm-btn--primary" type="submit" disabled={inCorso}>
          {inCorso ? "Salvataggio…" : livello === "completo" ? "Salva l’elenco" : "Manda ai gestori"}
        </button>
        <button
          className="adm-btn"
          type="button"
          onClick={() => setRighe((r) => [...r, { ...VUOTA }])}
        >
          Aggiungi una persona
        </button>
      </div>
    </form>
  );
}
