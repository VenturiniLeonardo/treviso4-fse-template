import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Il calendario su SQLite — fase 8.
 *
 * Due prove valgono più delle altre:
 *
 *  - che il `CHECK` del database e il vocabolario di `lib/attivita.ts` dicano
 *    la stessa cosa. Sono due elenchi scritti in due file, e l'unico modo di
 *    tenerli allineati che non sia un commento è leggere il vincolo vero dalla
 *    tabella vera;
 *  - che un'attività si rilegga **senza perdere niente**: stesse date, stessi
 *    giorni della settimana, stesse unità. `dow` non si conserva più in una
 *    colonna, si ricava — e questa è la prova che si può.
 *
 * Il seme (`EVENTI` in `lib/data.ts`) è vuoto dal passaggio in produzione: le
 * prove si scrivono da sé le attività che servono.
 */

let cartella;
let percorso;
let raw;
let store, vocabolario;
let EVENTI;
let chiudiPerTest;

const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-attivita-"));
  percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/attivita-store");
  vocabolario = await import("@/lib/attivita");
  ({ EVENTI } = await import("@/lib/data"));
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  raw.prepare("delete from attivita").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  rmSync(cartella, { recursive: true, force: true });
});

/**
 * Provoca la semina, che scatta alla prima scrittura come per gli album, e
 * dice quante righe ha lasciato. Con il seme vuoto devono essere zero.
 */
async function materializza() {
  await store.cambiaStatoAttivita(-1, "pubblicato", "prova");
  return raw.prepare("select count(*) n from attivita").get().n;
}

// =========================================================================

describe("il vocabolario e il database dicono la stessa cosa", () => {
  it("il CHECK della tabella elenca esattamente i tipi di lib/attivita.ts", () => {
    const sql = raw
      .prepare("select sql from sqlite_master where name = 'attivita'")
      .get().sql;
    const m = /CHECK\("attivita"\."tipo" IN \(([^)]*)\)\)/.exec(sql);
    assert.ok(m, "il CHECK su tipo deve esistere");

    const nelDatabase = m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    assert.deepEqual(
      nelDatabase.sort(),
      [...vocabolario.TIPI_ATTIVITA].sort(),
      "i due elenchi sono divergenti: aggiornate lib/attivita.ts o lo schema",
    );
  });

  it("ogni tipo ha un'etichetta", () => {
    for (const t of vocabolario.TIPI_ATTIVITA) {
      assert.ok(vocabolario.ETICHETTA_TIPO[t], t);
    }
  });

  it("un tipo che non c'è lo rifiuta il database, non solo TypeScript", () => {
    assert.throws(() =>
      raw
        .prepare(
          "insert into attivita (anno_id,titolo,data_testo,tipo) values (1,'x','1 gen 2026','gruppo')",
        )
        .run(),
    );
  });
});

describe("l'attività di squadra è solo della fascia verde", () => {
  it("la regola ammette l'unità 3, l'unità 4 o tutte e due, e nient'altro", () => {
    const { tipoAmmessoPer } = vocabolario;
    assert.ok(tipoAmmessoPer("attivita-squadra", ["u3"]));
    assert.ok(tipoAmmessoPer("attivita-squadra", ["u4"]));
    assert.ok(tipoAmmessoPer("attivita-squadra", ["u3", "u4"]));
    assert.ok(!tipoAmmessoPer("attivita-squadra", []), "non di tutto il gruppo");
    assert.ok(!tipoAmmessoPer("attivita-squadra", ["u1"]));
    assert.ok(!tipoAmmessoPer("attivita-squadra", ["u4", "u6"]));
    // gli altri tipi non cambiano
    assert.ok(tipoAmmessoPer("riunione", []));
    assert.ok(tipoAmmessoPer("uscita-squadra", ["u1"]));
  });

  it("lo store la applica in creazione e in modifica", async () => {
    const base = { titolo: "Attività di Squadra", data: "2026-10-18", tipo: "attivita-squadra" };
    await assert.rejects(store.creaAttivita({ ...base, unita: ["u5"] }, "prova"), /fascia verde/);
    await assert.rejects(store.creaAttivita(base, "prova"), /fascia verde/);

    const id = await store.creaAttivita({ ...base, unita: ["u3"] }, "prova");
    await assert.rejects(store.aggiornaAttivita(id, { unita: ["u1"] }, "prova"), /fascia verde/);

    const altra = await store.creaAttivita({ ...base, tipo: "riunione", unita: ["u1"] }, "prova");
    await assert.rejects(
      store.aggiornaAttivita(altra, { tipo: "attivita-squadra" }, "prova"),
      /fascia verde/,
    );
  });
});

