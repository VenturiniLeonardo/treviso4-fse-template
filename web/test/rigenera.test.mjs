import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * La rigenerazione delle pagine pubbliche dopo una modifica dall'area riservata.
 *
 * Il difetto che questa prova tiene fuori: `revalidatePath("/unita/[slug]",
 * "page")` senza il gruppo di rotte `(sito)` non nomina nessuna pagina, e non dà
 * errore. Un testo salvato, un elenco di responsabili approvato o una fotografia
 * d'archivio approvata restavano invisibili sul sito pubblico (ottobre 2026).
 */

/** Tutti i file .ts e .tsx sotto una cartella. */
function sorgenti(cartella) {
  const fuori = [];
  for (const nome of readdirSync(cartella)) {
    const percorso = join(cartella, nome);
    if (statSync(percorso).isDirectory()) fuori.push(...sorgenti(percorso));
    else if (/\.tsx?$/.test(nome)) fuori.push(percorso);
  }
  return fuori;
}

describe("revalidatePath con un segmento dinamico", () => {
  it("nessuna azione nomina una rotta pubblica dinamica senza il suo gruppo", () => {
    const sbagliati = [];
    for (const file of [...sorgenti("app"), ...sorgenti("lib")]) {
      if (file === join("lib", "rigenera.ts")) continue;
      const testo = readFileSync(file, "utf8");
      for (const m of testo.matchAll(/revalidatePath\(\s*["'`]([^"'`]*\[[^"'`]*)["'`]/g)) {
        // le rotte dell'area stanno in `(area)`, ma sono dinamiche e non hanno una
        // cache sul server: lì il nome non fa differenza
        if (m[1].startsWith("/area-riservata")) continue;
        sbagliati.push(`${file}: ${m[1]}`);
      }
    }
    assert.deepEqual(
      sbagliati,
      [],
      "usate rigeneraPagineUnita() / rigeneraPagineDocumenti() di lib/rigenera.ts",
    );
  });

  it("i gruppi scritti in lib/rigenera.ts esistono fra le cartelle di app/", () => {
    const testo = readFileSync(join("lib", "rigenera.ts"), "utf8");
    const rotte = [...testo.matchAll(/revalidatePath\("(\/\([a-z]+\)[^"]*)"/g)].map((m) => m[1]);
    assert.ok(rotte.length >= 2, "le due rotte con il gruppo ci sono");
    for (const rotta of rotte) {
      assert.ok(
        existsSync(join("app", rotta.slice(1), "page.tsx")),
        `${rotta}: non c'è app${rotta}/page.tsx`,
      );
    }
  });

  it("le pagine di unità sono nominate anche per indirizzo, una per unità", async () => {
    const { UNITA } = await import("@/lib/data");
    const testo = readFileSync(join("lib", "rigenera.ts"), "utf8");
    assert.match(testo, /for \(const u of UNITA\) revalidatePath\(`\/unita\/\$\{u\.slug\}`\)/);
    assert.equal(UNITA.length, 6);
  });
});
