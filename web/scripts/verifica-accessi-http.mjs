/** Verifiche HTTP su un Next locale: soltanto dati sintetici e database temporaneo. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const cartella = mkdtempSync(join(tmpdir(), "t4-sicurezza-http-"));
process.env.SITO_DB = join(cartella, "test.db");
process.env.SITO_DATI_DIR = cartella;
process.env.SITO_TOTP_SEGRETO = randomBytes(48).toString("base64");
// Il distDir separato conserva l'eventuale server di sviluppo già in uso.
const dist = `.next-sicurezza-${randomBytes(6).toString("hex")}`;
const tsconfigPrima = readFileSync("tsconfig.json", "utf8");
let child, raw, chiudiPerTest;
let log = "";
let verifiche = 0;
try {
  raw = new Database(process.env.SITO_DB);
  migrate(drizzle(raw), { migrationsFolder: "./drizzle" });
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  const utenti = await import("@/lib/utenti");
  const sessioni = await import("@/lib/auth/sessioni");
  const totp = await import("@/lib/auth/totp");
  const { assicuraRiferimenti } = await import("@/lib/db/riferimenti");
  assicuraRiferimenti();
  const password = "password-sintetica-http-2026";
  const id = utenti.creaUtente({ utente: "prova-http", nome: "Account Sintetico", iniziali: "AS", ruolo: "gestore" });
  await utenti.impostaPassword(id, password);
  const segreto = utenti.iniziaTotp(id);
  const prima = Date.now() - 60_000;
  assert.ok(utenti.confermaTotp(id, totp.codiceAlPasso(segreto, totp.passoDi(prima)), prima));
  const cu = utenti.creaUtente({ utente: "unita-http", nome: "Unità Sintetica", iniziali: "US", ruolo: "referente", unita: "u1" });
  await utenti.impostaPassword(cu, password);

  const probe = createServer();
  const listening = once(probe, "listening");
  probe.listen(0, "127.0.0.1");
  await listening;
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origine = `http://127.0.0.1:${port}`;
  const produzione = process.argv.includes("--produzione");
  if (produzione) {
    const build = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
      env: { ...process.env, SITO_DIST_DIR: dist, SITO_BASE_URL: origine, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    build.stdout.on("data", (d) => { log = (log + d).slice(-12000); });
    build.stderr.on("data", (d) => { log = (log + d).slice(-12000); });
    assert.equal((await once(build, "exit"))[0], 0, "Build di produzione fallita");
    console.log("PASS build di produzione");
  }
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...(produzione ? ["start"] : ["dev", "--webpack"]), "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, SITO_DIST_DIR: dist, SITO_BASE_URL: origine, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => { log = (log + d).slice(-12000); });
  child.stderr.on("data", (d) => { log = (log + d).slice(-12000); });
  const url = (p) => origine + p;
  const login = "/area-riservata/accedi";
  const area = "/area-riservata/gestore/documenti";
  const cookie = (token) => `sito_sessione=${token}`;
  const get = (p, token, extra = {}) => fetch(url(p), { redirect: "manual", headers: { ...(token ? { cookie: cookie(token) } : {}), ...extra } });
  for (let n = 0; ; n++) {
    try { if ((await get(login)).status === 200) break; } catch { /* avvio in corso */ }
    if (n >= 100 || child.exitCode !== null) throw new Error(`Next non disponibile: ${log}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  // In sviluppo la panoramica dello sviluppatore interroga la home: se è la
  // prima volta, next dev la compila a metà richiesta e webpack risponde 500
  // («__webpack_modules__[moduleId] is not a function»). Si compila prima.
  if (!produzione) await (await get("/")).text();
  async function check(nome, fn) { await fn(); verifiche++; console.log(`PASS ${nome}`); }
  async function negato(p, token, destinazione = login, extra) {
    const r = await get(p, token, extra);
    assert.equal(r.status, 307);
    assert.ok(new URL(r.headers.get("location"), origine).pathname.startsWith(destinazione));
  }
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  async function invia(p, campi, token, origin = origine, contiene) {
    const pagina = await (await get(p, token)).text();
    const forms = pagina.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
    const form = forms.find((f) => contiene ? f.includes(contiene) : f.includes(`name="${campi.codice !== undefined ? "codice" : "utente"}"`));
    assert.ok(form, "modulo non trovato");
    const data = new FormData();
    for (const input of form.matchAll(/<input\b[^>]*>/g)) {
      const attrs = Object.fromEntries(Array.from(input[0].matchAll(/([\w:$-]+)="([^"]*)"/g), (m) => [m[1], decode(m[2])]));
      if (attrs.type === "hidden" && attrs.name) data.set(attrs.name, attrs.value ?? "");
    }
    for (const [k, v] of Object.entries(campi)) data.set(k, v);
    return fetch(url(p), { method: "POST", body: data, redirect: "manual", headers: { origin, ...(token ? { cookie: cookie(token) } : {}) } });
  }
  await check("anonimo respinto da area ed esportazione", async () => {
    await negato(area); await negato("/area-riservata/esporta/iscritti");
  });
  await check("header di bypass middleware non aprono l'area", () => negato(area, undefined, login, { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" }));
  await check("cookie falsificati e input SQL respinti", async () => {
    for (const token of ["inventato", "' OR 1=1 --", Buffer.from('{"r":"sviluppatore"}').toString("base64url")]) await negato(area, token);
  });
  const parziale = sessioni.apri(id, null, "attesa_totp");
  await check("password senza TOTP non apre area o esportazione", async () => {
    await negato(area, parziale, login + "/totp");
    await negato("/area-riservata/esporta/iscritti", parziale, login + "/totp");
  });
  await check("referente di unità non apre la vista del gestore", async () => {
    const token = sessioni.apri(cu, null);
    await negato(area, token, "/area-riservata/referente");
  });
  await check("con la password provvisoria si apre solo il cambio password", async () => {
    const pp = utenti.creaUtente({ utente: "provvisoria-http", nome: "Provvisoria Sintetica", iniziali: "PS", ruolo: "gestore" });
    await utenti.impostaPasswordProvvisoria(pp, "provvisoria!");
    const token = sessioni.apri(pp, null);
    const cambio = "/area-riservata/accedi/password";
    for (const p of [area, "/area-riservata", login, "/area-riservata/esporta/iscritti", "/anteprima/unita/u1"]) {
      await negato(p, token, cambio);
    }
    const r = await get(cambio, token);
    assert.equal(r.status, 200); assert.match(await r.text(), /Scegliete la vostra password/);
    // senza sessione la pagina del cambio non si apre
    await negato(cambio, undefined, login);
  });
  await check("sessione scaduta respinta", async () => {
    const token = sessioni.apri(id, null);
    raw.prepare("update sessioni set scade_il = '2000-01-01T00:00:00Z' where impronta = ?").run(sessioni.improntaDi(token));
    await negato(area, token);
  });
  await check("logout rende inutilizzabile il vecchio token", async () => {
    const token = sessioni.apri(id, null); sessioni.chiudi(token); await negato(area, token);
  });
  await check("richiesta cross-origin rifiutata senza creare sessioni", async () => {
    const prima = raw.prepare("select count(*) n from sessioni").get().n;
    const r = await invia(login, { utente: "prova-http", password }, undefined, "https://estraneo.invalid");
    // 403 dal proxy: Next da sé la respingerebbe con un 500 (QA, BUG-004)
    assert.equal(r.status, 403); assert.equal(raw.prepare("select count(*) n from sessioni").get().n, prima);
  });
  await check("ruolo forgiato non autentica", async () => {
    const r = await invia(login, { utente: "nessuno", password: "errata", ruoloDemo: "sviluppatore" });
    assert.equal(r.status, 200); assert.match(await r.text(), /Nome utente o password non corretti/);
    assert.ok(!r.headers.get("set-cookie")?.includes("sito_sessione="));
  });
  raw.prepare("delete from tentativi_accesso").run();
  await check("cinque errori HTTP bloccano il sesto login", async () => {
    for (let n = 0; n < 5; n++) {
      const r = await invia(login, { utente: "prova-http", password: "errata" });
      assert.match(await r.text(), /Nome utente o password non corretti/);
    }
    const r = await invia(login, { utente: "prova-http", password });
    assert.equal(r.status, 200); assert.match(await r.text(), /Troppi tentativi/);
  });
  raw.prepare("delete from tentativi_accesso").run();
  let token;
  await check("login corretto crea soltanto una sessione in attesa del TOTP", async () => {
    const r = await invia(login, { utente: "prova-http", password });
    assert.equal(r.status, 303);
    token = /sito_sessione=([^;]+)/.exec(r.headers.get("set-cookie"))?.[1];
    assert.ok(token); assert.equal(sessioni.leggi(token).stato, "attesa_totp");
    await negato(area, token, login + "/totp");
  });
  await check("TOTP errato lascia la sessione in attesa", async () => {
    const r = await invia(login + "/totp", { codice: "non-numerico" }, token);
    assert.equal(r.status, 200); assert.equal(sessioni.leggi(token).stato, "attesa_totp");
  });
  await check("TOTP corretto apre l'area con CSP e cookie HttpOnly", async () => {
    const codice = totp.codiceAlPasso(segreto, totp.passoDi(Date.now()));
    const r = await invia(login + "/totp", { codice }, token);
    assert.equal(r.status, 303); assert.equal(sessioni.leggi(token).stato, "attiva");
    assert.match(r.headers.get("set-cookie"), /HttpOnly/i);
    const pagina = await get(area, token);
    assert.equal(pagina.status, 200); assert.match(pagina.headers.get("content-security-policy"), /nonce-/);
  });

  await check("profilo senza cambio password, chiusura soltanto degli accessi propri", async () => {
    const propria = sessioni.apri(id, null), altrui = sessioni.apri(cu, null);
    const p = "/area-riservata/profilo";
    const html = await (await get(p, token)).text();
    assert.match(html, /Verifica con codice e recupero accesso/); assert.doesNotMatch(html, /name="attuale"|Aggiorna la password/);
    const tentativo = await invia(p, { id: String(sessioni.leggi(altrui).id) }, token, origine, "Chiudi accesso");
    assert.equal(tentativo.status, 200); assert.ok(sessioni.leggi(altrui));
    const r = await invia(p, {}, token, origine, "Esci dagli altri dispositivi");
    assert.equal(r.status, 200); assert.equal(sessioni.leggi(propria), null); assert.ok(sessioni.leggi(token)); assert.ok(sessioni.leggi(altrui));
  });
  await check("modifica account consentita, promozione a admin negata", async () => {
    const p = "/area-riservata/gestore/utenti";
    const dati = { id: String(cu), nome: "Nome Aggiornato HTTP", iniziali: "NA", email: "", ruolo: "referente", unita: "u4" };
    const r = await invia(p, dati, token, origine, "Salva account");
    assert.equal(r.status, 200); assert.equal(utenti.utentePerId(cu).unita, "u4");
    const negata = await invia(p, { ...dati, ruolo: "sviluppatore", unita: "" }, token, origine, "Salva account");
    assert.equal(negata.status, 200); assert.equal(utenti.utentePerId(cu).ruolo, "referente");
  });
  const permessiStore = await import("@/lib/permessi-store");
  await permessiStore.ripristinaMatrice();
  await check("una sezione chiusa è 404 e anche l'export è vietato", async () => {
    await permessiStore.impostaLivello("messaggi", "gestore", "nessuno");
    assert.equal((await get("/area-riservata/gestore/messaggi", token)).status, 404);
    assert.equal((await get("/area-riservata/esporta/messaggi", token)).status, 403);
  });
  await check("squadre rimosse e matrice del gestore in sola lettura", async () => {
    const cuToken = sessioni.apri(cu, null);
    assert.equal((await get("/area-riservata/referente/squadre", cuToken)).status, 404);
    const html = await (await get("/area-riservata/gestore/permessi", token)).text();
    // la sola lettura non ha più un'etichetta: è l'assenza dei comandi
    assert.match(html, /Chi può fare che cosa/); assert.doesNotMatch(html, /name="livello"|Ripristina|Togli riga/);
  });

  await check("il social non vede né cambia password, e su un album approvato non ritira né elimina", async () => {
    const socialId = utenti.creaUtente({ utente: "social-http", nome: "Social Sintetico", iniziali: "SS", ruolo: "social" });
    await utenti.impostaPassword(socialId, password);
    const socialToken = sessioni.apri(socialId, null);
    const adminId = utenti.creaUtente({ utente: "admin-http", nome: "Admin Sintetico", iniziali: "AD", ruolo: "sviluppatore" });
    await utenti.impostaPassword(adminId, password);
    const adminToken = sessioni.apri(adminId, null);
    // spenti di predefinito dal 6 ottobre: la sezione non esiste finché lo
    // sviluppatore non gira l'interruttore
    assert.equal((await get("/area-riservata/social/album", socialToken)).status, 404);
    await (await import("@/lib/funzioni")).impostaAlbumAttivi(true);
    const albumStore = await import("@/lib/album");
    const serrature = await import("@/lib/album-accesso");
    const slug = await albumStore.creaAlbum({ titolo: "Album Sintetico Social", anno: "2026 – 2027", data: "Ottobre 2026", unita: "u4", sottotitolo: "", tag: "sintetico" }, Date.now(), "social-http");
    serrature.impostaPasswordAlbum(slug, "segreto-album-http");
    const p = `/area-riservata/social/album?album=${slug}`;
    const html = await (await get(p, socialToken)).text();
    assert.doesNotMatch(html, /segreto-album-http|name="password"/);
    // Usa il vero riferimento dell'azione destinata all'admin, con il cookie social.
    const adminHtml = await (await get(`/area-riservata/gestore/album?album=${slug}`, adminToken)).text();
    const form = (adminHtml.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes('id="password"'));
    assert.ok(form);
    const data = new FormData();
    for (const input of form.matchAll(/<input\b[^>]*>/g)) {
      const attrs = Object.fromEntries(Array.from(input[0].matchAll(/([\w:$-]+)="([^"]*)"/g), (m) => [m[1], decode(m[2])]));
      if (attrs.type === "hidden" && attrs.name) data.set(attrs.name, attrs.value ?? "");
    }
    data.set("slug", slug); data.set("password", "password-contraffatta");
    const r = await fetch(url(p), { method: "POST", body: data, headers: { origin: origine, cookie: cookie(socialToken) }, redirect: "manual" });
    assert.equal(r.status, 200); assert.equal(serrature.passwordDellAlbum(slug), "segreto-album-http");
    await albumStore.cambiaStatoAlbum(slug, "pubblicato", Date.now(), "admin-http");
    // dal 6 ottobre 2026 ci lavora anche dopo l'approvazione — ogni modifica lo
    // rimanda ai gestori —, ma la password resta loro, e così ritirarlo ed eliminarlo
    const approvato = await (await get(p, socialToken)).text();
    assert.match(approvato, /name="titolo"/);
    assert.doesNotMatch(approvato, /segreto-album-http|name="password"|Ritira dalla pubblicazione|Elimina l’album/);
  });
  await check("il social non riceve nel payload le proposte di recapiti e nomi dei referenti", async () => {
    // QA VULN-001: la scheda nascondeva i campi nel client, ma le proposte
    // arrivavano intere nel payload RSC. Si cerca nel corpo integrale.
    const unitaStore = await import("@/lib/unita-store");
    await unitaStore.proponiCampiUnita("u4", {
      telefono: "RECAPITO-RISERVATO-HTTP-739201",
      referente: "NOME-NON-PUBBLICATO-HTTP-739201",
      ruoloReferente: "RUOLO-NON-PUBBLICATO-HTTP-739201",
      motto: "MOTTO-PROPOSTO-HTTP-739201",
    }, "unita-http");
    const socialToken = sessioni.apri(utenti.trovaUtente("social-http").id, null);
    const r = await get("/area-riservata/social/testi-unita?u=u4", socialToken);
    assert.equal(r.status, 200);
    const corpo = await r.text();
    assert.match(corpo, /MOTTO-PROPOSTO-HTTP-739201/, "il testo proposto deve esserci: è suo");
    assert.doesNotMatch(corpo, /RECAPITO-RISERVATO|NOME-NON-PUBBLICATO|RUOLO-NON-PUBBLICATO/);
  });
  await check("il permesso di gestire account non consente azioni sulla matrice", async () => {
    const adminId = utenti.trovaUtente("admin-http").id;
    const adminToken = sessioni.apri(adminId, null);
    const html = await (await get("/area-riservata/sviluppatore/permessi", adminToken)).text();
    const form = (html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes('name="livello"'));
    assert.ok(form);
    const data = new FormData();
    for (const input of form.matchAll(/<input\b[^>]*>/g)) {
      const attrs = Object.fromEntries(Array.from(input[0].matchAll(/([\w:$-]+)="([^"]*)"/g), (m) => [m[1], decode(m[2])]));
      if (attrs.type === "hidden" && attrs.name) data.set(attrs.name, attrs.value ?? "");
    }
    data.set("id", "messaggi"); data.set("ruolo", "gestore"); data.set("livello", "completo");
    const r = await fetch(url("/area-riservata/gestore/permessi"), { method: "POST", body: data, headers: { origin: origine, cookie: cookie(token) }, redirect: "manual" });
    assert.equal(r.status, 200);
    assert.equal(raw.prepare("SELECT livello FROM permessi WHERE funzione = 'messaggi' AND ruolo = 'gestore'").get().livello, "nessuno");
  });
  await check("codici di recupero: login monouso e ritorno al profilo", async () => {
    const sicurezza = await import("@/lib/auth/profilo-sicurezza");
    const codici = sicurezza.generaCodiciRecupero(id, sessioni.leggi(token).id);
    const parziale = sessioni.apri(id, null, "attesa_totp");
    const r = await invia(login + "/totp", { codice: codici[0] }, parziale);
    assert.equal(r.status, 303); assert.ok(r.headers.get("location").includes("/area-riservata/profilo"));
    const altra = sessioni.apri(id, null, "attesa_totp");
    const replay = await invia(login + "/totp", { codice: codici[0] }, altra);
    assert.equal(replay.status, 200); assert.equal(sessioni.leggi(altra).stato, "attesa_totp");
  });
  await check("revoca impedisce subito l'accesso HTTP", async () => {
    utenti.revoca(id); await negato(area, token);
  });
  const { verificaFunzioniArea } = await import("./verifica-funzioni-area.mjs");
  await verificaFunzioniArea({ raw, utenti, sessioni, get, url, origine, check, password });
  console.log(`\n${verifiche} verifiche HTTP superate (Next ${produzione ? "production" : "dev"}, demo disattivata, dati sintetici).`);
} catch (errore) {
  console.error(log);
  throw errore;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  chiudiPerTest?.(); raw?.close();
  rmSync(cartella, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
  // Next aggiunge il proprio distDir agli include. Togli solo le righe di
  // questa prova; eventuali modifiche concorrenti dell'utente restano.
  const attuale = readFileSync("tsconfig.json", "utf8");
  const ripulito = attuale.replace(new RegExp(`,?\\n    "${dist.replaceAll(".", "\\.")}/(?:dev/)?types/\\*\\*/\\*\\.ts"`, "g"), "");
  if (ripulito !== attuale) {
    const uguale = JSON.stringify(JSON.parse(ripulito)) === JSON.stringify(JSON.parse(tsconfigPrima));
    writeFileSync("tsconfig.json", uguale ? tsconfigPrima : ripulito);
  }
}
