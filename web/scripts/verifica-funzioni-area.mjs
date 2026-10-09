/** Flussi HTTP con dati sintetici, eseguiti soltanto dal runner isolato. */
import assert from "node:assert/strict";
import sharp from "sharp";

export async function verificaFunzioniArea({ raw, utenti, sessioni, get, url, origine, check, password }) {
  const permessi = await import("@/lib/permessi-store");
  const { RUOLI, AZIONE_DI_SEZIONE } = await import("@/lib/data-area");
  const { RIGHE_FISSE, FUNZIONI_INIZIALI, livelloEffettivo } = await import("@/lib/permessi");
  // le sezioni che la matrice di partenza chiude a un ruolo: nel menu non ci
  // sono, e all'indirizzo diretto rispondono 404 (es. le circolari del referente
  // unità, `documenti: nessuno` dal 6 ottobre 2026)
  const chiusaDiPartenza = (ruolo, sezione) => {
    const azione = AZIONE_DI_SEZIONE[sezione];
    const f = azione && FUNZIONI_INIZIALI.find((x) => x.id === azione);
    return Boolean(f) && livelloEffettivo(azione, ruolo, f.livelli[ruolo]) === "nessuno";
  };
  const att = await import("@/lib/attivita-store");
  const iscritti = await import("@/lib/iscritti-store");
  const unitaStore = await import("@/lib/unita-store");
  const proposte = await import("@/lib/proposte-store");
  const { ANNI_DOC } = await import("@/lib/data");
  const anno = ANNI_DOC.find((a) => a.corrente).chiave;
  await permessi.ripristinaMatrice();
  const account = {};
  for (const ruolo of RUOLI) {
    const id = utenti.creaUtente({ utente: `audit-${ruolo.slug}`, nome: `Audit ${ruolo.slug}`, iniziali: "AT", ruolo: ruolo.slug, ...(ruolo.slug === "referente" ? { unita: "u1" } : {}) });
    await utenti.impostaPassword(id, password);
    account[ruolo.slug] = { id, token: sessioni.apri(id, null) };
  }
  const cg = account["gestore"].token, cu = account["referente"].token;
  const social = account.social.token, admin = account.sviluppatore.token;
  const path = (ruolo, sezione) => `/area-riservata/${ruolo}/${sezione}`;
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const attrs = (s) => Object.fromEntries(Array.from(s.matchAll(/([\w:$-]+)="([^"]*)"/g), (m) => [m[1], decode(m[2])]));
  async function pagina(p, token) {
    const r = await get(p, token);
    assert.equal(r.status, 200, p);
    const html = await r.text();
    assert.doesNotMatch(html, /"digest":"[0-9]+"|>Qualcosa non ha funzionato</, p);
    return html;
  }
  function modulo(html, cerca) {
    const form = (html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? []).find((f) => typeof cerca === "function" ? cerca(f) : f.includes(cerca));
    assert.ok(form, `Modulo assente: ${cerca}`);
    const data = new FormData();
    for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
      const a = attrs(input);
      if (!a.name || a.type === "file" || ["submit", "button"].includes(a.type)) continue;
      if (["checkbox", "radio"].includes(a.type) && !input.includes("checked")) continue;
      data.append(a.name, a.value ?? "");
    }
    for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
      const a = attrs(m[1]); if (a.name) data.append(a.name, decode(m[2]));
    }
    for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const a = attrs(m[1]); if (!a.name) continue;
      const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
      const selected = options.find((o) => o[1].includes("selected")) ?? options[0];
      if (selected) data.append(a.name, attrs(selected[1]).value ?? decode(selected[2]));
    }
    return data;
  }
  async function invia(p, token, cerca, campi = {}, sorgente) {
    const data = modulo(sorgente ?? await pagina(p, token), cerca);
    for (const [k, v] of Object.entries(campi)) {
      data.delete(k);
      for (const valore of Array.isArray(v) ? v : [v]) data.append(k, valore);
    }
    const r = await fetch(url(p), { method: "POST", body: data, redirect: "manual", headers: { origin: origine, cookie: `sito_sessione=${token}` } });
    assert.ok([200, 303].includes(r.status), `${p}: ${r.status}`);
    const html = await r.text();
    assert.doesNotMatch(html, /"digest":"[0-9]+"|>Qualcosa non ha funzionato</, p);
    return { r, html };
  }
  await check("tutte le sezioni dei quattro ruoli si aprono e le viste altrui sono negate", async () => {
    for (const ruolo of RUOLI) {
      for (const sezione of Object.keys(ruolo.sezioni)) {
        if (chiusaDiPartenza(ruolo.slug, sezione)) {
          assert.equal((await get(path(ruolo.slug, sezione), account[ruolo.slug].token)).status, 404, `${ruolo.slug}/${sezione}`);
        } else await pagina(path(ruolo.slug, sezione), account[ruolo.slug].token);
      }
      await pagina("/area-riservata/profilo", account[ruolo.slug].token);
      if (ruolo.slug !== "sviluppatore") {
        for (const altro of RUOLI.filter((r) => r.slug !== ruolo.slug)) {
          assert.equal((await get(path(altro.slug, "riepilogo"), account[ruolo.slug].token)).status, 307);
        }
      }
    }
  });
  await check("la revoca di ogni permesso chiude tutte le sezioni corrispondenti", async () => {
    for (const ruolo of RUOLI) {
      for (const [sezione, azione] of Object.entries(AZIONE_DI_SEZIONE)) {
        if (!ruolo.sezioni[sezione] || RIGHE_FISSE[azione]) continue;
        await permessi.impostaLivello(azione, ruolo.slug, "nessuno");
        assert.equal((await get(path(ruolo.slug, sezione), account[ruolo.slug].token)).status, 404, `${ruolo.slug}/${sezione}`);
        await permessi.ripristinaMatrice();
      }
    }
  });
  await check("admin può modificare i permessi anche senza gestione account", async () => {
    await permessi.impostaLivello("utenti", "sviluppatore", "nessuno");
    await invia(path("sviluppatore", "permessi"), admin, 'name="livello"', { id: "messaggi", ruolo: "gestore", livello: "nessuno" });
    assert.equal(raw.prepare("SELECT livello FROM permessi WHERE funzione='messaggi' AND ruolo='gestore'").get().livello, "nessuno");
    await permessi.ripristinaMatrice();
  });
  await check("preferenze personali salvate nel cookie", async () => {
    const { r } = await invia("/area-riservata/profilo", cu, "Salva le preferenze", { tema: "scuro", densita: "compatta", testo: "grande", fermo: "on" });
    assert.match(r.headers.get("set-cookie"), /scuro/);
  });
  const pAtt = path("referente", "attivita");
  const campiAtt = { titolo: "Uscita audit riservata", data: "2026-11-15", tipo: "uscita", unita: "u1", nota: "Dati sintetici", luogo: "Sede prova", durata: "Un giorno" };
  let attId;
  await check("attività: creazione, modifica e limite alla propria unità", async () => {
    await invia(pAtt, cu, "Salva in bozza", { ...campiAtt, invio: "bozza" });
    const a = (await att.leggiAttivita()).find((x) => x.titolo === campiAtt.titolo); assert.ok(a); attId = a.id;
    await invia(`${pAtt}?att=${attId}`, cu, "Salva i dati", { ...campiAtt, id: String(attId), luogo: "Luogo aggiornato" });
    assert.equal((await att.attivitaPerId(attId)).luogo, "Luogo aggiornato");
    await invia(`${pAtt}?att=${attId}`, cu, "Salva i dati", { ...campiAtt, id: String(attId), unita: "u4" });
    assert.deepEqual((await att.attivitaPerId(attId)).unita, ["u1"]);
  });
  // dal 6 ottobre 2026 il social tiene aggiornato il calendario per tutti: vede
  // e modifica anche le attività dei referenti, e la bozza di un altro la tocca subito
  await check("social: vede e modifica le attività altrui ancora in bozza", async () => {
    const p = path("social", "calendario");
    assert.ok((await pagina(p, social)).includes(campiAtt.titolo));
    await invia(`${p}?att=${attId}`, social, "Salva i dati", { ...campiAtt, id: String(attId), nota: "Nota del social" });
    const a = await att.attivitaPerId(attId);
    assert.equal(a.nota, "Nota del social");
    assert.equal(a.stato, "bozza");
  });
  await check("attività: invio, approvazione e comparsa nel calendario pubblico", async () => {
    await invia(`${pAtt}?att=${attId}`, cu, "Manda in revisione");
    assert.equal((await att.attivitaPerId(attId)).stato, "in-revisione");
    const p = path("gestore", "approvazioni");
    const html = await pagina(p, cg);
    const cerca = (f) => f.includes(`name="chiave" value="${attId}"`) && f.includes('value="attivita"') && f.includes("Approva e pubblica");
    await invia(pAtt, cu, cerca, {}, html);
    assert.equal((await att.attivitaPerId(attId)).stato, "in-revisione");
    await permessi.impostaLivello("attivita", "gestore", "nessuno");
    assert.ok(!(await pagina(p, cg)).includes(campiAtt.titolo));
    await invia(p, cg, cerca, {}, html);
    assert.equal((await att.attivitaPerId(attId)).stato, "in-revisione");
    await permessi.ripristinaMatrice();
    await invia(p, cg, cerca);
    assert.equal((await att.attivitaPerId(attId)).stato, "pubblicato");
    assert.ok((await pagina("/attivita", cg)).includes(campiAtt.titolo));
  });
  await check("social: su un'attività pubblicata propone, e il gestore decide", async () => {
    const p = `${path("social", "calendario")}?att=${attId}`;
    const html = await pagina(p, social);
    assert.match(html, /Proponi le modifiche/);
    assert.doesNotMatch(html, /Ritira in bozza/);
    await invia(p, social, "Proponi le modifiche", { ...campiAtt, id: String(attId), luogo: "Luogo proposto" }, html);
    const dopo = await att.attivitaPerId(attId);
    assert.equal(dopo.stato, "pubblicato");
    assert.notEqual(dopo.luogo, "Luogo proposto", "nel calendario resta quella di adesso");
    const coda = path("gestore", "approvazioni");
    const voce = (verso) => (f) =>
      f.includes(`name="chiave" value="${attId}"`) && f.includes('value="attivita"') && f.includes(`value="${verso}"`);
    await invia(coda, cg, voce("approva"));
    assert.equal((await att.attivitaPerId(attId)).luogo, "Luogo proposto");
    assert.equal((await att.attivitaPerId(attId)).stato, "pubblicato");
    // la cancellazione è una richiesta: l'attività resta finché qualcuno non decide
    await invia(p, social, "Chiedi di cancellarla");
    assert.ok(await att.attivitaPerId(attId));
    await invia(coda, cg, voce("rimanda"));
    assert.ok(await att.attivitaPerId(attId));
    assert.equal((await proposte.leggiProposteInAttesa("attivita")).length, 0);
  });
  await check("coda social e dashboard rispettano autore e permessi", async () => {
    const p = path("social", "calendario");
    await invia(p, social, "Salva in bozza", { ...campiAtt, titolo: "Proposta audit social", invio: "bozza" });
    const mia = (await att.leggiAttivita()).find((x) => x.titolo === "Proposta audit social"); assert.ok(mia);
    await invia(`${p}?att=${mia.id}`, social, "Manda in revisione");
    await att.cambiaStatoAttivita(attId, "in-revisione", "audit-referente");
    const coda = path("social", "in-attesa");
    assert.ok((await pagina(coda, social)).includes(mia.titolo));
    // anche quelle dei referenti: le tiene aggiornate lui (6 ottobre 2026)
    assert.ok((await pagina(coda, social)).includes(campiAtt.titolo));
    await permessi.impostaLivello("attivita", "social", "nessuno");
    assert.ok(!(await pagina(coda, social)).includes(mia.titolo));
    assert.ok(!(await pagina(path("social", "riepilogo"), social)).includes(mia.titolo));
    await permessi.ripristinaMatrice();
  });
  let iscrittoId;
  await check("iscritti: registrazione, consenso, quota, gruppo interno ed export", async () => {
    const p = path("referente", "iscritti");
    await invia(p, cu, "Registra un’iscrizione", { nome: "PersonaFittizia", cognome: "AuditSintetico", natoIl: "2017-01-01", unita: "u1", anno, gruppoInterno: "Verdi" });
    const i = iscritti.elencoIscritti({ unita: "u1", anno }).find((x) => x.cognome === "AuditSintetico"); assert.ok(i); iscrittoId = i.id;
    const selectId = (f) => f.includes(`name="id" value="${i.id}"`);
    await invia(p, cu, (f) => selectId(f) && f.includes('name="concesso"'), { concesso: "1", data: "2026-10-05" });
    await invia(p, cu, (f) => selectId(f) && f.includes('name="quota"'), { quota: "saldata" });
    await invia(p, cu, (f) => selectId(f) && f.includes('name="gruppoInterno"'), { gruppoInterno: "Rossi" });
    const dopo = iscritti.iscrittoPerId(i.id); assert.equal(dopo.consenso, true); assert.equal(dopo.quota, "saldata"); assert.equal(dopo.gruppoInterno, "Rossi");
    const csv = await (await get("/area-riservata/esporta/iscritti", cu)).text();
    assert.match(csv, /AuditSintetico/); assert.doesNotMatch(csv, /2017-01-01|"Quota"|"Età"/);
    const fonte = await pagina(p, cu);
    // il gestore non ha più la sezione iscritti (6 ottobre 2026): l'azione
    // contraffatta parte da una sua sezione, servita dalla stessa pagina
    await invia(path("gestore", "riepilogo"), cg, (f) => selectId(f) && f.includes('name="concesso"'), { concesso: "0" }, fonte);
    assert.equal(iscritti.iscrittoPerId(i.id).consenso, true);
    // 404 e non 403: la sezione non è più nella vista del gestore
    assert.equal((await get("/area-riservata/esporta/iscritti", cg)).status, 404);
  });
  await check("il referente di unità non riceve le richieste GDPR nel payload RSC", async () => {
    // report QA, BUG-005: la prop del componente client viaggiava anche con
    // `puoCancellare: false`, e con lei l'inizio della descrizione
    const gdpr = await import("@/lib/gdpr-store");
    const marcatore = "RISERVATO-RSC-AUDIT-CONTATTO-FAMIGLIA";
    gdpr.apri("2026-10-06", "cancellazione", marcatore, account["gestore"].id);
    const html = await pagina(path("referente", "iscritti"), cu);
    assert.ok(!html.includes(marcatore.slice(0, 20)), "descrizione GDPR nel payload del referente di unità");
  });
  await check("scheda unità: testi salvati, recapiti in approvazione, ambiti protetti", async () => {
    const p = path("referente", "presentazione");
    await invia(p, cu, 'name="unita"', {
      motto: "Motto sintetico audit",
      storiaTitolo: "Titolo sintetico audit",
      notaStorico: "Nota sintetica audit",
      telefono: "340 000 7392",
    });
    const salvata = await unitaStore.unitaSalvataPerChiave("u1");
    assert.equal(salvata.motto, "Motto sintetico audit");
    // i campi camelCase: `.set()` di Drizzle scartava i nomi SQL (QA BUG-012)
    assert.equal(salvata.storiaTitolo, "Titolo sintetico audit");
    assert.equal(salvata.notaStorico, "Nota sintetica audit");
    // il recapito aspetta: in coda sì, online no
    assert.notEqual(salvata.telefono, "340 000 7392");
    assert.ok((await unitaStore.leggiProposte()).some((x) => x.unita === "u1" && x.campo === "telefono" && x.proposto === "340 000 7392"));
    await invia(p, cu, 'name="unita"', { unita: "u4", motto: "Intrusione sintetica" });
    assert.notEqual((await unitaStore.unitaSalvataPerChiave("u4")).motto, "Intrusione sintetica");
  });
  await check("fotografie: caricamento, proposta, approvazione e rimozione", async () => {
    const { SLOT } = await import("@/lib/slot-immagini");
    const { immagineDi } = await import("@/lib/immagini-store");
    const slot = SLOT.find((s) => s.unita === "u1" && !s.persona);
    const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#135790" } }).png().toBuffer();
    const p = path("referente", "immagini");
    const cerca = (f) => f.includes(`name="slot" value="${slot.chiave}"`) && f.includes('name="file"');
    await invia(p, cu, cerca, { file: new File([bytes], "audit.png", { type: "image/png" }), descrizione: "Immagine sintetica audit" });
    const proposta = (await proposte.leggiProposteInAttesa("immagine")).find((x) => x.chiave === slot.chiave); assert.ok(proposta?.file);
    assert.equal(await immagineDi(slot.chiave), undefined);
    assert.equal((await get(`/in-attesa/${proposta.file}`, undefined)).status, 404);
    assert.equal((await get(`/in-attesa/${proposta.file}`, cu)).status, 200);
    await invia(path("gestore", "approvazioni"), cg, (f) => f.includes(`name="chiave" value="${slot.chiave}"`) && f.includes("Approva e pubblica"));
    assert.ok(await immagineDi(slot.chiave));
    await invia(p, cu, (f) => f.includes(`name="slot" value="${slot.chiave}"`) && f.includes("Proponi di togliere"));
    assert.ok(await immagineDi(slot.chiave));
    await invia(path("gestore", "approvazioni"), cg, (f) => f.includes(`name="chiave" value="${slot.chiave}"`) && f.includes("Approva e pubblica"));
    assert.equal(await immagineDi(slot.chiave), undefined);
  });
  await check("fotografie: il social nasconde subito e non elimina; rimetterla la decide il gestore", async () => {
    const { SLOT } = await import("@/lib/slot-immagini");
    const { immagineDi } = await import("@/lib/immagini-store");
    const slot = SLOT.find((s) => s.chiave === "chi-siamo.gruppo");
    const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#2a6f3a" } }).png().toBuffer();
    const pCg = path("gestore", "immagini");
    const pSocial = path("social", "immagini");
    const delPosto = (testo) => (f) => f.includes(`name="slot" value="${slot.chiave}"`) && f.includes(testo);
    await invia(pCg, cg, delPosto('name="file"'), { file: new File([bytes], "audit-gruppo.png", { type: "image/png" }) });
    const caricata = await immagineDi(slot.chiave);
    assert.ok(caricata && !caricata.nascosta);
    assert.equal((await get(`/immagine/${caricata.file}`, undefined)).status, 200);

    const html = await pagina(pSocial, social);
    const moduli = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
    assert.ok(!moduli.some(delPosto("Elimina la fotografia")), "al social non si offre di eliminare");
    await invia(pSocial, social, delPosto(">Nascondi<"), {}, html);
    assert.equal((await immagineDi(slot.chiave))?.nascosta, true, "nascosta subito, senza coda");
    assert.equal((await get(`/immagine/${caricata.file}`, undefined)).status, 404);
    assert.equal((await get(`/in-attesa/${caricata.file}`, undefined)).status, 404);
    assert.equal((await get(`/in-attesa/${caricata.file}`, social)).status, 200);

    // eliminarla con il modulo del gestore, ma con la sessione del social: no
    await invia(pSocial, social, delPosto("Elimina la fotografia"), {}, await pagina(pCg, cg));
    assert.ok(await immagineDi(slot.chiave), "il file resta");

    await invia(pSocial, social, delPosto("Chiedi di rimetterla"));
    assert.equal((await immagineDi(slot.chiave))?.nascosta, true, "rimetterla aspetta il gestore");
    await invia(path("gestore", "approvazioni"), cg, (f) => f.includes(`name="chiave" value="${slot.chiave}"`) && f.includes("Approva e pubblica"));
    assert.equal((await immagineDi(slot.chiave))?.nascosta, false);
    assert.equal((await get(`/immagine/${caricata.file}`, undefined)).status, 200);
  });
  await check("privacy: apertura e chiusura richiesta, amministratore motivato per gli iscritti", async () => {
    const gdpr = await import("@/lib/gdpr-store");
    const p = path("gestore", "privacy");
    await invia(p, cg, "Registra la richiesta", { arrivata: "2026-10-05", diritto: "accesso", descrizione: "Richiesta sintetica audit" });
    const richiesta = gdpr.elenco().find((x) => x.descrizione === "Richiesta sintetica audit"); assert.ok(richiesta);
    await invia(p, cg, (f) => f.includes(`name="id" value="${richiesta.id}"`) && f.includes('name="stato"'), { stato: "eseguita" });
    assert.equal(gdpr.perId(richiesta.id).stato, "eseguita");
    // gli iscritti stanno ormai solo nella vista del referente di unità, che lo
    // sviluppatore apre come tutte, ma con il motivo
    const pIscritti = path("referente", "iscritti");
    assert.ok(!(await pagina(pIscritti, admin)).includes("AuditSintetico"));
    await invia(pIscritti, admin, 'name="motivo"', { motivo: "Verifica sintetica autorizzata del funzionamento" });
    assert.ok((await pagina(pIscritti, admin)).includes("AuditSintetico"));
    assert.ok(iscritti.iscrittoPerId(iscrittoId));
  });
}
