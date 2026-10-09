import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * I diciotto posti fotografici del disegno.
 *
 * Nascono da un difetto che nessuna prova poteva vedere, perché non era un
 * comportamento sbagliato: quarantotto riquadri rigati nelle pagine pubbliche,
 * di cui diciotto **senza nessun ramo `<img>` nel codice**. Restavano rettangoli
 * colorati per sempre, qualunque cosa il gruppo caricasse, e sopra ci stava
 * scritta la nota del progetto grafico — «foto fascia gialla», «ritratto».
 *
 * Le prove qui guardano le tre proprietà che rendono quel meccanismo diverso da
 * una scorciatoia:
 *
 *  1. una chiave che non è un posto del disegno **non entra**. È la difesa
 *     contro un modulo riscritto a mano, ed è l'unico controllo che il
 *     database non può fare da solo;
 *  2. sostituire un'immagine **dice quale file portare via**, o l'archivio si
 *     riempie di file che nessuna riga nomina;
 *  3. il catalogo dei posti resta **coerente con sé stesso**: chiavi uniche, e
 *     ogni posto d'unità appartiene a un'unità che esiste.
 */

let cartella;
let cartellaDati;
let raw;
let store;
let slot;
let chiudiPerTest;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-immagini-"));
  cartellaDati = join(cartella, "dati");
  mkdirSync(cartellaDati, { recursive: true });
  const percorso = join(cartellaDati, "sito.db");
  process.env.SITO_DATI_DIR = cartellaDati;
  process.env.SITO_DB = percorso;

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  store = await import("@/lib/immagini-store");
  slot = await import("@/lib/slot-immagini");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

beforeEach(() => {
  raw.prepare("delete from immagini").run();
});

after(() => {
  chiudiPerTest?.();
  raw?.close();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  rmSync(cartella, { recursive: true, force: true });
});

const MISURE = { larghezza: 1200, altezza: 800 };

describe("il catalogo dei posti", () => {
  it("ce ne sono, e sono quelli che le pagine hanno", () => {
    /*
     * Diciotto erano i riquadri contati nell'HTML servito dall'audit. Il
     * diciannovesimo è il ritratto della referente dell'unità 4, che
     * prima non compariva perché l’unità non aveva un referente in carica: il
     * catalogo dei ritratti si costruisce sui `responsabili` delle unità, e
     * cresce di uno ogni volta che un’unità ne acquista uno.
     *
     * Dal 23 settembre 2026 erano di nuovo diciotto: la copertina della
     * scheda «Foto» della home esce dal catalogo finché gli album sono spenti
     * (`lib/funzioni.ts`). Il 3 ottobre 2026 gli album si sono riaccesi, e i
     * posti sono tornati diciannove.
     *
     * Il numero resta scritto a mano di proposito: è la difesa contro un
     * posto che sparisce dal disegno senza che nessuno se ne accorga.
     */
    assert.equal(slot.SLOT.length, 19, "i posti del disegno, più un ritratto per ogni referente in carica");
  });

  it("le chiavi sono uniche", () => {
    /*
     * Due posti con la stessa chiave vorrebbero dire una fotografia in due
     * punti del sito e nessun modo di darne una diversa a ciascuno. È il tipo
     * di errore che si introduce aggiungendo un referente con lo stesso nome di un
     * altro, e che a schermo si vede solo come «ho caricato là e è comparsa
     * qua».
     */
    const chiavi = slot.SLOT.map((s) => s.chiave);
    assert.deepEqual(
      chiavi.filter((c, i) => chiavi.indexOf(c) !== i),
      [],
    );
  });

  it("un posto d'unità nomina un'unità che esiste", async () => {
    const { TUTTE_LE_UNITA } = await import("@/lib/data");
    for (const s of slot.SLOT) {
      if (s.unita) assert.ok(TUTTE_LE_UNITA.includes(s.unita), `${s.chiave} → ${s.unita}`);
    }
  });

  it("i ritratti sono marcati come tali", () => {
    // serve alla riga sul consenso in interfaccia, e a non lasciare che la
    // fotografia di una persona passi per decorativa
    const ritratti = slot.SLOT.filter((s) => s.chiave.startsWith("referente."));
    assert.ok(ritratti.length > 0);
    for (const r of ritratti) assert.ok(r.persona, `${r.chiave} deve nominare la persona`);
  });

  it("i due filtri per ruolo si dividono l'elenco senza sovrapporsi", () => {
    const gruppo = slot.slotDelGruppo().map((s) => s.chiave);
    const unite = [...new Set(slot.SLOT.filter((s) => s.unita).map((s) => s.unita))].flatMap((u) =>
      slot.slotDiUnita(u).map((s) => s.chiave),
    );
    assert.deepEqual(
      gruppo.filter((c) => unite.includes(c)),
      [],
      "nessun posto può stare in tutti e due gli elenchi",
    );
    assert.equal(gruppo.length + unite.length, slot.SLOT.length, "insieme devono coprirlo tutto");
  });
});

