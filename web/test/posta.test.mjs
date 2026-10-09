import assert from "node:assert/strict";
import { createServer as creaHttp } from "node:http";
import { createServer } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

/**
 * L'avviso per posta ai gestori — §9 del piano.
 *
 * Le prove parlano con un **server SMTP vero**, finto ma vero: accetta la
 * conversazione, registra quello che riceve, e può rifiutare a comando. Non c'è
 * nessun finto trasporto: se un giorno `nodemailer` cambia il modo di negoziare
 * o di codificare le intestazioni, queste prove se ne accorgono, mentre un finto
 * continuerebbe a dire che va tutto bene.
 *
 * La prova più importante non è che il messaggio parta: è **che cosa contiene**.
 * L'avviso attraversa server che non controlliamo, e dentro non devono esserci
 * il nome, l'indirizzo o il testo di chi ha scritto — quelli restano nel
 * database, dietro l'accesso.
 */

let ricevuti = [];
let rifiuta = null; // { codice: 550 } per rispondere male al DATA
let autenticazioni = []; // le righe AUTH ricevute dal finto SMTP
let token = { stato: 200, richieste: [], emessi: 0 };
let portaToken;
let serverToken;
let porta;
let server;
let posta;

/** Un SMTP che parla davvero, e scrive quello che gli arriva. */
function apriServer() {
  return new Promise((risolvi) => {
    server = createServer((s) => {
      let dentroDati = false;
      let buffer = "";
      let corpo = [];
      s.write("220 finto.locale ESMTP\r\n");
      s.on("data", (b) => {
        buffer += b.toString("latin1");
        let i;
        while ((i = buffer.indexOf("\r\n")) >= 0) {
          const riga = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (dentroDati) {
            if (riga === ".") {
              dentroDati = false;
              if (rifiuta) {
                s.write(`${rifiuta.codice} 5.0.0 Rifiutato\r\n`);
              } else {
                ricevuti.push(corpo.join("\n"));
                s.write("250 2.0.0 Ok\r\n");
              }
              corpo = [];
            } else {
              corpo.push(riga);
            }
            continue;
          }
          const c = riga.split(" ")[0].toUpperCase();
          if (c === "EHLO" || c === "HELO") s.write("250-finto.locale\r\n250 AUTH PLAIN\r\n");
          else if (c === "AUTH") {
            autenticazioni.push(riga);
            s.write("235 2.7.0 Ok\r\n");
          }
          else if (c === "MAIL" || c === "RCPT") s.write("250 2.1.0 Ok\r\n");
          else if (c === "DATA") {
            dentroDati = true;
            s.write("354 Manda\r\n");
          } else if (c === "QUIT") {
            s.write("221 2.0.0 Ciao\r\n");
            s.end();
          } else s.write("250 2.0.0 Ok\r\n");
        }
      });
      s.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => {
      porta = server.address().port;
      risolvi();
    });
  });
}

/** Un endpoint di token che fa le veci di login.microsoftonline.com. */
function apriServerToken() {
  return new Promise((risolvi) => {
    serverToken = creaHttp((req, res) => {
      let corpo = "";
      req.on("data", (b) => (corpo += b));
      req.on("end", () => {
        token.richieste.push({ url: req.url, corpo: new URLSearchParams(corpo) });
        if (token.stato !== 200) {
          res.writeHead(token.stato, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_client", error_description: "SEGRETO-NELL'ERRORE" }));
          return;
        }
        token.emessi++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: `TOKEN-${token.emessi}`, expires_in: 3600 }));
      });
    });
    serverToken.listen(0, "127.0.0.1", () => {
      portaToken = serverToken.address().port;
      risolvi();
    });
  });
}

const AMBIENTE = [
  "POSTA_TENANT_ID",
  "POSTA_CLIENT_ID",
  "POSTA_CLIENT_SECRET",
  "POSTA_TOKEN_URL",
  "POSTA_HOST",
  "POSTA_PORTA",
  "POSTA_TLS",
  "POSTA_UTENTE",
  "POSTA_PASSWORD",
  "POSTA_DA",
  "POSTA_A",
];

before(async () => {
  await apriServer();
  await apriServerToken();
  posta = await import("@/lib/posta");
});

beforeEach(() => {
  ricevuti = [];
  rifiuta = null;
  autenticazioni = [];
  token = { stato: 200, richieste: [], emessi: 0 };
  for (const v of AMBIENTE) delete process.env[v];
});

after(() => {
  for (const v of AMBIENTE) delete process.env[v];
  server?.close();
  serverToken?.close();
});

