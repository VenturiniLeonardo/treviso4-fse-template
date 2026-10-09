"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { esci } from "@/app/(area)/area-riservata/accedi/actions";
import type { Sessione } from "@/lib/sessione";

/**
 * Menu del profilo, in alto a destra.
 *
 * È un `<details>`: si apre e si chiude da solo, con la tastiera, e **senza
 * JavaScript** — chi arriva con gli script bloccati trova comunque le voci. Il
 * poco codice qui serve solo alle due cortesie che l'HTML non dà: chiudere con
 * Esc e chiudere cliccando fuori.
 */
export function MenuProfilo({
  sessione,
  ruoloMostrato,
}: {
  sessione: Sessione;
  /** se si sta guardando la vista di un altro ruolo, la barra lo dice */
  ruoloMostrato?: string;
}) {
  const box = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const chiudi = () => box.current?.removeAttribute("open");

    const fuori = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) chiudi();
    };
    const tasto = (e: KeyboardEvent) => {
      if (e.key === "Escape" && box.current?.open) {
        chiudi();
        box.current.querySelector("summary")?.focus();
      }
    };

    document.addEventListener("click", fuori);
    document.addEventListener("keydown", tasto);
    return () => {
      document.removeEventListener("click", fuori);
      document.removeEventListener("keydown", tasto);
    };
  }, []);

  return (
    <details className="adm-profilo" ref={box}>
      <summary className="adm-profilo__tasto" aria-label={`Profilo di ${sessione.n}`}>
        <span className="adm-role">
          {ruoloMostrato ? `${sessione.n} · vista ${ruoloMostrato}` : sessione.n}
        </span>
        {/* Il quadratino con le iniziali si colora d'arancione quando chi è
            entrato è il gestore: è il colore con cui si identifica. Solo
            per il suo ruolo vero — se sta guardando la vista di un altro, il
            colore resta il suo, perché il colore dice chi sei, non che cosa
            stai guardando. È decorazione: il ruolo è già scritto per esteso
            nella barra e nel menu, quindi qui non si aggiunge nulla da leggere. */}
        <span
          className={clsx("adm-avatar", sessione.r === "gestore" && "adm-avatar--gestore")}
          aria-hidden="true"
        >
          {sessione.i}
        </span>
        <span className="adm-profilo__freccia" aria-hidden="true">
          ▾
        </span>
      </summary>

      <div className="adm-profilo__menu">
        <div className="adm-profilo__testa">
          <strong>{sessione.n}</strong>
          <span>{ETICHETTA_RUOLO[sessione.r] ?? sessione.r}</span>
          {sessione.un ? <span>unità: {sessione.un}</span> : null}
        </div>

        <Link className="adm-profilo__voce" href="/area-riservata/profilo#preferenze">
          Preferenze di visualizzazione
        </Link>
        <Link className="adm-profilo__voce" href="/area-riservata/profilo#sicurezza">
          Verifica con codice e recupero accesso
        </Link>

        <Link className="adm-profilo__voce" href="/area-riservata/profilo#accessi">Accessi aperti</Link>

        <form action={esci}>
          <button className="adm-profilo__voce adm-profilo__voce--esci" type="submit">
            Esci dall’area riservata
          </button>
        </form>
      </div>
    </details>
  );
}

const ETICHETTA_RUOLO: Record<string, string> = {
  "referente": "Referente di unità",
  "gestore": "Gestore",
  sviluppatore: "Sviluppatore",
  social: "Social media manager",
};
