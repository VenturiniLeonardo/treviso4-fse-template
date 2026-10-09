"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cerca, MINIMO_LETTERE, type VoceRicerca } from "@/lib/ricerca";

/**
 * La lente della barra di navigazione: premuta, apre la barra in cui scrivere.
 *
 * Tutto avviene lì dentro — non c'è una pagina dei risultati. La barra bianca
 * si apre **dentro** la barra di navigazione, crescendo verso sinistra sopra le
 * voci di menu (che a ricerca aperta non servono), e sotto compaiono i
 * risultati: si scrive, si scende con le frecce o col dito e si arriva alla
 * pagina scelta.
 *
 * Due dettagli che vale la pena sapere:
 *
 * - **L'indice arriva al primo clic**, da `/api/ricerca`, e poi resta in
 *   memoria: si digita senza una richiesta per lettera, e chi non cerca niente
 *   non scarica niente. È la stessa scelta dei contatori della home — il peso
 *   si paga solo quando serve.
 * - **Senza JavaScript la lente non c'è.** Come il pulsante del menu in
 *   `Navbar.tsx`, che è `hidden` finché il componente non è vivo: un'icona che
 *   non fa niente è peggio di un'icona che non c'è. Il sito resta navigabile
 *   con il menu, che senza JavaScript è aperto.
 */

/** Quanti risultati si mostrano: oltre, l'elenco scorre. */
const QUANTI = 8;

