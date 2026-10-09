import { redirect } from "next/navigation";
import { primaSezioneDi } from "@/lib/data-area";
import { sessioneCorrente } from "@/lib/sessione-server";

export const dynamic = "force-dynamic";

/**
 * /area-riservata manda ciascuno alla vista del proprio ruolo se autenticato,
 * oppure alla pagina di accesso se non c'è una sessione attiva.
 */
export default async function AreaRiservata() {
  const sessione = await sessioneCorrente();
  if (!sessione) {
    redirect("/area-riservata/accedi");
  }

  redirect(primaSezioneDi(sessione.r));
}
