"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Ricerca } from "@/components/site/Ricerca";
import type { Identita } from "@/lib/identita";
import { AREA_RISERVATA, navLinks } from "@/lib/nav";

/**
 * Barra di navigazione, identica su tutte le pagine: la pastiglia dentro la
 * barra. Sulla home è trasparente perché la foto le passa sotto, e oltre i
 * 40 px di scorrimento il fondo si chiude; sulle altre pagine, che non hanno
 * una foto in cima, il fondo è pieno da subito (`navbar--onsheet`).
 *
 * Il menu a scomparsa resta progressive enhancement come nel sito consegnato:
 * il pulsante compare solo quando il JavaScript è attivo, altrimenti le voci
 * sono già tutte nell'HTML.
 */
export function Navbar({ identita, album }: { identita: Identita; album: boolean }) {
  const pathname = usePathname();
  /** solo la home ha la foto a tutta pagina sotto la barra */
  const sopraFoto = pathname === "/";

  const header = useRef<HTMLElement>(null);
  const [aperto, setAperto] = useState(false);
  const [conJs, setConJs] = useState(false);

  useEffect(() => setConJs(true), []);

  // il menu si chiude quando si cambia pagina
  useEffect(() => setAperto(false), [pathname]);

  useEffect(() => {
    if (!sopraFoto) return;
    const el = header.current;
    if (!el) return;

    let ticking = false;
    const paint = () => {
      ticking = false;
      el.classList.toggle("is-solid", window.scrollY > 40);
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
  }, [sopraFoto]);

  useEffect(() => {
    if (!aperto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAperto(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aperto]);

  const brand = (
    <Link className="brand" href="/">
      <img
        src={identita.marchio.src}
        width={identita.marchio.larghezza}
        height={identita.marchio.altezza}
        alt="Marchio del gruppo"
      />
      <span>
        <span className="brand__name">{identita.nome}</span>
        {identita.sottotitolo ? <span className="brand__sub">{identita.sottotitolo}</span> : null}
      </span>
    </Link>
  );

  const menu = (
    <nav
      id="menu-principale"
      className={aperto ? "nav is-open" : "nav"}
      aria-label="Navigazione principale"
    >
      {navLinks(album).map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={pathname.startsWith(l.href) ? "page" : undefined}
        >
          {l.label}
        </Link>
      ))}
      <Link className="btn-reserved" href={AREA_RISERVATA}>
        Area riservata
      </Link>
    </nav>
  );

  const riservata = (
    <Link className="btn-reserved btn-reserved--bar" href={AREA_RISERVATA}>
      Area riservata
    </Link>
  );

  const toggle = (
    <button
      className="nav-toggle"
      type="button"
      hidden={!conJs}
      aria-expanded={aperto}
      aria-controls="menu-principale"
      onClick={() => setAperto((v) => !v)}
    >
      <span></span>
      <span></span>
      <span></span>
      <span className="visually-hidden">{aperto ? "Chiudi il menu" : "Apri il menu"}</span>
    </button>
  );

  return (
    <header
      className={
        sopraFoto ? "navbar navbar--float" : "navbar navbar--float navbar--onsheet"
      }
      ref={header}
    >
      <div className="navbar__inner">
        <div className="navbar__bar">
          {brand}
          {menu}
          {/* Lente, area riservata e pulsante del menu stanno in un gruppo solo:
              così la barra ha sempre tre blocchi (marchio, menu, comandi) e
              `space-between` li distribuisce come prima che la lente ci fosse.
              La lente resta fuori dal menu a scomparsa perché su telefono deve
              stare in barra, accanto al pulsante del menu. */}
          <div className="navbar__comandi">
            <Ricerca />
            {riservata}
            {toggle}
          </div>
        </div>
      </div>
    </header>
  );
}
