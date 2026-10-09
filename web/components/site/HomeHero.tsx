"use client";

import { useEffect, useRef } from "react";

/**
 * Hero della home. Il testo sfuma e sale entro 340 px di scorrimento e il
 * suggerimento «Scorri» sparisce entro 120: sono gli stessi numeri del sito
 * consegnato. Con `prefers-reduced-motion` non si muove niente.
 *
 * Gli stili si applicano direttamente al nodo invece di passare per lo stato di
 * React: è un'animazione a ogni frame, non un cambio di interfaccia.
 *
 * ## I testi arrivano come proprietà, dalla fase 14.10
 *
 * Prima li importava da `lib/data.ts`. Quando la home è passata a leggerli dallo
 * store, la pagina li prendeva dal database e **questo componente continuava a
 * stampare quelli del codice**: un gestore salvava il titolo, leggeva
 * «salvato», e in pagina non cambiava niente. Trovato provando, ed è il difetto
 * tipico di un componente client che si serve da sé invece di ricevere.
 *
 * Il titolo è un **array di righe** e si stampa con un ciclo, non con
 * `titolo[0]` e `titolo[1]`: il catalogo ne ammette fino a tre, e due indici
 * scritti a mano avrebbero silenziosamente buttato via la terza.
 */
export function HomeHero({
  occhiello,
  titolo,
  intro,
}: {
  occhiello: string;
  /** una voce per riga: l'interruzione fa parte del disegno del titolo */
  titolo: string[];
  intro: string;
}) {
  const testo = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ticking = false;
    const paint = () => {
      ticking = false;
      const y = window.scrollY;

      if (testo.current) {
        const fade = Math.min(1, y / 340);
        testo.current.style.opacity = (1 - fade).toFixed(3);
        testo.current.style.transform = `translateY(${(-fade * 60).toFixed(1)}px)`;
        testo.current.style.filter = `blur(${(fade * 4).toFixed(2)}px)`;
      }
      if (hint.current) {
        hint.current.style.opacity = (1 - Math.min(1, y / 120)).toFixed(3);
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(paint);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    paint();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="home-hero" aria-labelledby="titolo-home">
      <div className="home-hero__media">
        {/* Prima immagine che si vede: `fetchPriority` alta e niente `loading`
            differito, perché è l'elemento su cui si misura l'LCP. Le tre
            misure le prepara `scripts/foto-home.mjs` dall'originale. */}
        <img
          className="home-hero__foto"
          src="/assets/home-colonna-1280.webp"
          srcSet="/assets/home-colonna-640.webp 640w, /assets/home-colonna-960.webp 960w, /assets/home-colonna-1280.webp 1280w"
          sizes="100vw"
          width={1280}
          height={720}
          fetchPriority="high"
          decoding="async"
          alt="Fotografia di copertina"
        />
        <div className="home-hero__scrim"></div>
        <div className="home-hero__text" ref={testo}>
          <span className="eyebrow" style={{ fontSize: "12.5px", color: "var(--yellow-soft)" }}>
            {occhiello}
          </span>
          <h1 id="titolo-home" className="home-hero__title">
            {titolo.map((riga, i) => (
              <span key={i}>
                {/* Lo spazio prima del <br> è quello che tiene separate le
                    parole quando su telefono la regola `.home-hero__title br {
                    display: none }` nasconde l'interruzione: senza, «comincia» e
                    «dietro» si attaccano in «cominciadietro». Su desktop è uno
                    spazio in coda alla riga, invisibile. */}
                {i > 0 ? (
                  <>
                    {" "}
                    <br />
                  </>
                ) : null}
                {riga}
              </span>
            ))}
          </h1>
          <p className="home-hero__lead">{intro}</p>
        </div>
        <div className="home-hero__hint" aria-hidden="true" ref={hint}>
          <span>Scorri</span>
          <i></i>
        </div>
      </div>
    </section>
  );
}