describe("registrare un'immagine", () => {
  it("la scrive, e si rilegge dalla mappa", async () => {
    await store.registraImmagine("home.fascia-rossa", "immagine-a.jpg", "image/jpeg", MISURE, "", "");
    const m = await store.immaginiCaricate();
    const i = m.get("home.fascia-rossa");
    assert.equal(i.file, "immagine-a.jpg");
    assert.equal(i.larghezza, 1200);
    assert.equal(i.descrizione, "", "senza descrizione esce la stringa vuota, non null");
  });

  it("una chiave che non è un posto del disegno non entra", async () => {
    /*
     * La chiave arriva da un campo nascosto di un modulo, e un modulo si può
     * riscrivere. Senza questo controllo, chiunque potesse caricare
     * un'immagine potrebbe riempire la tabella di righe che nessuna pagina
     * mostra — e che `db:orfani` poi difenderebbe come file «attesi».
     */
    const esito = await store.registraImmagine(
      "posto.inventato",
      "immagine-x.jpg",
      "image/jpeg",
      MISURE,
      "",
      "",
    );
    assert.equal(esito, null);
    assert.equal(raw.prepare("select count(*) n from immagini").get().n, 0);
  });

  it("sostituendola, dice quale file portare via", async () => {
    await store.registraImmagine("home.fascia-rossa", "immagine-vecchia.jpg", "image/jpeg", MISURE, "", "");
    const precedente = await store.registraImmagine(
      "home.fascia-rossa",
      "immagine-nuova.jpg",
      "image/jpeg",
      MISURE,
      "",
      "",
    );
    assert.equal(
      precedente,
      "immagine-vecchia.jpg",
      "senza questo nome, il file di prima resterebbe in archivio per sempre",
    );
    assert.equal(raw.prepare("select count(*) n from immagini").get().n, 1, "una riga per posto");
  });

  it("la prima volta non c'è niente da portare via", async () => {
    const precedente = await store.registraImmagine(
      "chi-siamo.gruppo",
      "immagine-a.jpg",
      "image/jpeg",
      MISURE,
      "",
      "",
    );
    assert.equal(precedente, null);
  });

  it("la descrizione si conserva, ripulita", async () => {
    await store.registraImmagine(
      "chi-siamo.gruppo",
      "immagine-a.jpg",
      "image/jpeg",
      MISURE,
      "  I referenti al campo estivo  ",
      "",
    );
    assert.equal((await store.immagineDi("chi-siamo.gruppo")).descrizione, "I referenti al campo estivo");
  });
});

describe("togliere un'immagine", () => {
  it("restituisce il file, e la riga sparisce", async () => {
    await store.registraImmagine("home.fascia-rossa", "immagine-a.jpg", "image/jpeg", MISURE, "", "");
    assert.equal(await store.togliImmagine("home.fascia-rossa"), "immagine-a.jpg");
    assert.equal(await store.immagineDi("home.fascia-rossa"), undefined);
  });

  it("su un posto vuoto non restituisce niente", async () => {
    assert.equal(await store.togliImmagine("home.fascia-rossa"), null);
  });
});

describe("la porta della rotta che le serve", () => {
  it("un file registrato ha le sue misure", async () => {
    await store.registraImmagine("home.fascia-rossa", "immagine-a.jpg", "image/jpeg", MISURE, "", "");
    const r = await store.immagineRegistrata("immagine-a.jpg");
    assert.equal(r.tipo, "image/jpeg");
    assert.equal(r.larghezza, 1200);
  });

  it("un file che nessuna riga nomina non esiste", async () => {
    /*
     * È l'unica porta di `/immagine/[file]`: senza, indovinando un nome si
     * potrebbe tirare fuori dall'archivio qualunque file — comprese le
     * fotografie dei ragazzi, che passano da un'altra rotta con altri
     * controlli.
     */
    assert.equal(await store.immagineRegistrata("immagine-mai-caricata.jpg"), null);
    assert.equal(await store.immagineRegistrata("foto-di-un-album-1234.jpg"), null);
  });
});

describe("una riga la cui chiave non è più un posto", () => {
  it("non si mostra: il riquadro non c'è più, e non si sa dove metterla", async () => {
    /*
     * Succede togliendo un riquadro dal disegno senza cancellare la riga. La
     * riga resta — e `db:orfani` la nomina, perché il suo file continua a
     * essere «atteso» — ma nessuna pagina la mostra, che è l'unica cosa
     * sensata: il posto in cui andava non esiste.
     */
    raw
      .prepare(
        "insert into immagini (chiave,file,tipo,larghezza,altezza) values ('posto.sparito','immagine-z.jpg','image/jpeg',10,10)",
      )
      .run();
    const m = await store.immaginiCaricate();
    assert.equal(m.has("posto.sparito"), false);
    assert.equal(raw.prepare("select count(*) n from immagini").get().n, 1, "la riga resta nel database");
  });
});