describe("il seme è vuoto", () => {
  it("EVENTI non contiene attività dimostrative, e il calendario parte vuoto", async () => {
    assert.deepEqual(EVENTI, [], "nessuna attività inventata va in produzione");
    assert.deepEqual(await store.leggiAttivita(), []);
    assert.deepEqual(await store.attivitaPubbliche(), []);
  });

  it("la prima scrittura non semina niente", async () => {
    assert.equal(await materializza(), 0);
    assert.deepEqual(await store.leggiAttivita(), []);
  });
});

describe("un'attività scritta si rilegge senza perdere niente", () => {
  /**
   * Un piccolo calendario, costruito con lo store stesso: un'attività di
   * gruppo, una di due unità e una di una sola, su date che cadono in giorni
   * della settimana diversi.
   */
  const CALENDARIO = [
    {
      titolo: "Apertura dell’anno sociale", data: "2026-09-20", tipo: "festa",
      nota: "Primo incontro di tutte le unità.", luogo: "Sala e sede", durata: "mezza giornata",
    },
    {
      titolo: "Uscita invernale", data: "2027-01-24", tipo: "uscita", unita: ["u1", "u2"],
      nota: "Una giornata sulla neve.", luogo: "In montagna", durata: "giornata intera",
    },
    {
      titolo: "Riunione dell'unità 3", data: "2026-10-13", tipo: "riunione", unita: ["u3"],
      nota: "", luogo: "Sede", durata: "sera",
    },
  ];

  async function scrivi() {
    const ids = [];
    for (const a of CALENDARIO) ids.push(await store.creaAttivita(a, "prova"));
    return ids;
  }

  it("date e giorni della settimana restano quelli", async () => {
    await scrivi();
    const dal = await store.leggiAttivita();
    assert.equal(dal.length, CALENDARIO.length);

    for (const e of CALENDARIO) {
      const trovata = dal.find((a) => a.titolo === e.titolo);
      assert.ok(trovata, `manca «${e.titolo}»`);
      const [anno, mese, giorno] = e.data.split("-").map(Number);
      assert.equal(trovata.giorno, giorno, e.titolo);
      assert.equal(trovata.mese, MESI[mese - 1], e.titolo);
      assert.equal(trovata.anno, anno, e.titolo);
      /*
       * Il giorno della settimana si controlla contro il **calendario vero**.
       * `dow` non si conserva in una colonna sua: si ricava dalla data, perché
       * una data e il suo giorno della settimana non possono divergere, e
       * tenerli separati vuol dire poterlo fare.
       */
      const atteso = GIORNI[new Date(`${e.data}T12:00:00Z`).getUTCDay()];
      assert.equal(trovata.dow, atteso, `${e.titolo}: giorno della settimana`);
    }
  });

  it("le unità coinvolte restano le stesse, anche quando sono più d'una", async () => {
    await scrivi();
    const dal = await store.leggiAttivita();
    for (const e of CALENDARIO) {
      const trovata = dal.find((a) => a.titolo === e.titolo);
      const attese = e.unita ?? ["gruppo"];
      assert.deepEqual([...trovata.unita].sort(), [...attese].sort(), e.titolo);
    }
  });

  it("le attività di più unità usano `unita_chiavi`, quelle singole `unita_id`", async () => {
    await scrivi();
    const righe = raw.prepare("select titolo, unita_id, unita_chiavi from attivita").all();

    // «Uscita invernale» è di u1 e u2
    const due = righe.find((r) => r.titolo === "Uscita invernale");
    assert.equal(due.unita_id, null);
    assert.equal(due.unita_chiavi, "u1,u2");

    // «Riunione dell'unità 3» è della sola unità 3
    const una = righe.find((r) => r.titolo === "Riunione dell'unità 3");
    assert.ok(una.unita_id);
    assert.equal(una.unita_chiavi, "");

    // «Apertura dell'anno sociale» è di tutto il gruppo
    const gruppo = righe.find((r) => r.titolo === "Apertura dell’anno sociale");
    assert.equal(gruppo.unita_id, null);
    assert.equal(gruppo.unita_chiavi, "");
  });

  it("nessuna riga ha tutte e due le colonne dell'ambito piene", async () => {
    await scrivi();
    const storte = raw
      .prepare("select count(*) n from attivita where unita_id is not null and unita_chiavi <> ''")
      .get().n;
    assert.equal(storte, 0);
  });

  it("nota, luogo e durata non si perdono", async () => {
    const ids = await scrivi();
    for (const [i, e] of CALENDARIO.entries()) {
      const t = await store.attivitaPerId(ids[i]);
      assert.equal(t.nota, e.nota, e.titolo);
      assert.equal(t.luogo, e.luogo, e.titolo);
      assert.equal(t.durata, e.durata, e.titolo);
    }
  });

  it("ogni attività finisce nel proprio anno sociale", async () => {
    await scrivi();
    await store.creaAttivita({ titolo: "Campo estivo", data: "2026-07-20", tipo: "campo" }, "prova");
    const righe = raw
      .prepare(
        "select a.titolo, an.etichetta from attivita a join anni_sociali an on an.id = a.anno_id",
      )
      .all();
    const anno = Object.fromEntries(righe.map((r) => [r.titolo, r.etichetta]));
    // da settembre a luglio è un anno sociale solo; il luglio prima è dell'anno prima
    assert.equal(anno["Apertura dell’anno sociale"], "2026-2027");
    assert.equal(anno["Uscita invernale"], "2026-2027");
    assert.equal(anno["Riunione dell'unità 3"], "2026-2027");
    assert.equal(anno["Campo estivo"], "2025-2026");
  });
});

