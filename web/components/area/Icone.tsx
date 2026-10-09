/**
 * Le icone dell'area riservata.
 *
 * ## Perché non gli emoji
 *
 * La dashboard nasceva con gli emoji al posto delle icone — 👥 per il
 * tesseramento, 📅 per il calendario, ⚡ per la coda — ed erano l'unico posto in
 * tutto il progetto in cui comparissero: nelle altre trentacinque schermate
 * dell'area non ce n'è uno. Tre ragioni per toglierli, in ordine di peso:
 *
 * 1. **Non sono disegnati da noi.** Un emoji lo disegna il sistema operativo:
 *    la stessa 📅 è un quadrato blu su iPhone, un calendario grigio su
 *    Windows, un foglio a strappo su Android. La schermata dei referenti cambia
 *    aspetto a seconda del telefono con cui la aprono, e non c'è verso di
 *    accordarla al navy e al giallo del gruppo.
 * 2. **Sono a colori, e i colori qui vogliono dire qualcosa.** In questa
 *    interfaccia il giallo è «in attesa», il rosso «bloccato», il verde «a
 *    posto» (§ `.adm-pill` di admin.css). Sei emoji multicolori accanto ai
 *    numeri portano colore che non significa niente e indeboliscono quello che
 *    significa.
 * 3. **Il carattere non c'è sempre.** Su un server o in un Linux senza font
 *    per gli emoji restano rettangoli vuoti.
 *
 * Sono quindi SVG in linea: nessuna richiesta di rete, `currentColor` così
 * l'icona prende il colore del testo che le sta accanto, e un tratto solo —
 * 1,6 px su una griglia di 24 — che è la densità di questa interfaccia.
 *
 * ## Come si usano
 *
 *   <Icona nome="persone" />                 // 18 px, colore del testo
 *   <Icona nome="calendario" misura={20} />
 *
 * `aria-hidden` su tutte: sono accanto a un'etichetta che dice già la stessa
 * cosa a parole («Tesseramento», «Nuova attività»), e ripeterla a chi ascolta
 * sarebbe rumore. Se un giorno un'icona resta sola, quella lì vuole un
 * `<title>` e non questo componente.
 */

import type { ReactNode } from "react";

export type NomeIcona =
  | "persone"
  | "calendario"
  | "foto"
  | "documento"
  | "piu"
  | "matita"
  | "immagine"
  | "coda"
  | "messaggio"
  | "etichetta"
  | "elenco"
  | "luogo"
  | "durata"
  | "spunta"
  | "cestino"
  | "carica"
  | "cartella"
  | "apri"
  | "freccia"
  // le nove della dashboard di sistema (§ DashboardSviluppatore.tsx)
  | "database"
  | "scudo"
  | "ingranaggio"
  | "chiave"
  | "lucchetto"
  | "attesa"
  | "allarme"
  | "server"
  | "nuvola";

