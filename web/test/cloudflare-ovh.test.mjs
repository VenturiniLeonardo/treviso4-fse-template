import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { esitoModalitaSsl, retiMancanti, sommaTraffico } from "@/lib/cloudflare";
import { configOvh, DIRITTI_OVH, esitoRinnovo, firmaOvh, rigaScadenza } from "@/lib/ovh";

/**
 * Cloudflare e OVH senza rete: le chiavi vere sul portatile non ci sono, e le
 * prove non devono dipendere da due servizi esterni. Si provano le parti dove
 * un errore darebbe un «ok» falso o una chiamata sempre rifiutata.
 */

// Le reti pubblicate da Cloudflare il 23 settembre 2026 (api.cloudflare.com/client/v4/ips).
const RETI_CLOUDFLARE = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

describe("Cloudflare", () => {
  it("una rete nuova di Cloudflare si vede", () => {
    const vecchio = "\t\ttrusted_proxies static 173.245.48.0/20 103.21.244.0/22\n";
    assert.deepEqual(retiMancanti(vecchio, ["173.245.48.0/20", "10.9.0.0/16"]), ["10.9.0.0/16"]);
    // senza la riga, mancano tutte
    assert.equal(retiMancanti("example.org {\n}\n", RETI_CLOUDFLARE).length, RETI_CLOUDFLARE.length);
  });

  it("solo «Full (strict)» è a posto; «Flexible» è un guasto", () => {
    assert.equal(esitoModalitaSsl("strict").esito, "ok");
    assert.equal(esitoModalitaSsl("full").esito, "aperto");
    assert.equal(esitoModalitaSsl("flexible").esito, "guasto");
    assert.equal(esitoModalitaSsl("off").esito, "guasto");
    assert.equal(esitoModalitaSsl("strano").esito, "aperto");
  });

  it("il traffico si somma ora per ora", () => {
    const t = sommaTraffico([
      { sum: { requests: 100, cachedRequests: 60, bytes: 1000, threats: 1 } },
      { sum: { requests: 50, cachedRequests: 20, bytes: 500, threats: 0 } },
    ]);
    assert.deepEqual(t, { richieste: 150, inCache: 80, byte: 1500, minacce: 1 });
    assert.deepEqual(sommaTraffico([]), { richieste: 0, inCache: 0, byte: 0, minacce: 0 });
  });
});

describe("OVH", () => {
  it("la firma segue la formula documentata", () => {
    const url = "https://eu.api.ovh.com/1.0/vps/vps-abc.vps.ovh.net/serviceInfos";
    const atteso =
      "$1$" +
      createHash("sha1").update("SEGRETO+CONSUMER+GET+" + url + "++1790000000").digest("hex");
    assert.equal(firmaOvh("SEGRETO", "CONSUMER", "GET", url, "", 1790000000), atteso);
  });

  it("la chiave chiede soltanto GET", () => {
    assert.ok(DIRITTI_OVH.length > 0);
    for (const d of DIRITTI_OVH) assert.equal(d.method, "GET");
  });

  it("dice quali variabili mancano, e ha un endpoint predefinito", () => {
    assert.deepEqual(configOvh({ SITO_OVH_APP_KEY: "a" }).mancano, [
      "SITO_OVH_APP_SECRET",
      "SITO_OVH_CONSUMER_KEY",
    ]);
    const c = configOvh({ SITO_OVH_APP_KEY: "a", SITO_OVH_APP_SECRET: "b", SITO_OVH_CONSUMER_KEY: "c" });
    assert.equal(c.base, "https://eu.api.ovh.com/1.0");
    assert.equal(c.vps, null);
  });

  it("il rinnovo: automatico tranquillo, manuale sotto i 30 giorni, cancellazione sempre rossa", () => {
    assert.equal(esitoRinnovo(20, true, false), "ok");
    assert.equal(esitoRinnovo(5, true, false), "aperto");
    assert.equal(esitoRinnovo(1, true, false), "guasto");
    assert.equal(esitoRinnovo(60, false, false), "ok");
    assert.equal(esitoRinnovo(25, false, false), "aperto");
    assert.equal(esitoRinnovo(6, false, false), "guasto");
    assert.equal(esitoRinnovo(300, true, true), "guasto");
  });

  it("la riga di scadenza dice data e tipo di rinnovo", () => {
    const adesso = new Date("2026-09-23T10:00:00").getTime();
    const r = rigaScadenza("x", "Rinnovo della VPS", {
      expiration: "2026-10-23",
      status: "ok",
      renew: { automatic: false, deleteAtExpiration: false },
    }, adesso);
    assert.equal(r.valore, "tra 29 giorni");
    assert.equal(r.esito, "aperto");
    assert.match(r.nota, /23 ottobre 2026/);
    assert.match(r.nota, /MANUALE/);

    const scaduto = rigaScadenza("x", "D", { expiration: "2026-09-01", status: "expired" }, adesso);
    assert.equal(scaduto.valore, "scaduto");
    assert.equal(scaduto.esito, "guasto");
  });
});
