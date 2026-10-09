import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { inIndirizzo } from "@/lib/contenuti";

/**
 * Segnaposto fotografico del mockup: rettangolo a righe con la dimensione
 * consigliata scritta sopra. Le foto vere (fase F5) sostituiscono questi
 * blocchi con un `<img>` che porta sempre width e height, per non far saltare
 * l'impaginazione (§04, soglia CLS < 0,05).
 */
export function Photo({
  className,
  style,
  label,
  labelClass = "ph__tag",
  children,
}: {
  className?: string;
  style?: CSSProperties;
  label?: string;
  labelClass?: string;
  children?: ReactNode;
}) {
  return (
    <div className={clsx("ph", className)} style={style}>
      {label ? <span className={labelClass}>{label}</span> : null}
      {children}
    </div>
  );
}

/** Trama a righe diagonali dei segnaposto, sopra un colore di fascia. */
export const trama = (colore: string, opacita = 0.16, passo = 12): CSSProperties => ({
  backgroundColor: colore,
  backgroundImage:
    `repeating-linear-gradient(115deg,rgba(255,255,255,${opacita}) 0 ${passo}px,` +
    `rgba(255,255,255,0) ${passo}px ${passo * 2}px)`,
});

/**
 * L'immagine di un posto fisso del disegno, quando c'è.
 *
 * Restituisce `null` se il posto è vuoto: il riquadro rigato del genitore resta
 * come fondo, ed è quello che si vede finché nessuno ha caricato. È lo stesso
 * disegno delle copertine di unità e di album — colore sotto, fotografia sopra
 * — e serve a due cose insieme: si vede qualcosa mentre l'immagine arriva, e ai
 * lati che la proporzione non copre non c'è un buco bianco.
 *
 * **`alt` viene da chi carica, e di solito è vuoto.** Questi riquadri sono
 * decorativi: la fotografia di fascia sta sopra un titolo che dice già
 * «Unità 1, 8–11 anni», il ritratto sta sopra il nome. Con `alt=""` uno screen
 * reader la salta, che è il comportamento giusto; obbligare a scrivere qualcosa
 * produrrebbe «foto» e «immagine» letti a voce uno dopo l'altro. Chi ha
 * qualcosa da dire lo scrive nel campo «descrizione», e allora l'immagine
 * smette di essere decorativa e `aria-hidden` sparisce.
 */
export function ImmagineSlot({
  img,
  className,
  sizes = "100vw",
}: {
  img: { file: string; larghezza: number; altezza: number; descrizione: string } | undefined;
  className: string;
  sizes?: string;
}) {
  if (!img) return null;
  const base = `/immagine/${img.file}`;
  return (
    <img
      className={className}
      src={`${base}?l=1600`}
      srcSet={`${base}?l=400 400w, ${base}?l=800 800w, ${base}?l=1600 1600w`}
      sizes={sizes}
      width={img.larghezza}
      height={img.altezza}
      alt={img.descrizione}
      aria-hidden={img.descrizione ? undefined : "true"}
    />
  );
}

/**
 * Il ritratto di una persona, o l'avatar anonimo se non ce n'è uno.
 *
 * ## Perché non basta `ImmagineSlot`
 *
 * `ImmagineSlot` restituisce `null` quando il posto è vuoto, e sotto resta il
 * riquadro rigato di `.ph`. Per una fotografia di fascia va bene: è una
 * campitura decorativa, e chi guarda la home non si chiede che cosa manchi.
 *
 * Per un **ritratto** no. Le schede dei referenti sono l'unico punto in cui il sito
 * dice a una famiglia «a vostro figlio ci pensa questa persona», e sette di
 * quelle schede su sette sono senza fotografia: due gestori, cinque referenti
 * unità. Il risultato è una griglia di rettangoli grigi a righe diagonali, che
 * non è una lacuna riconoscibile — è quello che si vede quando un'immagine non
 * si è caricata. Chi legge non distingue le due cose, e nel dubbio pensa che
 * sia il sito a essere rotto.
 *
 * L'avatar dice invece la cosa vera, in silenzio: *questa persona esiste, la
 * sua fotografia non c'è ancora*. Il nome e il ruolo sotto restano il
 * contenuto, come prima.
 *
 * ## Perché disegnato qui e non un file in `assets/`
 *
 * Perché deve cambiare colore. Sulla pagina di un'unità la scheda sta in un
 * contesto di fascia — giallo, verde, rosso — e un PNG grigio unico stonerebbe
 * su tutti e tre. Un `<svg>` in linea prende i colori dai token del foglio di
 * stile (`--bg-alt`, `--muted-3`) e pesa meno di una richiesta in più.
 *
 * ## L'accessibilità
 *
 * `aria-hidden`, senza testo alternativo. È la stessa regola di
 * `ImmagineSlot`: il nome della persona sta nella riga sotto, dentro la stessa
 * scheda, e far leggere a voce «segnaposto, nessuna fotografia» prima di
 * «Mario Rossi, Ref1» aggiunge rumore e nessuna informazione. Chi non
 * vede l'avatar non perde niente, perché l'avatar non dice niente che il testo
 * non dica già.
 */
export function AvatarAnonimo({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("avatar-anonimo", className)}
      viewBox="0 0 120 120"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {/* La sagoma: testa e spalle, e nient'altro. Niente capelli, niente
          cappello, nessun tratto del viso — un ritratto generico che
          suggerisse un uomo o una donna sarebbe sbagliato per metà delle
          schede. */}
      <circle cx="60" cy="46" r="19" />
      <path d="M60 71c-17.5 0-31.5 11.4-31.5 25.6V120h63V96.6C91.5 82.4 77.5 71 60 71Z" />
    </svg>
  );
}

/**
 * Il ritratto con il suo ripiego, che è la coppia che serve alle schede.
 *
 * Sta qui e non nelle due pagine perché le pagine sono due — «Chi siamo» e
 * quella di un'unità — e la regola è una: se il ritratto c'è si mostra, se non
 * c'è si mostra l'avatar. Scritta due volte, prima o poi diverge.
 */
export function Ritratto({
  img,
  className,
  sizes,
}: {
  img: { file: string; larghezza: number; altezza: number; descrizione: string } | undefined;
  className: string;
  sizes?: string;
}) {
  if (!img) return <AvatarAnonimo />;
  return <ImmagineSlot img={img} className={className} sizes={sizes} />;
}

/**
 * Se una griglia di schede di referenti deve avere il riquadro del ritratto.
 *
 * Sì solo se **almeno una** delle persone ne ha caricato uno. Allora le altre
 * hanno l'avatar anonimo, e le schede restano alte uguali. Se nessuno ce l'ha —
 * ed è il caso di tutte le griglie del sito, dal 23 settembre 2026 in cui il
 * gruppo ha deciso di non pubblicare volti — il riquadro sparisce, e la
 * scheda è nome, ruolo e anno.
 *
 * Perché non l'avatar per tutti: sette sagome uguali in fila non dicono niente
 * che il nome sotto non dica già, e occupano 210 pixel per scheda. Il ritratto
 * è un elemento secondario della pagina; senza fotografia, il posto si lascia
 * al testo invece di riempirlo con un'immagine che non c'è.
 */
export function conRitratti(immagini: Map<string, unknown>, nomi: string[]): boolean {
  return nomi.some((nome) => immagini.has(`referente.${inIndirizzo(nome)}`));
}
