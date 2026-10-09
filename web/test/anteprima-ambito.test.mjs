import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { puoScrivereSu } from "@/lib/sessione";

/**
 * L'ambito d'unità dell'anteprima — audit di sicurezza.
 *
 * `/anteprima/unita/[slug]` mostra la pagina d'unità **come sarebbe se tutte le
 * proposte in attesa venissero approvate**: contenuti non ancora pubblici. Il
 * middleware, sotto `/anteprima`, lascia passare qualunque sessione attiva senza
 * guardare il ruolo — là serve solo il nonce della CSP. Se la pagina non rifà il
 * controllo d'ambito, un referente di unità vede le bozze di un'altra unità: è lo stesso
 * perimetro per unità che regge album, iscritti e scheda, e qui era saltato.
 *
 * Come in `secondo-fattore.test.mjs`, si prova due cose: la **regola pura**
 * (`puoScrivereSu`, la stessa funzione che decide ovunque nel resto dell'area) e
 * la **presenza del cancello nel sorgente** della pagina — perché il componente
 * non si può eseguire fuori da Next, e un'invariante «non esiste una strada» si
 * dimostra sul sorgente, non su una porta.
 */

const sess = (ruolo, unita) => ({
  u: ruolo,
  n: ruolo,
  r: ruolo,
  i: "XX",
  ...(unita ? { un: unita } : {}),
  exp: 0,
});

describe("l'ambito d'unità dell'anteprima", () => {
  it("un referente di unità vede solo l'anteprima della propria unità", () => {
    const referente = sess("referente", "u1");
    assert.equal(puoScrivereSu(referente, "u1"), true);
    // il cuore della correzione: non le bozze di un'altra unità
    assert.equal(puoScrivereSu(referente, "u4"), false);
    assert.equal(puoScrivereSu(referente, "u3"), false);
  });

  it("un referente di unità senza unità non vede nessuna anteprima", () => {
    const orfano = sess("referente", undefined);
    for (const u of ["u1", "u4", "u3"]) {
      assert.equal(puoScrivereSu(orfano, u), false);
    }
  });

  it("chi approva — gestore e sviluppatore — vede l'anteprima di ogni unità", () => {
    for (const ruolo of ["gestore", "sviluppatore"]) {
      const chi = sess(ruolo, undefined);
      for (const u of ["u1", "u4", "u3", "u2"]) {
        assert.equal(puoScrivereSu(chi, u), true, `${ruolo} deve vedere ${u}`);
      }
    }
  });
});

describe("il cancello è nel sorgente della pagina d'anteprima", () => {
  const sorgente = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "app",
      "(sito)",
      "anteprima",
      "unita",
      "[slug]",
      "page.tsx",
    ),
    "utf8",
  );

  // dal 4 ottobre 2026 il cancello è la riga `unita-scheda` della matrice
  // sull'unità, non più `puoScrivereSu` scritto sul ruolo (audit degli accessi, M-2)
  it("la pagina chiede la riga «unita-scheda» con la chiave dell'unità dell'anteprima", () => {
    assert.match(sorgente, /puo\(\s*"unita-scheda"\s*,\s*\{\s*unita:\s*chiave\s*\}\s*\)/);
  });

  it("il rifiuto è un notFound() sullo stesso controllo", () => {
    assert.match(sorgente, /if\s*\(![^)]*\|\|\s*!\(await puo\("unita-scheda"[^)]*\)\)\)\s*notFound\(\)/);
  });

  it("chi non ha la riga «referenti» vede solo i testi, senza recapiti e nomi proposti", () => {
    assert.match(sorgente, /soloContenuti:\s*!\(await puo\("referenti"/);
  });
});
