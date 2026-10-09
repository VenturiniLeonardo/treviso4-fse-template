import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CorniceAccesso } from "@/components/area/CorniceAccesso";
import { ModuloPasswordProvvisoria } from "@/components/area/ModuloPasswordProvvisoria";
import { primaSezioneDi } from "@/lib/data-area";
import { sessioneVivaCorrente } from "@/lib/sessione-server";
import { esci } from "../actions";

export const metadata: Metadata = {
  title: "Scegliete la password",
  robots: { index: false, follow: false },
};

/**
 * Il cambio obbligatorio della password provvisoria.
 *
 * Il proxy porta qui chi ha la sessione piena e la password ancora da cambiare,
 * da qualunque pagina dell'area. La pagina ripete il controllo per non
 * dipendere dal fatto che il proxy se ne ricordi.
 */
export default async function PasswordProvvisoria() {
  const viva = await sessioneVivaCorrente();
  if (!viva || viva.stato !== "attiva") redirect("/area-riservata/accedi");
  if (!viva.daCambiare) redirect(primaSezioneDi(viva.sessione.r));

  return (
    <CorniceAccesso
      titolo="Scegliete la vostra password"
      sottotitolo={
        <>
          Ciao {viva.sessione.n}. State usando la password provvisoria con cui è stato
          preparato l’account «{viva.sessione.u}»: prima di entrare sceglietene una che
          conoscete solo voi.
        </>
      }
      piede={
        <form action={esci}>
          Non siete {viva.sessione.n}?{" "}
          <button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline">
            Esci
          </button>
        </form>
      }
    >
      <ModuloPasswordProvvisoria />
    </CorniceAccesso>
  );
}
