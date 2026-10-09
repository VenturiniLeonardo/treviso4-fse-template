import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  controlloCertificato,
  controlloUnita,
  esitoCarico,
  esitoLibero,
  esitoScadenza,
  leggiAggiornamenti,
  leggiMeminfo,
  leggiSystemctl,
} from "@/lib/macchina";

/**
 * La macchina e i certificati, nelle parti che si provano senza un server.
 *
 * Le letture vere — statfs, /proc, systemctl, una connessione TLS — sul
 * portatile di sviluppo non ci sono o non dicono niente. Quello che si prova
 * qui è l'interpretazione: le soglie, e i tre formati di testo che vengono da
 * fuori (Linux, Ubuntu, systemd). Sono i punti dove un cambio di formato
 * produrrebbe un «ok» falso, cioè l'errore peggiore per una dashboard.
 */

describe("le soglie", () => {
  it("un certificato sotto i 21 giorni ha già mancato il rinnovo", () => {
    assert.equal(esitoScadenza(60), "ok");
    assert.equal(esitoScadenza(21), "ok");
    assert.equal(esitoScadenza(20), "aperto");
    assert.equal(esitoScadenza(7), "guasto");
    assert.equal(esitoScadenza(-3), "guasto");
  });

  it("disco e memoria: giallo sotto il 20%, rosso sotto il 10%", () => {
    assert.equal(esitoLibero(45), "ok");
    assert.equal(esitoLibero(15), "aperto");
    assert.equal(esitoLibero(4), "guasto");
  });

  it("il carico si confronta con i processori", () => {
    assert.equal(esitoCarico(0.8, 2), "ok");
    assert.equal(esitoCarico(2.5, 2), "aperto");
    assert.equal(esitoCarico(3.5, 2), "guasto");
  });
});

describe("i testi che arrivano dal sistema", () => {
  it("/proc/meminfo: conta MemAvailable, non MemFree", () => {
    const m = leggiMeminfo(
      "MemTotal:        2014532 kB\nMemFree:           81220 kB\nMemAvailable:    1203440 kB\n",
    );
    assert.equal(m.totale, 2014532 * 1024);
    assert.equal(m.disponibile, 1203440 * 1024);
    assert.equal(leggiMeminfo(""), null);
  });

  it("update-notifier, nelle sue forme", () => {
    assert.deepEqual(
      leggiAggiornamenti(
        "\n5 updates can be applied immediately.\n3 of these updates are standard security updates.\nTo see these additional updates run: apt list --upgradable\n",
      ),
      { totali: 5, sicurezza: 3 },
    );
    assert.deepEqual(
      leggiAggiornamenti("1 update can be applied immediately.\n1 of these updates is a standard security update.\n"),
      { totali: 1, sicurezza: 1 },
    );
    assert.deepEqual(leggiAggiornamenti("2 updates can be applied immediately.\n"), { totali: 2, sicurezza: 0 });
    assert.deepEqual(leggiAggiornamenti("0 updates can be applied immediately.\n"), { totali: 0, sicurezza: 0 });
    // un formato che non si riconosce non è «nessun aggiornamento»
    assert.equal(leggiAggiornamenti("qualcosa di nuovo"), null);
    assert.equal(leggiAggiornamenti(""), null);
  });

  it("systemctl show: un blocco per unità, nell'ordine chiesto", () => {
    const stati = leggiSystemctl(
      [
        "LoadState=loaded\nActiveState=active\nResult=success\nExecMainExitTimestamp=",
        "LoadState=loaded\nActiveState=inactive\nResult=success\nExecMainExitTimestamp=@1790042000",
        "LoadState=not-found\nActiveState=inactive\nResult=success\nExecMainExitTimestamp=",
      ].join("\n\n") + "\n",
    );
    assert.equal(stati.length, 3);
    assert.equal(stati[0].attiva, "active");
    assert.equal(stati[0].finitaIl, null);
    assert.equal(stati[1].finitaIl.getTime(), 1790042000 * 1000);
    assert.equal(stati[2].caricata, "not-found");
  });
});

describe("le righe", () => {
  const adesso = Date.parse("2026-09-23T10:00:00Z");
  const notturno = { unita: "sito-notturno.service", id: "notturno", cosa: "Lavori notturni", lavoro: true, nota: "n" };
  const caddy = { unita: "caddy.service", id: "caddy", cosa: "Caddy", lavoro: false, nota: "c" };
  const stato = (s) => ({ caricata: "loaded", attiva: "inactive", risultato: "success", finitaIl: null, ...s });

  it("un lavoro riuscito stanotte è ok; uno di due notti fa no", () => {
    const stanotte = controlloUnita(notturno, stato({ finitaIl: new Date("2026-09-23T02:10:30Z") }), adesso);
    assert.equal(stanotte.esito, "ok");
    const vecchio = controlloUnita(notturno, stato({ finitaIl: new Date("2026-09-21T02:10:30Z") }), adesso);
    assert.equal(vecchio.esito, "guasto");
  });

  it("un lavoro fallito è un guasto anche se è di stanotte", () => {
    const r = controlloUnita(
      notturno,
      stato({ risultato: "exit-code", finitaIl: new Date("2026-09-23T02:10:30Z") }),
      adesso,
    );
    assert.equal(r.esito, "guasto");
    assert.equal(r.valore, "fallito");
  });

  it("un'unità non installata è da configurare, non rotta", () => {
    assert.equal(controlloUnita(notturno, stato({ caricata: "not-found" }), adesso).esito, "aperto");
  });

  it("Caddy fermo è un guasto", () => {
    assert.equal(controlloUnita(caddy, stato({ attiva: "active" }), adesso).esito, "ok");
    assert.equal(controlloUnita(caddy, stato({ attiva: "failed" }), adesso).esito, "guasto");
  });

  it("il certificato: giorni, validità, e la risposta che manca", () => {
    const cert = (giorni, valido = true) => ({
      scade: new Date(adesso + giorni * 86_400_000 + 3_600_000),
      emittente: "Let's Encrypt · E6",
      valido,
      errore: valido ? null : "ERR_TLS_CERT_ALTNAME_INVALID",
      impronta: "AA",
    });
    const buono = controlloCertificato("c", "C", cert(64), "x", adesso);
    assert.equal(buono.esito, "ok");
    assert.equal(buono.valore, "64 giorni");

    assert.equal(controlloCertificato("c", "C", cert(12), "x", adesso).esito, "aperto");
    // lontano dalla scadenza ma per il nome sbagliato: il browser lo rifiuta
    const sbagliato = controlloCertificato("c", "C", cert(80, false), "x", adesso);
    assert.equal(sbagliato.esito, "guasto");
    assert.match(sbagliato.nota, /ALTNAME/);

    const scaduto = controlloCertificato("c", "C", cert(-2), "x", adesso);
    assert.equal(scaduto.valore, "scaduto");
    assert.equal(scaduto.esito, "guasto");

    assert.equal(controlloCertificato("c", "C", null, "x", adesso).esito, "guasto");
  });
});
