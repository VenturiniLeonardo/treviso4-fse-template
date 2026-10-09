"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";

export interface Contatore {
  valore: number;
  label: string;
  sub: string;
  alt: boolean;
}

/**
 * Contatori che salgono quando entrano nello schermo. Senza JavaScript (o con
 * `prefers-reduced-motion`) i numeri finali sono già nell'HTML: l'animazione è
 * un ornamento, non il modo in cui si legge il dato.
 */
export function Counters({ contatori }: { contatori: Contatore[] }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const celle = Array.from(el.querySelectorAll<HTMLElement>("[data-count-to]"));
    if (!celle.length) return;

    const scrivi = (k: number) => {
      for (const cella of celle) {
        const finale = Number(cella.dataset.countTo);
        cella.textContent = String(Math.round(finale * k));
      }
    };

    // L'HTML porta già i numeri finali, così sono leggibili anche senza
    // JavaScript. Si azzerano subito al montaggio — non all'ingresso nello
    // schermo — altrimenti si vedrebbe il numero finale sparire e ricominciare.
    scrivi(0);

    let raf = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();

        const t0 = performance.now();
        const dur = 1100;
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / dur);
          scrivi(1 - Math.pow(1 - p, 3));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="counters" ref={box}>
      {contatori.map((c, i) => (
        <div
          key={i}
          className={clsx("counters__cell", c.alt && "counters__cell--alt")}
        >
          <span className="counters__value" data-count-to={c.valore}>
            {c.valore}
          </span>
          <span className="counters__label">{c.label}</span>
          <span className="counters__sub">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
