#!/usr/bin/env node
/**
 * Prova la configurazione della posta, e manda un avviso di verifica.
 *
 *   npm run posta:prova            dice se è configurata e a chi manderebbe
 *   npm run posta:prova -- --manda manda davvero un messaggio di prova
 *
 * Esiste perché una configurazione di posta che non si può provare si prova al
 * primo messaggio di una famiglia, ed è il momento sbagliato. Con `--manda` la
 * conversazione con il server avviene per davvero: se le credenziali sono
 * sbagliate o la porta è chiusa, si scopre adesso.
 *
 * Esce con `1` se la posta è configurata ma non funziona. **Non** esce con 1 se
 * non è configurata: quello è uno stato legittimo, e il sito lo gestisce.
 */
import { configurazionePosta, inviaAvviso } from "@/lib/posta";

const manda = process.argv.includes("--manda");
const c = configurazionePosta();

if (!c) {
  console.log("Posta NON configurata.");
  console.log("");
  console.log("Il sito funziona: i messaggi si salvano e si leggono da «Messaggi dal");
  console.log("sito». Nessuno riceve un avviso, e la schermata di conferma lo dice a");
  console.log("chi scrive invece di promettere il contrario.");
  console.log("");
  console.log("Per accenderla servono due righe — POSTA_HOST e POSTA_A: vedi");
  console.log("web/.env.esempio, sezione «POSTA IN USCITA».");
  const oauth = ["POSTA_TENANT_ID", "POSTA_CLIENT_ID", "POSTA_CLIENT_SECRET"];
  if (oauth.some((v) => process.env[v])) {
    console.log("");
    console.log("Attenzione: l'accesso OAuth2 è a metà. Servono TUTTE E TRE le");
    console.log("variabili (tenant, client id, segreto) più POSTA_UTENTE:");
    for (const v of [...oauth, "POSTA_UTENTE"]) {
      console.log(`  ${v.padEnd(20)} ${process.env[v] ? "impostata" : "MANCA"}`);
    }
  }
  process.exit(0);
}

console.log("Posta configurata:");
console.log(`  server     ${c.host}:${c.porta}  (${c.tls ? "TLS" : "STARTTLS"})`);
console.log(`  utente     ${c.utente ?? "— nessuna autenticazione —"}`);
console.log(
  c.oauth
    ? `  accesso    OAuth2 (app ${c.oauth.clientId}, tenant ${c.oauth.tenant})`
    : `  password   ${c.password ? "impostata" : "— nessuna —"}`,
);
console.log(`  mittente   ${c.da}`);
console.log(`  a          ${c.a}`);

if (!manda) {
  console.log("");
  console.log("Non ho mandato niente. Per provare davvero la conversazione col server:");
  console.log("  npm run posta:prova -- --manda");
  process.exit(0);
}

console.log("\nMando un messaggio di prova…");
const esito = await inviaAvviso(
  "[Label] Prova della posta in uscita",
  [
    "Questo è un messaggio di prova, mandato da «npm run posta:prova --manda».",
    "",
    "Se lo state leggendo, i messaggi del modulo contatti arriveranno qui,",
    "interi, con «Rispondi» che scrive a chi ha compilato il modulo.",
  ].join("\n"),
);

if (esito.ok) {
  console.log(`Partito. Controllate la casella ${c.a}.`);
  process.exit(0);
}

// `<3>` = errore per journald, come negli altri script
console.error(`<3>NON partito: ${esito.motivo}`);
console.error("");
console.error("Cose da guardare, in ordine: la porta è raggiungibile dal server?");
console.error("POSTA_TLS combacia con la porta? Il mittente è accettato dal");
console.error("fornitore? Le credenziali sono ancora valide?");
process.exit(1);