function Lente() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function Ricerca() {
  const router = useRouter();
  const pathname = usePathname();

  const [conJs, setConJs] = useState(false);
  const [aperto, setAperto] = useState(false);
  const [q, setQ] = useState("");
  const [indice, setIndice] = useState<VoceRicerca[] | null>(null);
  const [stato, setStato] = useState<"fermo" | "carico" | "errore">("fermo");
  /** riga scelta con le frecce; −1 significa nessuna */
  const [scelta, setScelta] = useState(-1);

  const guscio = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const lente = useRef<HTMLButtonElement>(null);

  useEffect(() => setConJs(true), []);

  const chiudi = () => {
    setAperto(false);
    setQ("");
    setScelta(-1);
  };

  // arrivati a destinazione la ricerca si chiude e si svuota
  useEffect(() => {
    setAperto(false);
    setQ("");
    setScelta(-1);
  }, [pathname]);

  // L'indice si scarica al primo clic e non si ripete: se il primo tentativo
  // fallisce resta `errore`, e la tendina lo dice invece di restare muta.
  //
  // «Già chiesto» è un ref e non uno stato di proposito: scritto come stato
  // farebbe ripartire questo effetto a metà della richiesta, e la risposta
  // arriverebbe a un effetto già smontato — l'indice non si vedrebbe mai.
  const chiesto = useRef(false);
  useEffect(() => {
    if (!aperto || chiesto.current) return;
    chiesto.current = true;
    setStato("carico");
    fetch("/api/ricerca")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { voci: VoceRicerca[] }) => {
        setIndice(d.voci);
        setStato("fermo");
      })
      .catch(() => setStato("errore"));
  }, [aperto]);

  // aprendo si scrive subito: il cursore va nel campo
  useEffect(() => {
    if (aperto) campo.current?.focus();
  }, [aperto]);

  // Esc chiude e riporta il fuoco sulla lente, com'è per il menu principale;
  // un clic fuori chiude e basta.
  useEffect(() => {
    if (!aperto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      chiudi();
      lente.current?.focus();
    };
    const fuori = (e: PointerEvent) => {
      if (e.target instanceof Node && !guscio.current?.contains(e.target)) chiudi();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", fuori);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", fuori);
    };
  }, [aperto]);

  // Scorciatoie da tastiera: «/» come su quasi tutti i siti, ⌘K/Ctrl+K per chi
  // se l'aspetta. «/» solo fuori dai campi di testo, altrimenti si ruberebbe
  // una barra a chi sta scrivendo nel modulo contatti.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inUnCampo =
        e.target instanceof HTMLElement &&
        e.target.closest("input, textarea, select, [contenteditable]") !== null;
      const kappa = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      const barra = e.key === "/" && !inUnCampo && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!kappa && !barra) return;
      e.preventDefault();
      setAperto(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const corta = q.trim().length < MINIMO_LETTERE;
  const risultati = useMemo(
    () => (indice && !corta ? cerca(indice, q, QUANTI) : []),
    [indice, q, corta],
  );

  // la riga scelta con le frecce va tenuta a vista quando l'elenco scorre
  useEffect(() => {
    if (scelta < 0) return;
    document.getElementById(`ricerca-esito-${scelta}`)?.scrollIntoView({ block: "nearest" });
  }, [scelta]);

  const vaiA = (href: string) => {
    chiudi();
    router.push(href);
  };

  const tastiera = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (risultati.length) setScelta((s) => (s + 1) % risultati.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (risultati.length) setScelta((s) => (s <= 0 ? risultati.length - 1 : s - 1));
    } else if (e.key === "Enter") {
      // Invio va alla riga scelta con le frecce, o alla prima se non si è
      // scelto niente: non esiste una pagina dei risultati dove ripararsi.
      e.preventDefault();
      const voce = risultati[scelta] ?? risultati[0];
      if (voce) vaiA(voce.href);
    }
  };

  // C'è qualcosa da mostrare sotto la barra? Se no, l'elenco non si apre
  // affatto: appena aperta si vede solo la barra, come deve essere.
  const messaggio = corta
    ? null
    : stato === "errore"
      ? "La ricerca non risponde. Provate a ricaricare la pagina."
      : stato === "carico"
        ? "Un istante…"
        : risultati.length === 0
          ? `Nessun risultato per «${q.trim()}». Provate con una parola sola.`
          : null;

  return (
    <div className="ricerca" ref={guscio}>
      <button
        className="nav-search"
        type="button"
        ref={lente}
        hidden={!conJs}
        aria-expanded={aperto}
        aria-controls="ricerca-barra"
        aria-label={aperto ? "Chiudi la ricerca" : "Cerca nel sito"}
        onClick={() => (aperto ? chiudi() : setAperto(true))}
      >
        <Lente />
      </button>

      {aperto ? (
        <>
          <div className="ricerca__barra" id="ricerca-barra" role="search">
            <span className="ricerca__campo-icona" aria-hidden="true">
              <Lente />
            </span>
            <input
              ref={campo}
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setScelta(-1);
              }}
              onKeyDown={tastiera}
              placeholder="Cerca nel sito…"
              aria-label="Cerca nel sito"
              autoComplete="off"
              role="combobox"
              aria-expanded={risultati.length > 0}
              aria-controls="ricerca-esiti"
              aria-autocomplete="list"
              aria-activedescendant={scelta >= 0 ? `ricerca-esito-${scelta}` : undefined}
            />
            <button className="ricerca__chiudi" type="button" onClick={chiudi}>
              <span aria-hidden="true">×</span>
              <span className="visually-hidden">Chiudi la ricerca</span>
            </button>
          </div>

          {messaggio || risultati.length > 0 ? (
            <div className="ricerca__tendina">
              {messaggio ? <p className="ricerca__nota">{messaggio}</p> : null}

              <ul
                className="ricerca__esiti"
                id="ricerca-esiti"
                role="listbox"
                aria-label="Risultati"
              >
                {risultati.map((v, i) => (
                  <li key={`${v.href}-${v.titolo}`}>
                    <Link
                      className={i === scelta ? "ricerca__esito is-scelto" : "ricerca__esito"}
                      id={`ricerca-esito-${i}`}
                      href={v.href}
                      role="option"
                      aria-selected={i === scelta}
                      onMouseEnter={() => setScelta(i)}
                      onClick={chiudi}
                    >
                      <span className="ricerca__dove">{v.sezione}</span>
                      <span className="ricerca__titolo">{v.titolo}</span>
                      <span className="ricerca__testo">{v.testo}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="visually-hidden" role="status">
            {corta
              ? ""
              : `${risultati.length} ${risultati.length === 1 ? "risultato" : "risultati"}`}
          </p>
        </>
      ) : null}
    </div>
  );
}
