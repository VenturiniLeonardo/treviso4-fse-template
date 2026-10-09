#!/usr/bin/env node
/**
 * La chiave OVH della dashboard dello sviluppatore, limitata alla lettura.
 *
 *   npm run ovh:chiave             chiede a OVH una chiave nuova
 *   npm run ovh:chiave -- --prova  controlla le tre chiavi già scritte
 *
 * ## Una volta sola, prima di tutto
 *
 * 1. Create l'applicazione su https://eu.api.ovh.com/createApp/ (login con
 *    l'account OVH che ha la VPS). Nome e descrizione a piacere, per esempio
 *    «sito-dashboard». OVH restituisce due valori: Application Key e
 *    Application Secret.
 * 2. Metteteli nell'ambiente, insieme agli altri:
 *        SITO_OVH_APP_KEY=...
 *        SITO_OVH_APP_SECRET=...
 * 3. Lanciate questo script. Chiede a OVH una Consumer Key con **soltanto**
 *    GET su /vps e /domain, e stampa un indirizzo: apritelo, entrate con
 *    l'account OVH, scegliete «Unlimited» come durata e convalidate.
 * 4. Scrivete la Consumer Key stampata qui sotto come SITO_OVH_CONSUMER_KEY,
 *    riavviate il sito, e controllate con `npm run ovh:chiave -- --prova`.
 *
 * Senza la convalida del punto 3 la chiave esiste ma non vale niente: le
 * chiamate tornano «This credential is not valid».
 */
import { clientOvh, configOvh, DIRITTI_OVH, ENDPOINT_OVH } from "@/lib/ovh";

const prova = process.argv.includes("--prova");
const regione = process.env.SITO_OVH_ENDPOINT?.trim() || "ovh-eu";
const base = ENDPOINT_OVH[regione] ?? regione;
const appKey = process.env.SITO_OVH_APP_KEY?.trim();

if (!appKey) {
  console.error(
    "Manca SITO_OVH_APP_KEY.\n" +
      "Create prima l'applicazione su https://eu.api.ovh.com/createApp/ e mettete\n" +
      "SITO_OVH_APP_KEY e SITO_OVH_APP_SECRET nell'ambiente. Le istruzioni\n" +
      "complete sono in cima a questo script.",
  );
  process.exit(1);
}

if (prova) {
  const c = configOvh();
  if ("mancano" in c) {
    console.error(`Mancano: ${c.mancano.join(", ")}`);
    process.exit(1);
  }
  try {
    const chiedi = await clientOvh(c);
    const vps = await chiedi("/vps");
    const domini = await chiedi("/domain");
    console.log(`endpoint: ${c.base}`);
    console.log(`VPS:      ${vps.length ? vps.join(", ") : "nessuna"}`);
    console.log(`domini:   ${domini.length ? domini.join(", ") : "nessuno"}`);
    if (vps.length > 1 && !c.vps) {
      console.log("\nCi sono più VPS: indicate quella del sito con SITO_OVH_VPS=<nome>.");
    }
    console.log("\nLe chiavi funzionano: la dashboard le userà al prossimo riavvio del sito.");
  } catch (e) {
    console.error(`Le chiavi non funzionano: ${e.message}`);
    console.error("Se dice «not valid», la Consumer Key non è stata convalidata: rilanciate senza --prova.");
    process.exit(1);
  }
  process.exit(0);
}

const r = await fetch(`${base}/auth/credential`, {
  method: "POST",
  headers: { "X-Ovh-Application": appKey, "Content-Type": "application/json" },
  body: JSON.stringify({ accessRules: DIRITTI_OVH }),
});
const corpo = await r.json().catch(() => null);
if (!r.ok || !corpo?.consumerKey) {
  console.error(`OVH ha rifiutato la richiesta: ${corpo?.message ?? r.status}`);
  console.error("Controllate SITO_OVH_APP_KEY e l'endpoint (SITO_OVH_ENDPOINT, predefinito ovh-eu).");
  process.exit(1);
}

console.log(`La chiave chiede soltanto:\n${DIRITTI_OVH.map((d) => `    ${d.method} ${d.path}`).join("\n")}\n`);
console.log("1. Aprite questo indirizzo, entrate con l'account OVH e convalidate");
console.log('   (durata: «Unlimited», o la dashboard smetterà di leggere alla scadenza):\n');
console.log(`   ${corpo.validationUrl}\n`);
console.log("2. Poi scrivete nell'ambiente (/etc/sito/ambiente sul server):\n");
console.log(`   SITO_OVH_CONSUMER_KEY=${corpo.consumerKey}\n`);
console.log("3. Riavviate il sito e controllate:  npm run ovh:chiave -- --prova");