/** Punta la configurazione al server finto. */
function configura(extra = {}) {
  process.env.POSTA_HOST = "127.0.0.1";
  process.env.POSTA_PORTA = String(porta);
  process.env.POSTA_TLS = "0";
  process.env.POSTA_A = "gestori@example.org";
  process.env.POSTA_DA = "avvisi@example.org";
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

// =========================================================================

describe("senza configurazione non succede niente di male", () => {
  it("non è configurata se manca l'host", () => {
    process.env.POSTA_A = "a@b.it";
    assert.equal(posta.configurazionePosta(), null);
    assert.equal(posta.postaConfigurata(), false);
  });

  it("non è configurata se manca il destinatario", () => {
    process.env.POSTA_HOST = "smtp.esempio.it";
    assert.equal(posta.configurazionePosta(), null);
  });

  it("mezza configurazione non è una configurazione", () => {
    // fallirebbe a ogni messaggio invece di dirlo una volta all'avvio
    process.env.POSTA_HOST = "smtp.esempio.it";
    process.env.POSTA_UTENTE = "tizio";
    process.env.POSTA_PASSWORD = "x";
    assert.equal(posta.configurazionePosta(), null, "senza POSTA_A non si manda a nessuno");
  });

  it("mandare senza configurazione non solleva e lo dichiara", async () => {
    const e = await posta.inviaAvviso("oggetto", "testo");
    assert.equal(e.ok, false);
    assert.equal(e.nonConfigurata, true, "non è un guasto: è uno stato legittimo");
  });
});

describe("la configurazione si legge dall'ambiente", () => {
  it("la 465 vuol dire TLS dall'inizio, le altre STARTTLS", () => {
    configura({ POSTA_PORTA: "465" });
    delete process.env.POSTA_TLS;
    assert.equal(posta.configurazionePosta().tls, true);

    configura({ POSTA_PORTA: "587" });
    delete process.env.POSTA_TLS;
    assert.equal(posta.configurazionePosta().tls, false);
  });

  it("POSTA_TLS ha comunque l'ultima parola", () => {
    configura({ POSTA_PORTA: "587", POSTA_TLS: "1" });
    assert.equal(posta.configurazionePosta().tls, true);
  });

  it("senza mittente si usa il destinatario", () => {
    configura();
    delete process.env.POSTA_DA;
    const c = posta.configurazionePosta();
    assert.equal(c.da, c.a);
  });

  it("una porta assurda non passa per buona", () => {
    configura({ POSTA_PORTA: "settantatre" });
    assert.equal(posta.configurazionePosta(), null);
    configura({ POSTA_PORTA: "99999" });
    assert.equal(posta.configurazionePosta(), null);
  });

  it("l'autenticazione è facoltativa: un relay locale non la vuole", () => {
    configura();
    const c = posta.configurazionePosta();
    assert.equal(c.utente, undefined);
    assert.equal(c.password, undefined);
  });
});

describe("il messaggio parte", () => {
  it("arriva al server con oggetto e destinatario giusti", async () => {
    configura();
    const e = await posta.inviaAvviso("[Label] Prova", "corpo del messaggio");
    assert.equal(e.ok, true, e.motivo);
    assert.equal(ricevuti.length, 1);
    assert.match(ricevuti[0], /To: gestori@example\.org/);
    assert.match(ricevuti[0], /From: avvisi@example\.org/);
  });

  it("il testo che gli si dà è quello che arriva", async () => {
    configura();
    await posta.inviaAvviso("oggetto", "una riga riconoscibile");
    // il corpo può essere codificato quoted-printable: si guarda la sostanza
    const decodificato = ricevuti[0].replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    assert.match(decodificato, /una riga riconoscibile/);
  });

  it("Reply-To porta l'indirizzo di chi ha scritto", async () => {
    configura();
    const e = await posta.inviaAvviso("oggetto", "corpo", { rispondiA: "famiglia@esempio.it" });
    assert.equal(e.ok, true, e.motivo);
    assert.match(ricevuti[0], /Reply-To: famiglia@esempio\.it/);
  });

  it("senza rispondiA non c'è Reply-To", async () => {
    configura();
    await posta.inviaAvviso("oggetto", "corpo");
    assert.doesNotMatch(ricevuti[0], /Reply-To/);
  });

  it("con l'autenticazione configurata la conversazione riesce lo stesso", async () => {
    configura({ POSTA_UTENTE: "avvisi", POSTA_PASSWORD: "segreta" });
    const e = await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(e.ok, true, e.motivo);
  });
});

describe("quando la posta non va", () => {
  it("un rifiuto definitivo non si ritenta, e dice che è definitivo", async () => {
    configura();
    rifiuta = { codice: 550 };
    const e = await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(e.ok, false);
    assert.match(e.motivo, /definitivo/);
    assert.match(e.motivo, /550/);
  });

  it("il motivo non contiene il corpo del messaggio", async () => {
    configura();
    rifiuta = { codice: 550 };
    const e = await posta.inviaAvviso("oggetto", "IL-TESTO-SEGRETO-DI-CHI-SCRIVE");
    assert.equal(
      e.motivo.includes("IL-TESTO-SEGRETO-DI-CHI-SCRIVE"),
      false,
      "il motivo finisce nel registro del servizio: non deve portarsi dietro il messaggio",
    );
  });

  it("un server irraggiungibile non solleva: restituisce un esito", async () => {
    // una porta su cui non ascolta nessuno
    configura({ POSTA_HOST: "127.0.0.1", POSTA_PORTA: "1" });
    const e = await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(e.ok, false);
    assert.ok(e.motivo, "deve dire perché");
    assert.notEqual(e.nonConfigurata, true, "configurata lo era: è un guasto, non un'assenza");
  });
});

describe("accesso OAuth2 a Microsoft 365", () => {
  // il token si tiene in memoria per client: ogni prova ne usa uno suo
  let n = 0;
  const oauth = (extra = {}) =>
    configura({
      POSTA_UTENTE: "segreteria@example.org",
      POSTA_TENANT_ID: "tenant-di-prova",
      POSTA_CLIENT_ID: `client-di-prova-${++n}`,
      POSTA_CLIENT_SECRET: "SEGRETO-DEL-CLIENT",
      POSTA_TOKEN_URL: `http://127.0.0.1:${portaToken}/tenant-di-prova/token`,
      ...extra,
    });

  /** nodemailer manda `AUTH XOAUTH2 <base64>`: dentro ci sono utente e token */
  const xoauth = () => {
    const riga = autenticazioni.find((r) => /XOAUTH2/i.test(r));
    assert.ok(riga, "il server doveva ricevere un AUTH XOAUTH2");
    return Buffer.from(riga.split(" ")[2], "base64").toString("utf8");
  };

  it("chiede il token con le credenziali dell'app e lo usa per entrare", async () => {
    oauth();
    const e = await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(e.ok, true, e.motivo);

    assert.equal(token.richieste.length, 1);
    const r = token.richieste[0].corpo;
    assert.equal(r.get("grant_type"), "client_credentials");
    assert.equal(r.get("client_id"), `client-di-prova-${n}`);
    assert.equal(r.get("client_secret"), "SEGRETO-DEL-CLIENT");
    assert.equal(r.get("scope"), "https://outlook.office365.com/.default");

    const a = xoauth();
    assert.match(a, /user=segreteria@example\.org/);
    assert.match(a, /auth=Bearer TOKEN-1/);
    assert.equal(ricevuti.length, 1);
  });

  it("il token si riusa finché non scade", async () => {
    oauth();
    await posta.inviaAvviso("uno", "corpo");
    await posta.inviaAvviso("due", "corpo");
    assert.equal(token.richieste.length, 1, "un solo token per due messaggi");
    assert.equal(ricevuti.length, 2);
  });

  it("con OAuth2 la password, se c'è, non viene usata", async () => {
    oauth({ POSTA_PASSWORD: "PASSWORD-VECCHIA" });
    const c = posta.configurazionePosta();
    assert.equal(c.password, undefined);
    await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(autenticazioni.some((r) => /PASSWORD-VECCHIA|PLAIN|LOGIN/i.test(r) && !/XOAUTH2/i.test(r)), false);
  });

  it("mezza configurazione OAuth2 vale come nessuna", () => {
    oauth({ POSTA_CLIENT_SECRET: "" });
    delete process.env.POSTA_CLIENT_SECRET;
    assert.equal(posta.configurazionePosta(), null);
    oauth();
    delete process.env.POSTA_UTENTE;
    assert.equal(posta.configurazionePosta(), null, "senza la casella non si sa per chi si entra");
  });

  it("un token rifiutato è un esito definitivo, e non riporta né segreto né errore di Microsoft", async () => {
    oauth();
    token.stato = 401;
    const e = await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(e.ok, false);
    assert.match(e.motivo, /token OAuth2 rifiutato \(HTTP 401\)/);
    assert.match(e.motivo, /definitivo/);
    assert.equal(token.richieste.length, 1, "un 401 non si ritenta");
    for (const v of ["SEGRETO-DEL-CLIENT", "SEGRETO-NELL'ERRORE"]) {
      assert.equal(e.motivo.includes(v), false, `il motivo finisce nel registro: niente «${v}»`);
    }
    assert.equal(ricevuti.length, 0);
  });

  it("l'endpoint dei token irraggiungibile non solleva", async () => {
    oauth({ POSTA_TOKEN_URL: "http://127.0.0.1:1/token" });
    const e = await posta.inviaAvviso("oggetto", "corpo");
    assert.equal(e.ok, false);
    assert.notEqual(e.nonConfigurata, true);
  });
});
