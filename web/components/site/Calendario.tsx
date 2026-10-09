"use client";

import { useMemo, useState } from "react";
import { Chips } from "@/components/site/Chips";
import {
  fasciaDiUnita,
  chiaviEvento,
  FILTRI_UNITA,
  labelDiUnita,
  MESI_ORDINE,
  type Evento,
} from "@/lib/data";

/**
 * Calendario filtrabile per unità. Gli eventi sono tutti già nell'HTML: il
 * filtro è `useState` su dati presenti (§04). Un mese senza attività visibili
 * scompare, e se non resta niente compare il riquadro «nessuna attività».
 */
export function Calendario({ eventi }: { eventi: Evento[] }) {
  const [attivo, setAttivo] = useState("tutte");

  const chips = [
    { chiave: "tutte", label: "Tutte" },
    ...FILTRI_UNITA.map((f) => ({ chiave: f.chiave, label: f.label, tone: f.fascia })),
  ];

  const visibili = useMemo(
    () =>
      attivo === "tutte"
        ? eventi
        : eventi.filter((e) => (chiaviEvento(e) as string[]).includes(attivo)),
    [eventi, attivo],
  );

  const mesi = MESI_ORDINE.map((nome) => ({
    nome,
    eventi: visibili.filter((e) => e.mese === nome),
  })).filter((m) => m.eventi.length > 0);

  // Il contenitore chiude la corsa della barra `sticky`: senza, la barra resta
  // ferma fino in fondo a <main> e copre le ultime attività contro il footer.
  // Lo spazio prima del footer è un margine, fuori dal contenitore, perché la
  // barra se ne vada insieme all'ultima attività.
  return (
    <div style={{ marginBottom: "76px" }}>
      <div className="filterbar">
        <div className="filterbar__inner">
          <span className="filterbar__label" id="etichetta-filtri">
            Filtra per unità
          </span>
          <Chips
            chips={chips}
            attivo={attivo}
            onSelect={setAttivo}
            labelledBy="etichetta-filtri"
          />
          <span className="filterbar__count" role="status">
            {visibili.length} attività in programma
          </span>
        </div>
      </div>

      <div className="wrap stack gap-34" style={{ paddingTop: "40px" }}>
        {mesi.map((m) => (
          <section className="month" key={m.nome} aria-label={`${m.nome} ${m.eventi[0].anno}`}>
            <div className="month__head">
              <span className="month__name">{m.nome}</span>
              <span className="month__year">{m.eventi[0].anno}</span>
              <span className="month__rule" aria-hidden="true"></span>
            </div>
            <div className="month__list">
              {m.eventi.map((e) => {
                const primaria = fasciaDiUnita(e.unita[0]);
                return (
                  <article
                    key={`${e.mese}-${e.giorno}-${e.titolo}-${e.unita.join(",")}`}
                    className="event"
                    style={{ borderLeftColor: primaria.colore }}
                  >
                    <div className="event__date">
                      <span className="event__day">{e.giorno}</span>
                      <span className="event__dow">{e.dow}</span>
                    </div>
                    <div className="event__main">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "12px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span className="event__title">{e.titolo}</span>
                        <span className="event__kind">{e.tipo}</span>
                      </div>
                      <span className="event__note">{e.nota}</span>
                      <div className="event__tags">
                        {e.unita.map((k) => (
                          <span key={k} className={`pill pill--${k}`}>
                            {labelDiUnita(k)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="event__side">
                      <span className="event__place">{e.luogo}</span>
                      <span className="event__dur">{e.durata}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {/* Due vuoti diversi: «niente per questo filtro» e «niente del tutto».
            Il secondo è lo stato del sito appena messo in linea, e suggerire di
            cambiare filtro manderebbe a cercare attività che non ci sono. */}
        {eventi.length === 0 ? (
          <div className="empty">
            <strong>Label</strong>
            <span>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.
            </span>
          </div>
        ) : visibili.length === 0 ? (
          <div className="empty">
            <strong>Nessuna attività per questa unità</strong>
            <span>Provate a scegliere un altro filtro.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
