"use client";

import { useRef, useState } from "react";

/**
 * Il suggerimento dei grafici, al passaggio del mouse.
 *
 * Un contenitore solo per grafico, non un componente per colonna: ascolta gli
 * eventi che salgono dagli elementi con `data-suggerimento` e mostra quel
 * testo accanto al puntatore. Il testo si mette con `textContent` (è React a
 * farlo, dentro lo `<span>`), mai come HTML: arriva dal registro, cioè da
 * nomi e operazioni scritti da altri.
 *
 * Aggiunge, non toglie: senza JavaScript il grafico si vede lo stesso, e ogni
 * valore del suggerimento sta anche nella tabella sotto il grafico. Per questo
 * la bolla è `aria-hidden` e le colonne non prendono il fuoco: chi usa la
 * tastiera o un lettore di schermo legge la tabella, che dice le stesse cose
 * senza trenta fermate di Tab dentro un grafico.
 */
export function Suggerimento({ children }: { children: React.ReactNode }) {
  const scatola = useRef<HTMLDivElement>(null);
  const [stato, setStato] = useState<{ testo: string; x: number; y: number } | null>(null);

  function mostra(bersaglio: EventTarget | null, x: number, y: number) {
    const el = (bersaglio as HTMLElement | null)?.closest<HTMLElement>("[data-suggerimento]");
    const box = scatola.current;
    if (!el || !box || !box.contains(el)) return setStato(null);
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setStato({
      testo: el.dataset.suggerimento ?? "",
      // la bolla segue il puntatore in orizzontale e sta sopra l'elemento
      x: x - b.left,
      y: Math.min(y, r.top) - b.top,
    });
  }

  return (
    <div
      ref={scatola}
      className="graf-sugg"
      onPointerMove={(e) => mostra(e.target, e.clientX, e.clientY)}
      onPointerLeave={() => setStato(null)}
    >
      {children}
      {stato ? (
        <span
          className={`graf-sugg__bolla${stato.x > (scatola.current?.clientWidth ?? 0) / 2 ? " graf-sugg__bolla--sinistra" : ""}`}
          style={{ left: stato.x, top: stato.y }}
          aria-hidden="true"
        >
          {stato.testo.split("\n").map((riga, i) =>
            i === 0 ? (
              <strong key={i}>{riga}</strong>
            ) : (
              <span key={i}>{riga}</span>
            ),
          )}
        </span>
      ) : null}
    </div>
  );
}
