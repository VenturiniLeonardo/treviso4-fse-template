import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHIAVE_GRUPPO,
  chiaveUnita,
  dbInStato,
  displayInEtichetta,
  eDiGruppo,
  etichettaInDisplay,
  isoInMs,
  msInIso,
  periodoDiAnno,
  STATI_DB,
  statoInDb,
} from "../lib/db/mappa.ts";

/**
 * Le conversioni fra il vocabolario dell'applicazione e quello del database.
 *
 * Girano con `node --experimental-strip-types`: `lib/db/mappa.ts` importa solo
 * tipi, e i tipi vengono cancellati, quindi a runtime il modulo non ha
 * dipendenze da risolvere. È il motivo per cui quel modulo non importa niente
 * che non sia un tipo.
 */

describe("stato di album e documenti", () => {
  it("va e torna senza perdere niente", () => {
    for (const s of ["bozza", "in-revisione", "pubblicato"] as const) {
      assert.equal(dbInStato(statoInDb(s)), s);
    }
  });

  it("solo in-revisione cambia forma", () => {
    assert.equal(statoInDb("bozza"), "bozza");
    assert.equal(statoInDb("pubblicato"), "pubblicato");
    assert.equal(statoInDb("in-revisione"), "in_revisione");
  });

  it("gli stati del database sono i tre attesi dal CHECK", () => {
    assert.deepEqual([...STATI_DB].sort(), ["bozza", "in_revisione", "pubblicato"]);
  });
});

describe("anno sociale", () => {
  it("riconosce la forma visualizzata degli album", () => {
    assert.equal(displayInEtichetta("2026 – 2027"), "2026-2027");
  });

  it("accetta la forma canonica dei documenti senza cambiarla", () => {
    assert.equal(displayInEtichetta("2026-2027"), "2026-2027");
  });

  it("tollera le varianti che un umano può scrivere", () => {
    for (const t of [
      "2026 - 2027", // trattino corto con spazi
      "2026-2027",
      "2026 – 2027", // en dash
      "2026—2027", // em dash
      "  2026 – 2027  ", // spazi attorno
      "2026−2027", // meno matematico
    ]) {
      assert.equal(displayInEtichetta(t), "2026-2027", `non ha riconosciuto ${JSON.stringify(t)}`);
    }
  });

  it("rifiuta quello che non è un anno sociale, invece di inventare", () => {
    for (const t of ["", "2026", "2026-2028", "2026-2026", "duemilaventisei", "20261-2027", "Oggi"]) {
      assert.equal(displayInEtichetta(t), null, `avrebbe dovuto rifiutare ${JSON.stringify(t)}`);
    }
  });

  it("la forma visualizzata è quella che il sito stampa già", () => {
    assert.equal(etichettaInDisplay("2026-2027"), "2026 – 2027");
    // combacia con ANNI_DOC[].label, che è il testo oggi a schermo
    assert.equal(etichettaInDisplay("2023-2024"), "2023 – 2024");
  });

  it("va e torna", () => {
    for (const e of ["2023-2024", "2024-2025", "2025-2026", "2026-2027"]) {
      assert.equal(displayInEtichetta(etichettaInDisplay(e)), e);
    }
  });

  it("il periodo va da settembre a luglio, come dice il piano", () => {
    assert.deepEqual(periodoDiAnno("2026-2027"), { inizio: "2026-09-01", fine: "2027-07-31" });
    assert.equal(periodoDiAnno("non un anno"), null);
  });
});

describe("unità e il caso «gruppo»", () => {
  it("«gruppo» non è un'unità", () => {
    assert.equal(CHIAVE_GRUPPO, "gruppo");
    assert.ok(eDiGruppo("gruppo"));
    assert.ok(!eDiGruppo("u1"));
  });

  it("un'unità assente nel database torna «gruppo»", () => {
    assert.equal(chiaveUnita(null), "gruppo");
    assert.equal(chiaveUnita(undefined), "gruppo");
    assert.equal(chiaveUnita("u1"), "u1");
  });
});

describe("tempo", () => {
  it("lo zero non diventa il 1970: diventa NULL", () => {
    assert.equal(msInIso(0), null);
    assert.equal(isoInMs(null), 0);
    assert.equal(isoInMs(undefined), 0);
  });

  it("va e torna al millisecondo", () => {
    const ms = Date.parse("2026-08-22T17:00:00.000Z");
    const iso = msInIso(ms);
    assert.ok(iso);
    assert.equal(isoInMs(iso), ms);
  });
});