describe("l'anno sociale di una data", () => {
  it("settembre apre, agosto chiude", () => {
    assert.equal(store.annoSocialeDi("2026-09-01"), "2026-2027");
    assert.equal(store.annoSocialeDi("2026-12-25"), "2026-2027");
    assert.equal(store.annoSocialeDi("2027-08-31"), "2026-2027");
    assert.equal(store.annoSocialeDi("2027-09-01"), "2027-2028");
  });
});

describe("scrivere un'attività", () => {
  it("nasce in bozza e non compare nel calendario pubblico", async () => {
    const id = await store.creaAttivita(
      { titolo: "Riunione di staff", data: "2026-11-05", tipo: "riunione" },
      "cg",
    );
    const a = await store.attivitaPerId(id);
    assert.equal(a.stato, "bozza");
    assert.equal(a.titolo, "Riunione di staff");
    assert.equal(a.dow, "gio", "5 novembre 2026 è un giovedì");
    assert.equal(a.anno_sociale, "2026-2027");

    const pubbliche = await store.attivitaPubbliche();
    assert.equal(pubbliche.some((x) => x.id === id), false);
  });

  it("senza unità è di gruppo", async () => {
    const id = await store.creaAttivita(
      { titolo: "Festa", data: "2026-11-05", tipo: "festa" },
      "cg",
    );
    assert.deepEqual((await store.attivitaPerId(id)).unita, ["gruppo"]);
  });

  it("con una sola unità usa la chiave esterna", async () => {
    const id = await store.creaAttivita(
      { titolo: "Uscita u1", data: "2026-11-05", tipo: "uscita", unita: ["u1"] },
      "cg",
    );
    const riga = raw.prepare("select unita_id, unita_chiavi from attivita where id = ?").get(id);
    assert.ok(riga.unita_id);
    assert.equal(riga.unita_chiavi, "");
    assert.deepEqual((await store.attivitaPerId(id)).unita, ["u1"]);
  });

  it("con più unità usa l'elenco", async () => {
    const id = await store.creaAttivita(
      {
        titolo: "Uscita di fascia",
        data: "2026-11-05",
        tipo: "uscita",
        unita: ["u3", "u4"],
      },
      "cg",
    );
    const riga = raw.prepare("select unita_id, unita_chiavi from attivita where id = ?").get(id);
    assert.equal(riga.unita_id, null);
    assert.equal(riga.unita_chiavi, "u3,u4");
    assert.deepEqual((await store.attivitaPerId(id)).unita, ["u3", "u4"]);
  });

  it("un'unità che non esiste è un errore che dice quale", async () => {
    await assert.rejects(
      () =>
        store.creaAttivita(
          { titolo: "x", data: "2026-11-05", tipo: "uscita", unita: ["castorini"] },
          "cg",
        ),
      /castorini/,
    );
  });

  it("una data mal scritta si rifiuta subito", async () => {
    await assert.rejects(
      () => store.creaAttivita({ titolo: "x", data: "11/05/2026", tipo: "uscita" }, "cg"),
      /Data non valida/,
    );
  });

  it("un anno sociale che non esiste lo dice invece di inventarlo", async () => {
    await assert.rejects(
      () => store.creaAttivita({ titolo: "x", data: "2050-11-05", tipo: "uscita" }, "cg"),
      /2050-2051/,
    );
  });
});