/** I percorsi, tutti sulla griglia 24×24 di `viewBox`. */
const TRACCE: Record<NomeIcona, ReactNode> = {
  // Due teste e due spalle: il tesseramento, gli iscritti, gli utenti.
  persone: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.2 20c0-3.2 2.6-5.4 5.8-5.4s5.8 2.2 5.8 5.4" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 6" />
      <path d="M17.4 14.9c2 .7 3.4 2.5 3.4 5.1" />
    </>
  ),
  // Il calendario: due anelli, la traversa della testata, una griglia accennata.
  calendario: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10.5h17M8.5 3.5v4M15.5 3.5v4" />
      <path d="M8 14.5h2M14 14.5h2M8 17.5h2M14 17.5h2" />
    </>
  ),
  // La macchina fotografica: album e fotografie caricate.
  foto: (
    <>
      <path d="M3.5 8.5h3l1.6-2.4h7.8L17.5 8.5h3v11h-17z" />
      <circle cx="12" cy="13.8" r="3.4" />
    </>
  ),
  // Il foglio con l'angolo piegato: circolari, liste materiale, documenti.
  documento: (
    <>
      <path d="M6 3.5h7.5L19 9v11.5H6z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 13h7M9 16.5h7" />
    </>
  ),
  // Il cestino: tutto quello che si toglie.
  cestino: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4h5v2.5" />
      <path d="M6.5 6.5l.8 13h9.4l.8-13" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  // La freccia verso l'alto su un vassoio: caricare un file.
  carica: (
    <>
      <path d="M12 16V4.5M7.5 9 12 4.5 16.5 9" />
      <path d="M4.5 15.5v4h15v-4" />
    </>
  ),
  // La cartella: un gruppo di documenti.
  cartella: <path d="M3.5 6.5h6l2 2.4h9v10.6h-17z" />,
  // Il riquadro con la freccia in uscita: apre in un'altra scheda.
  apri: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
      <path d="M17.5 14v5.5h-12v-12H11" />
    </>
  ),
  // La freccia che indica un gruppo che si apre.
  freccia: <path d="M9 5.5 15.5 12 9 18.5" />,
  // Il più: tutto quello che si aggiunge.
  piu: <path d="M12 5v14M5 12h14" />,
  // La matita: tutto quello che si modifica.
  matita: (
    <>
      <path d="M4.5 19.5h4L20 8a2.5 2.5 0 0 0-3.5-3.5L5 16z" />
      <path d="M15.5 5.5 19 9" />
    </>
  ),
  // Il quadro con il sole: le fotografie delle pagine del sito.
  immagine: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="M3.5 16.5l4.8-4.3 4 3.6 3-2.6 5.2 4.6" />
    </>
  ),
  // Le tre righe con la freccia: la coda di lavoro, quello che aspetta un sì.
  coda: (
    <>
      <path d="M4 6.5h11M4 12h8M4 17.5h6" />
      <path d="M14 15.5l3 3 4-6.5" />
    </>
  ),
  // Il fumetto: i messaggi arrivati dal sito.
  messaggio: (
    <>
      <path d="M4 5.5h16v11H9.5L5 20.5v-4H4z" />
      <path d="M8 9.5h8M8 12.8h5" />
    </>
  ),
  // L'etichetta col foro: il nome e il marchio del gruppo.
  etichetta: (
    <>
      <path d="M12.4 3.6H20v7.6l-9 9-7.6-7.6z" />
      <circle cx="16.4" cy="7.6" r="1.5" />
    </>
  ),
  // La tavoletta: l'anagrafica delle unità.
  elenco: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="1.5" />
      <path d="M9 3.2h6v2.6H9z" />
      <path d="M8.5 10.5h7M8.5 14h7M8.5 17h4" />
    </>
  ),
  // La goccia rovesciata: il luogo di un'attività.
  luogo: (
    <>
      <path d="M12 21c4-4.6 6-8 6-10.6A6 6 0 0 0 6 10.4C6 13 8 16.4 12 21z" />
      <circle cx="12" cy="10.2" r="2.2" />
    </>
  ),
  // L'orologio: quanto dura.
  durata: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.4 2.2" />
    </>
  ),
  // La spunta: quello che è a posto.
  spunta: <path d="M5 12.6l4.6 4.4L19 7" />,
  // I tre dischi impilati: il database, e per estensione il backup.
  database: (
    <>
      <ellipse cx="12" cy="6.2" rx="7.5" ry="2.9" />
      <path d="M4.5 6.2v5.6c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V6.2" />
      <path d="M4.5 11.8v5.9c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9v-5.9" />
    </>
  ),
  // Lo scudo: la sicurezza, i controlli che proteggono qualcosa.
  scudo: (
    <>
      <path d="M12 3.2 20 6v6c0 4.3-3.2 7.4-8 8.8-4.8-1.4-8-4.5-8-8.8V6z" />
      <path d="M8.6 11.8 11 14.3l4.6-4.9" />
    </>
  ),
  // La ruota dentata: i servizi attorno all'applicazione.
  ingranaggio: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.6M12 18.6v2.6M4.5 12H2M22 12h-2.5M6.7 6.7 4.9 4.9M19.1 19.1l-1.8-1.8M17.3 6.7l1.8-1.8M4.9 19.1l1.8-1.8" />
    </>
  ),
  // Due unità da rack impilate, con la spia: la macchina sotto il sito.
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="6.8" rx="1.4" />
      <rect x="3.5" y="13.2" width="17" height="6.8" rx="1.4" />
      <path d="M11 7.4h6M11 16.6h6" />
      <path d="M7 7.4h.01M7 16.6h.01" strokeWidth="2.4" />
    </>
  ),
  // La nuvola: Cloudflare, cioè quello che sta fra il sito e i visitatori.
  nuvola: <path d="M7.4 18.6h9.8a3.9 3.9 0 0 0 .5-7.8 5.6 5.6 0 0 0-10.8 1.4 3.2 3.2 0 0 0 .5 6.4z" />,
  // La chiave: i permessi e le sessioni, cioè chi può entrare dove.
  chiave: (
    <>
      <circle cx="8.2" cy="15.8" r="3.6" />
      <path d="M10.8 13.2 19.4 4.6" />
      <path d="M16.2 7.8l2.2 2.2M18.4 5.6l2.2 2.2" />
    </>
  ),
  // Il lucchetto chiuso: i dati personali, il GDPR, i consensi.
  lucchetto: (
    <>
      <rect x="4.6" y="10.4" width="14.8" height="9.8" rx="1.6" />
      <path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8" />
      <path d="M12 14v2.6" />
    </>
  ),
  // I tre puntini in tondo: quello che è aperto, non fatto, in attesa.
  attesa: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M8.4 12h.01M12 12h.01M15.6 12h.01" strokeWidth="2.4" />
    </>
  ),
  // Il triangolo col punto esclamativo: quello che è guasto.
  allarme: (
    <>
      <path d="M12 3.8 21.4 20H2.6z" />
      <path d="M12 9.4v4.6M12 17h.01" />
    </>
  ),
};

export function Icona({
  nome,
  misura = 18,
  className,
}: {
  nome: NomeIcona;
  misura?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={misura}
      height={misura}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACCE[nome]}
    </svg>
  );
}
