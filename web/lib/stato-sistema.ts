/**
 * Tutti i controlli di sistema, raccolti una volta.
 *
 * Li usano due schermate: la dashboard dello sviluppatore, che ne mostra solo
 * il verdetto e le righe non a posto, e «Stato del sistema», che li mostra
 * tutti. Chiederli da un posto solo è la garanzia che le due non dicano cose
 * diverse — «tutto a posto» in una, un guasto nell'altra.
 *
 * Sta in un modulo a sé e non in `diagnostica.ts` perché macchina, Cloudflare
 * e OVH importano da `diagnostica.ts` il tipo dei controlli: raccoglierli là
 * dentro vorrebbe dire un giro di importazioni.
 */

import { type Controllo, contiAccount, controlliMotore, controlliServizi, controlliSicurezza } from "@/lib/diagnostica";
import { controlliCertificati, controlliMacchina, controlliServiziSistema } from "@/lib/macchina";
import { statoCloudflare, type OraTraffico } from "@/lib/cloudflare";
import { controlliOvh } from "@/lib/ovh";

export interface StatoSistema {
  gruppi: Record<Controllo["gruppo"], Controllo[]>;
  tutti: Controllo[];
  /** il traffico orario di Cloudflare, se il token lo può leggere */
  traffico: OraTraffico[] | null;
}

export async function statoSistema(): Promise<StatoSistema> {
  const conti = contiAccount();
  const [servizi, certificati, cloudflare, ovh] = await Promise.all([
    controlliServiziSistema(),
    controlliCertificati(),
    statoCloudflare(),
    controlliOvh(),
  ]);
  const gruppi = {
    motore: controlliMotore(),
    sicurezza: controlliSicurezza(conti),
    servizi: controlliServizi(),
    macchina: [...controlliMacchina(), ...servizi],
    certificati,
    cloudflare: cloudflare.controlli,
    ovh,
  };
  return { gruppi, tutti: Object.values(gruppi).flat(), traffico: cloudflare.orario };
}
