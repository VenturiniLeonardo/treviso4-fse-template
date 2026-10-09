import { Archivo, IBM_Plex_Mono } from "next/font/google";

/**
 * I due caratteri del progetto grafico. `next/font` li scarica in fase di
 * compilazione e li serve dal nostro dominio: è quello che chiede §04 del piano
 * («i caratteri vanno ospitati sul dominio, non presi da Google Fonts»).
 *
 * Archivo fa tutto il testo — titoli, corpo, navigazione, moduli — ed è
 * variabile: un solo file per sottoinsieme contiene ogni peso. Elencare i pesi
 * non lo alleggerirebbe (Google serve lo stesso file da 34.940 byte per il
 * `latin` sia con l'asse intero sia con 400/600/700/800, misurato a ottobre
 * 2026), e spezzerebbe l'asse in facce separate. IBM Plex Mono ha pesi statici:
 * si prende solo quello che i fogli di stile usano, per le etichette, le date e
 * i dati.
 *
 * `subsets` decide soltanto **che cosa si precarica**. Le facce `latin-ext` (e
 * le altre) restano dichiarate nel CSS generato con il loro `unicode-range`, e
 * il browser le scarica solo se una pagina contiene un carattere che sta lì —
 * un cognome con la «ł», per esempio. Il testo italiano sta tutto in `latin`
 * (à è é ì ò ù, « », ’, €), che è l'unico che vale la pena precaricare.
 */

export const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const classiFont = `${archivo.variable} ${plexMono.variable}`;
