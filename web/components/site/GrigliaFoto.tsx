"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Fotografia } from "@/lib/contenuti";

/**
 * La parete di stampe di un album, con il visore a tutto schermo.
 *
 * ## Senza JavaScript funziona lo stesso
 *
 * Ogni fotografia è un collegamento alla sua derivata più grande
 * (`/foto-file/<file>?l=1600`): senza script il clic la apre in una pagina a
 * sé, e il tasto indietro riporta all'album. Con lo script il clic apre invece
 * il visore, e il collegamento resta quello che un lettore di schermo annuncia.
 *
 * ## Il visore
 *
 * Un `<dialog>` aperto con `showModal()`: il browser pensa da sé a tenere il
 * fuoco dentro, a chiudere con Esc e a rendere inerte la pagina sotto — tre
 * cose che scritte a mano si sbagliano. Frecce della tastiera, pulsanti e
 * scorrimento col dito per passare da una fotografia all'altra; la precedente
 * e la successiva si precaricano, così il passaggio non mostra un vuoto.
 *
 * Le fotografie grandi passano dalla stessa rotta delle piccole, quindi dallo
 * stesso controllo della password: il visore non apre niente che la griglia
 * non potesse già mostrare.
 */
export function GrigliaFoto({ foto, titolo }: { foto: Fotografia[]; titolo: string }) {
  const finestra = useRef<HTMLDialogElement>(null);
  const [indice, setIndice] = useState<number | null>(null);
  const tocco = useRef<number | null>(null);

  const alt = (f: Fotografia, i: number) =>
    f.didascalia || `Fotografia ${i + 1} di ${foto.length} — ${titolo}`;
  const grande = (f: Fotografia) => `/foto-file/${f.file}?l=1600`;

  const vai = useCallback(
    (passo: number) =>
      setIndice((i) => (i === null ? i : (i + passo + foto.length) % foto.length)),
    [foto.length],
  );

  function apri(e: React.MouseEvent, i: number) {
    // clic con Cmd/Ctrl o con il tasto centrale: chi li usa vuole una scheda nuova
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setIndice(i);
    finestra.current?.showModal();
  }

  function chiudi() {
    finestra.current?.close();
  }

  useEffect(() => {
    const d = finestra.current;
    if (!d) return;
    const alChiudere = () => setIndice(null);
    const tasti = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") vai(1);
      else if (e.key === "ArrowLeft") vai(-1);
    };
    d.addEventListener("close", alChiudere);
    d.addEventListener("keydown", tasti);
    return () => {
      d.removeEventListener("close", alChiudere);
      d.removeEventListener("keydown", tasti);
    };
  }, [vai]);

  const attuale = indice === null ? null : foto[indice];
  const vicine =
    indice === null
      ? []
      : [foto[(indice + 1) % foto.length], foto[(indice - 1 + foto.length) % foto.length]];

  return (
    <>
      <div className="shots">
        {foto.map((f, i) => (
          <figure className="shots__cell shots__cell--vera" key={f.file}>
            <a
              className="shots__apri"
              href={grande(f)}
              onClick={(e) => apri(e, i)}
              aria-label={`Ingrandisci: ${alt(f, i)}`}
            >
              <img
                src={`/foto-file/${f.file}?l=800`}
                width={f.larghezza}
                height={f.altezza}
                alt={alt(f, i)}
                loading={i < 6 ? undefined : "lazy"}
                decoding="async"
              />
            </a>
            {f.didascalia ? <figcaption>{f.didascalia}</figcaption> : null}
          </figure>
        ))}
      </div>

      <dialog
        ref={finestra}
        className="visore"
        aria-label={`Fotografie di ${titolo}`}
        // un clic sul fondo scuro, fuori dall'immagine e dai comandi, chiude
        onClick={(e) => {
          if (e.target === e.currentTarget) chiudi();
        }}
        onTouchStart={(e) => {
          tocco.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (tocco.current === null) return;
          const dx = e.changedTouches[0].clientX - tocco.current;
          tocco.current = null;
          if (Math.abs(dx) > 50) vai(dx < 0 ? 1 : -1);
        }}
      >
        {attuale && indice !== null ? (
          <>
            <div className="visore__barra">
              <span className="visore__conto" aria-live="polite">
                {indice + 1} / {foto.length}
              </span>
              <button type="button" className="visore__chiudi" onClick={chiudi} autoFocus>
                Chiudi <span aria-hidden="true">✕</span>
              </button>
            </div>
            <figure className="visore__foto">
              <img
                key={attuale.file}
                src={grande(attuale)}
                srcSet={
                  `/foto-file/${attuale.file}?l=800 800w, ` +
                  `/foto-file/${attuale.file}?l=1600 1600w`
                }
                sizes="100vw"
                width={attuale.larghezza}
                height={attuale.altezza}
                alt={alt(attuale, indice)}
              />
              {attuale.didascalia ? <figcaption>{attuale.didascalia}</figcaption> : null}
            </figure>
            {foto.length > 1 ? (
              <>
                <button
                  type="button"
                  className="visore__passo visore__passo--prima"
                  onClick={() => vai(-1)}
                  aria-label="Fotografia precedente"
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  className="visore__passo visore__passo--dopo"
                  onClick={() => vai(1)}
                  aria-label="Fotografia successiva"
                >
                  <span aria-hidden="true">›</span>
                </button>
              </>
            ) : null}
            {/* le due vicine, già in cache quando ci si arriva */}
            <div hidden>
              {vicine.map((f) => (
                <img key={f.file} src={grande(f)} alt="" />
              ))}
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
