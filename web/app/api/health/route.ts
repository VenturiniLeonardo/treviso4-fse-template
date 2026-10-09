import { databaseRisponde } from "@/lib/db/db";

/**
 * Sonda di stato: l'unica rotta HTTP scritta a mano prevista dal piano (§1).
 *
 * La interroga un controllo esterno ogni cinque minuti (§06 e §08 del piano
 * infrastrutturale) per decidere se il servizio è vivo e se avvisare via email.
 * Per questo deve essere: senza sessione, senza cache, veloce, e **senza toccare
 * dati applicativi** — una sonda che legge album o iscritti finirebbe per
 * misurare i dati invece del servizio, e diventerebbe anche un modo di contare
 * le righe senza aver fatto l'accesso.
 *
 * Il controllo del database è un `SELECT 1`: dice che il motore risponde, non
 * quante iscrizioni ci sono. È la distinzione che il piano chiede.
 *
 * **Risponde 503 se il database non risponde**, e non 200 con un campo a
 * `false`: una sonda esterna guarda il codice di stato, e un servizio che non
 * raggiunge il proprio database non è sano — servirebbe pagine pubbliche vuote
 * e rifiuterebbe ogni scrittura. Meglio dirlo nel modo che fa scattare
 * l'avviso.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const database = databaseRisponde();
  const stato = database ? "ok" : "degradato";

  return new Response(
    JSON.stringify({ stato, database, quando: new Date().toISOString() }) + "\n",
    {
      status: database ? 200 : 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        // una sonda che legge una risposta salvata non sta misurando niente
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
