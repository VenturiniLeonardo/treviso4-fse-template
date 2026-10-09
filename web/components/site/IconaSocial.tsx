/**
 * Le icone dei profili social, per le pastiglie del piede.
 *
 * SVG in linea come le icone dell'area (components/area/Icone.tsx): nessuna
 * richiesta di rete, `currentColor` così prendono il bianco della pastiglia e
 * il giallo al passaggio del mouse, e un tratto solo su una griglia di 24. Sono
 * i segni monocromi dei servizi, non i loghi a colori: nel piede navy il
 * gradiente di Instagram e il blu di Facebook sarebbero gli unici colori che
 * non sono del gruppo.
 *
 * `aria-hidden`: il nome del servizio lo dice a parole lo `<span>` nascosto
 * che sta accanto all'icona.
 */

import type { ReactNode } from "react";

const SEGNI: Record<string, ReactNode> = {
  IG: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  FB: <path d="M17 3h-3a4.5 4.5 0 0 0-4.5 4.5V10H7v4h2.5v7h4v-7h3l.5-4h-3.5V7.5a1 1 0 0 1 1-1H17z" />,
  YT: (
    <>
      <path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </>
  ),
};

export function IconaSocial({ sigla, misura = 20 }: { sigla: string; misura?: number }) {
  const segno = SEGNI[sigla];
  if (!segno) return <>{sigla}</>;
  return (
    <svg
      width={misura}
      height={misura}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {segno}
    </svg>
  );
}