describe("modificare e pubblicare", () => {
  async function unaBozza() {
    return store.creaAttivita(
      { titolo: "Uscita di prova", data: "2026-11-05", tipo: "uscita", unita: ["u1"] },
      "cg",
    );
  }

  it("cambiare la data ricalcola giorno della settimana e anno sociale", async () => {
    const id = await unaBozza();
    // da novembre 2026 (anno 2026-2027) a giugno 2026 (anno 2025-2026)
    assert.equal(await store.aggiornaAttivita(id, { data: "2026-06-15" }, "cg"), true);
    const a = await store.attivitaPerId(id);
    assert.equal(a.anno_sociale, "2025-2026");
    assert.equal(a.dow, "lun", "15 giugno 2026 è un lunedì");
  });

  it("spostarla in un anno sociale che non esiste lo dice, e non la sposta", async () => {
    const id = await unaBozza();
    // gli anni sono i quattro di `ANNI_DOC`, e vanno all'indietro: il 2027-2028
    // non c'è finché qualcuno non archivia l'anno in corso
    await assert.rejects(
      () => store.aggiornaAttivita(id, { data: "2027-09-12" }, "cg"),
      /2027-2028/,
    );
    assert.equal((await store.attivitaPerId(id)).anno_sociale, "2026-2027", "è rimasta dov'era");
  });

  it("passare da una unità a due sposta l'ambito nell'altra colonna", async () => {
    const id = await unaBozza();
    await store.aggiornaAttivita(id, { unita: ["u1", "u2"] }, "cg");
    const riga = raw.prepare("select unita_id, unita_chiavi from attivita where id = ?").get(id);
    assert.equal(riga.unita_id, null, "la chiave esterna si libera");
    assert.equal(riga.unita_chiavi, "u1,u2");

    // e tornare indietro rifà il contrario
    await store.aggiornaAttivita(id, { unita: ["u4"] }, "cg");
    const dopo = raw.prepare("select unita_id, unita_chiavi from attivita where id = ?").get(id);
    assert.ok(dopo.unita_id);
    assert.equal(dopo.unita_chiavi, "");
  });

  it("pubblicare la fa comparire, ritirarla la fa sparire", async () => {
    const id = await unaBozza();
    await store.cambiaStatoAttivita(id, "pubblicato", "cg");
    assert.ok((await store.attivitaPubbliche()).some((a) => a.id === id));

    await store.cambiaStatoAttivita(id, "bozza", "cg");
    assert.equal((await store.attivitaPubbliche()).some((a) => a.id === id), false);
  });

  it("la coda di revisione mostra solo quelle in revisione", async () => {
    const id = await unaBozza();
    assert.equal((await store.attivitaInRevisione()).length, 0);
    await store.cambiaStatoAttivita(id, "in-revisione", "cg");
    assert.deepEqual((await store.attivitaInRevisione()).map((a) => a.id), [id]);
  });

  it("cancellare la porta via", async () => {
    const id = await unaBozza();
    assert.equal(await store.eliminaAttivita(id, "cg"), true);
    assert.equal(await store.attivitaPerId(id), null);
    assert.equal(await store.eliminaAttivita(id, "cg"), false);
  });

  it("su un'attività che non esiste tutte restituiscono false", async () => {
    assert.equal(await store.aggiornaAttivita(999999, { titolo: "x" }, "cg"), false);
    assert.equal(await store.cambiaStatoAttivita(999999, "bozza", "cg"), false);
  });
});

describe("la vista di un referente di unità", () => {
  it("vede le proprie e quelle di gruppo, non quelle di altre unità", async () => {
    const crea = (titolo, unita) =>
      store.creaAttivita({ titolo, data: "2026-11-15", tipo: "uscita", unita }, "cg");
    await crea("Apertura dell’anno sociale", undefined);
    await crea("Uscita invernale", ["u1", "u2"]);
    await crea("Gita delle unità 5 e 6", ["u5", "u6"]);
    await crea("Uscita dell'unità 2", ["u2"]);
    const u1 = await store.attivitaDiUnita("u1");

    assert.ok(u1.some((a) => a.titolo === "Apertura dell’anno sociale"), "quelle di gruppo");
    assert.ok(u1.some((a) => a.titolo === "Uscita invernale"), "quelle di u1+u2");
    assert.equal(
      u1.some((a) => a.titolo === "Gita delle unità 5 e 6"),
      false,
      "non quelle di u5 e u6",
    );
    assert.equal(
      u1.some((a) => a.titolo === "Uscita dell'unità 2"),
      false,
      "né quelle di un'altra unità sola",
    );
  });
});

