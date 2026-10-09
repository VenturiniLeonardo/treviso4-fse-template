import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { riempiGiorni, serieDiTipo } from "@/lib/diagnostica";
import { serieOraria } from "@/lib/cloudflare";

/**
 * I dati dei grafici della dashboard dello sviluppatore.
 *
 * Un grafico sbaglia in silenzio: una colonna che manca sembra un giorno
 * tranquillo, non un dato perso. Qui si prova che i giorni vuoti ci sono (a
 * zero), che le uscite non si contano come attività, e che le operazioni
 * respinte non finiscono fra quelle riuscite.
 */

describe("l'attività per giorno", () => {
  const oggi = new Date("2026-09-23T15:00:00Z");

  it("tiene tutti i giorni, anche quelli senza voci, in ordine", () => {
    const g = riempiGiorni([], 30, oggi);
    assert.equal(g.length, 30);
    assert.equal(g[0].giorno, "2026-08-25");
    assert.equal(g[29].giorno, "2026-09-23");
    assert.ok(g.every((x) => x.accessi === 0 && x.operazioni === 0));
  });

  it("divide le voci fra accessi e operazioni, e tiene a parte le rifiutate", () => {
    const g = riempiGiorni(
      [
        { giorno: "2026-09-23", tipo: "accesso", esito: "ok", n: 4 },
        { giorno: "2026-09-23", tipo: "uscita", esito: "ok", n: 3 },
        { giorno: "2026-09-23", tipo: "contenuto", esito: "ok", n: 2 },
        { giorno: "2026-09-23", tipo: "pubblicazione", esito: "ok", n: 1 },
        { giorno: "2026-09-23", tipo: "contenuto", esito: "rifiutato", n: 5 },
        // fuori finestra: non deve comparire da nessuna parte
        { giorno: "2026-07-01", tipo: "accesso", esito: "ok", n: 99 },
      ],
      7,
      oggi,
    );
    const ultimo = g.at(-1);
    assert.deepEqual(ultimo, { giorno: "2026-09-23", accessi: 4, operazioni: 3, rifiutate: 5 });
    assert.equal(g.reduce((t, x) => t + x.accessi, 0), 4);
  });

  it("l'uscita non è un'attività", () => {
    assert.equal(serieDiTipo("uscita"), null);
    assert.equal(serieDiTipo("accesso"), "accessi");
    assert.equal(serieDiTipo("consenso"), "operazioni");
  });
});

describe("il traffico per ora", () => {
  it("si ordina per ora e scarta i gruppi senza data", () => {
    const s = serieOraria([
      { dimensions: { datetime: "2026-09-23T10:00:00Z" }, sum: { requests: 5, cachedRequests: 2, bytes: 0, threats: 0 } },
      { dimensions: { datetime: "2026-09-23T09:00:00Z" }, sum: { requests: 3, cachedRequests: 3, bytes: 0, threats: 0 } },
      { sum: { requests: 100, cachedRequests: 0, bytes: 0, threats: 0 } },
    ]);
    assert.deepEqual(s, [
      { ora: "2026-09-23T09:00:00Z", richieste: 3, inCache: 3 },
      { ora: "2026-09-23T10:00:00Z", richieste: 5, inCache: 2 },
    ]);
  });
});
