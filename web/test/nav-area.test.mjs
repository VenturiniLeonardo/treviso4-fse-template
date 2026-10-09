import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AZIONE_DI_SEZIONE, chiaviSezioni, ruoloPerSlug } from "@/lib/data-area";
import { navVisibile } from "@/lib/nav-area";

/**
 * I due menu dell'area riservata tacciono le stesse sezioni.
 *
 * La pagina calcola l'insieme `nascoste` — le sezioni la cui riga di matrice è
 * a «nessuno» per chi guarda — e lo passava solo alla colonna laterale: la
 * tendina dei telefoni offriva ancora le voci chiuse, e sceglierne una portava
 * al rifiuto. Verificato il 2026-10-03 chiudendo una riga per il referente di unità.
 *
 * Come in `anteprima-ambito.test.mjs`, due prove: la **regola pura**
 * (`navVisibile`, che i due menu ora condividono) e la **presenza
 * dell'insieme nel sorgente** della pagina, per ciascuno dei due componenti —
 * la pagina è un componente server e non si esegue fuori da Next.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...parti) => readFileSync(join(radice, ...parti), "utf8");

const referente = ruoloPerSlug("referente");
const chiavi = (nav) => nav.flatMap((g) => g.voci.map((v) => v.chiave));

describe("navVisibile", () => {
  it("senza sezioni nascoste il menu è quello del ruolo", () => {
    assert.deepEqual(chiavi(navVisibile(referente, undefined)), chiaviSezioni(referente));
    assert.deepEqual(chiavi(navVisibile(referente, new Set())), chiaviSezioni(referente));
  });

  it("una sezione chiusa dalla matrice sparisce", () => {
    const chiusa = chiaviSezioni(referente).find((c) => c in AZIONE_DI_SEZIONE);
    assert.ok(chiusa, "il referente di unità ha almeno una sezione con una riga di matrice");
    const nav = chiavi(navVisibile(referente, new Set([chiusa])));
    assert.ok(!nav.includes(chiusa));
    assert.equal(nav.length, chiaviSezioni(referente).length - 1);
  });

  it("un gruppo rimasto senza voci si toglie", () => {
    const gruppo = referente.nav.find((g) => g.voci.length > 0);
    const nav = navVisibile(referente, new Set(gruppo.voci.map((v) => v.chiave)));
    assert.ok(!nav.some((g) => g.label === gruppo.label));
    assert.ok(nav.every((g) => g.voci.length > 0));
  });

  it("la sezione aperta resta, anche se nascosta, quando la si chiede", () => {
    const [prima, aperta] = chiaviSezioni(referente);
    const nav = chiavi(navVisibile(referente, new Set([prima, aperta]), aperta));
    assert.ok(nav.includes(aperta));
    assert.ok(!nav.includes(prima));
  });
});

describe("la pagina passa l'insieme a tutti e due i menu", () => {
  const pagina = leggi("app", "(area)", "area-riservata", "[ruolo]", "[sezione]", "page.tsx");

  /** Il primo elemento JSX `<nome …/>` del sorgente, dagli attributi alla chiusura. */
  function elemento(nome) {
    const inizio = pagina.indexOf(`<${nome}`);
    assert.ok(inizio >= 0, `<${nome}> non trovato`);
    return pagina.slice(inizio, pagina.indexOf("/>", inizio));
  }

  for (const nome of ["AdminSide", "SectionPicker"]) {
    it(`<${nome}> riceve nascoste`, () => {
      assert.match(elemento(nome), /\bnascoste=\{nascoste\}/);
    });
  }

  it("i due componenti filtrano con navVisibile, non con ruolo.nav", () => {
    for (const file of ["AdminSide.tsx", "SectionPicker.tsx"]) {
      const sorgente = leggi("components", "area", file);
      assert.match(sorgente, /navVisibile\(ruolo, nascoste/, file);
      assert.doesNotMatch(sorgente, /ruolo\.nav\b/, file);
    }
  });
});