describe("l'ambito, in forma leggibile", () => {
  it("si scrive «di gruppo», il nome dell'unità, o i due nomi uniti", () => {
    const etichetta = (k) => ({ u1: "Label 1", u2: "Label 2" })[k] ?? k;
    const { ambitoDa, etichettaAmbito } = vocabolario;

    assert.equal(etichettaAmbito(ambitoDa(null, ""), etichetta), "di gruppo");
    assert.equal(etichettaAmbito(ambitoDa("u1", ""), etichetta), "Label 1");
    assert.equal(
      etichettaAmbito(ambitoDa(null, "u1,u2"), etichetta),
      "Label 1 e Label 2",
    );
  });

  it("tollera spazi e virgole di troppo in `unita_chiavi`", () => {
    assert.deepEqual(vocabolario.separa(" u1 , , u2 "), ["u1", "u2"]);
    assert.deepEqual(vocabolario.separa(""), []);
  });
});

describe("chi governa quale attività", () => {
  /**
   * La regola dell'ambito, provata attraverso il cancello vero.
   *
   * Non si prova `unitaPerCancello` da sola: quella restituisce una stringa, e
   * una stringa non dice se qualcuno entra o no. Si prova la coppia — la regola
   * più `decidi` — perché è quella che decide davvero, ed è l'unico modo di
   * accorgersi se un giorno una delle due cambia senza l'altra.
   */
  let decidi, unitaPerCancello, FUNZIONI_INIZIALI;

  before(async () => {
    ({ decidi } = await import("@/lib/auth/decisione"));
    ({ unitaPerCancello } = await import("@/lib/attivita"));
    ({ FUNZIONI_INIZIALI } = await import("@/lib/permessi"));
  });

  const sessione = (r, un) => ({ u: "x", n: "X", i: "XX", r, un, exp: 2 ** 40 });

  /** Un referente di unità può toccare un'attività con queste unità coinvolte? */
  const puo = (ruolo, sua, unitaAttivita) =>
    decidi(FUNZIONI_INIZIALI, sessione(ruolo, sua), "attivita", {
      unita: unitaPerCancello(unitaAttivita),
    }).ok;

  it("il referente di unità governa le attività della propria unità", () => {
    assert.equal(puo("referente", "u1", ["u1"]), true);
  });

  it("ma non quelle di un'altra unità", () => {
    assert.equal(puo("referente", "u1", ["u2"]), false);
  });

  it("né quelle di tutto il gruppo", () => {
    assert.equal(puo("referente", "u1", ["gruppo"]), false);
    assert.equal(puo("referente", "u1", []), false);
  });

  it("né quelle che coinvolgono la sua **insieme a** un'altra", () => {
    /*
     * È il caso che vale la pena provare: la sua unità c'è dentro, e sarebbe
     * facile scrivere una regola che dice di sì. Un'uscita di u1 e
     * u2 non è dell'unità 1 — chi la modifica cambia la data anche
     * all'altra unità, che non lo saprebbe.
     */
    assert.equal(puo("referente", "u1", ["u1", "u2"]), false);
    assert.equal(puo("referente", "u1", ["u2", "u1"]), false);
  });

  it("il gestore e lo sviluppatore governano tutto", () => {
    for (const ruolo of ["gestore", "sviluppatore"]) {
      for (const unita of [["u1"], ["gruppo"], [], ["u1", "u2"]]) {
        assert.equal(puo(ruolo, undefined, unita), true, `${ruolo} ${unita.join("+")}`);
      }
    }
  });

  it("un referente di unità senza unità non governa niente, nemmeno le proprie", () => {
    assert.equal(puo("referente", undefined, ["u1"]), false);
  });
});

describe("validazione del modulo (VAL-01)", () => {
  /*
   * Dall'audit di sicurezza: la data si controllava solo nella forma, e nota,
   * luogo e durata non avevano un tetto. `dataValida` e `LIMITI_ATTIVITA` sono
   * quello che la Server Action usa; il componente riusa gli stessi limiti.
   */
  it("una data che non esiste è rifiutata, una vera passa", async () => {
    const { dataValida } = await import("@/lib/attivita");
    for (const vera of ["2026-02-28", "2028-02-29", "2026-12-31"]) assert.equal(dataValida(vera), true, vera);
    for (const falsa of ["2026-02-31", "2026-13-45", "2027-02-29", "2026-00-10", "26-01-01", "2026-1-1", ""]) {
      assert.equal(dataValida(falsa), false, falsa);
    }
  });

  it("i limiti ci sono per ogni campo di testo", async () => {
    const { LIMITI_ATTIVITA } = await import("@/lib/attivita");
    assert.deepEqual(Object.keys(LIMITI_ATTIVITA).sort(), ["durata", "luogo", "nota", "titolo"]);
  });
});
