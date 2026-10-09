import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { UNITA } from "@/lib/data";
import { inIndirizzo } from "@/lib/contenuti";
import { ritrattiDei, SLOT } from "@/lib/slot-immagini";

/**
 * La sezione «Referenti» e i posti dei ritratti.
 *
 * I referenti si aggiungono, si spostano e si tolgono dall'area riservata, e il
 * ritratto di un referente nuovo ha bisogno di un posto: l'elenco dei posti deve
 * seguire i referenti che ci sono, non i nomi che il codice consegna.
 */

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (...p) => readFileSync(join(radice, ...p), "utf8");

describe("i ritratti seguono i referenti di adesso", () => {
  it("con i referenti del codice sono gli stessi posti di sempre, con le stesse chiavi", () => {
    const vivi = ritrattiDei(UNITA).map((s) => s.chiave).sort();
    const fissi = SLOT.filter((s) => s.persona).map((s) => s.chiave).sort();
    assert.deepEqual(vivi, fissi);
  });

  it("un referente aggiunto ha il suo posto, nell'unità giusta", () => {
    const con = UNITA.map((u) =>
      u.chiave === "u4" ? { ...u, responsabili: [...u.responsabili, ["Maria Nuova", "Referente", "dal 2026"]] } : u,
    );
    const nuovo = ritrattiDei(con).find((s) => s.persona === "Maria Nuova");
    assert.ok(nuovo);
    assert.equal(nuovo.chiave, `referente.${inIndirizzo("Maria Nuova")}`);
    assert.equal(nuovo.unita, "u4");
    assert.equal(nuovo.forma, "ritratto");
  });

  it("un referente tolto non ha più il suo posto: il ritratto si stacca", () => {
    const senza = UNITA.map((u) => (u.chiave === "u4" ? { ...u, responsabili: [] } : u));
    const nomi = new Set(ritrattiDei(senza).map((s) => s.persona));
    for (const [nome] of UNITA.find((u) => u.chiave === "u4").responsabili) assert.ok(!nomi.has(nome));
  });
});

describe("le azioni sui referenti", () => {
  const azioni = leggi("app", "(area)", "area-riservata", "unita", "actions.ts");
  const corpo = (nome) => {
    const i = azioni.indexOf(`export async function ${nome}(`);
    assert.ok(i >= 0, nome);
    const j = azioni.indexOf("\nexport async function ", i + 10);
    return azioni.slice(i, j < 0 ? undefined : j);
  };

  it("salvaReferente chiede completo per l'unità di arrivo e, se si sposta, per quella di partenza", () => {
    const c = corpo("salvaReferente");
    assert.match(c, /contesto\("referenti", \{ unita: destinazione/);
    assert.match(c, /ctxDest\.livello !== "completo"/);
    assert.match(c, /contesto\("referenti", \{ unita: origine/);
    assert.match(c, /ctxOrig\.livello !== "completo"/);
  });

  it("salvaReferente e togliReferente controllano che il nome alla posizione sia quello che la pagina mostrava", () => {
    for (const nome of ["salvaReferente", "togliReferente"]) {
      assert.match(corpo(nome), /nomeAtteso/, nome);
    }
  });

  it("si tocca solo chi guida e lo staff: lo storico resta di «Unità»", () => {
    assert.match(azioni, /const TIPI_REFERENTI: TipoPersona\[\] = \["responsabile", "staff"\];/);
  });
});
