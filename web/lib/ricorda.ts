/**
 * Una lettura di rete, ricordata per un po'.
 *
 * La dashboard dello sviluppatore chiede cose a servizi fuori dal processo —
 * il proprio dominio in TLS, l'API di Cloudflare, quella di OVH — e nessuna di
 * queste cambia da un minuto all'altro. Senza memoria ogni apertura della
 * schermata rifarebbe tutte le chiamate: lenta con un servizio giù (i tempi
 * di attesa si sommano), e con OVH e Cloudflare anche a rischio dei loro
 * limiti di richieste.
 *
 * Si ricorda la **promessa**, non il risultato: due aperture nello stesso
 * istante aspettano la stessa lettura invece di farne due. E si ricorda anche
 * un fallimento, per lo stesso tempo: un servizio che non risponde non va
 * interrogato di nuovo a ogni ricarica — la riga dice «non raggiungibile» e
 * tra qualche minuto si riprova.
 */
export function ricorda<T>(durataMs: number, leggi: () => Promise<T>): () => Promise<T> {
  let memoria: { quando: number; dati: Promise<T> } | null = null;
  return () => {
    if (memoria && Date.now() - memoria.quando < durataMs) return memoria.dati;
    memoria = { quando: Date.now(), dati: leggi() };
    return memoria.dati;
  };
}
