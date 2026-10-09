import type { StatoAzione } from "@/lib/contenuti";

export type StatoSicurezzaProfilo = StatoAzione & {
  codici?: string[];
  segreto?: string;
  qr?: string;
};
