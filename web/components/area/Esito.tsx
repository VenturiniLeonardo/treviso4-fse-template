"use client";

import clsx from "clsx";
import type { StatoAzione } from "@/lib/contenuti";

/**
 * L'esito di una Server Action, sotto il modulo che l'ha invocata.
 *
 * Stava in `components/area/EditorRiga.tsx`, insieme all'editor delle tabelle
 * del prototipo. Quel file è andato via con la fase 14.10 e questo componente
 * no: lo usano dodici schermate, ed è l'unica cosa di quell'editor che le
 * schermate vere si sono portate dietro.
 *
 * `role="status"` e non `role="alert"`: un esito compare dopo un'azione che
 * l'utente ha appena fatto, e un lettore di schermo che interrompe la lettura
 * per annunciarlo è più fastidioso che utile. Con `status` lo legge quando
 * arriva al punto.
 */
export function Esito({ stato }: { stato: StatoAzione }) {
  if (stato.stato === "vuoto") return null;
  return (
    <p
      className={clsx("adm-esito", stato.stato === "errore" ? "adm-esito--ko" : "adm-esito--ok")}
      role="status"
    >
      {stato.messaggio}
    </p>
  );
}
