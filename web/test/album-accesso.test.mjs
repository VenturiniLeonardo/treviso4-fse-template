import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * La password degli album: `lib/album-password.ts` e `lib/album-accesso.ts`.
 *
 * `lib/album-cookie.ts` non si prova qui, perché importa `next/headers`; ma è
 * una riga di lettura e una di scrittura attorno a `cookieValido` e
 * `provaPassword`, che sono la decisione vera e si provano per intero.
 */

let cartella;
let raw;
let chiudiPerTest;
let album;
let accesso;
let regole;

before(async () => {
  cartella = mkdtempSync(join(tmpdir(), "t4-album-accesso-"));
  const percorso = join(cartella, "prova.db");
  process.env.SITO_DB = percorso;
  process.env.SITO_DATI_DIR = join(cartella, "dati");
  process.env.SITO_TOTP_SEGRETO = "chiave-di-prova-delle-password-degli-album";

  const iniziale = new Database(percorso);
  migrate(drizzle(iniziale), { migrationsFolder: "./drizzle" });
  iniziale.close();

  album = await import("@/lib/album");
  accesso = await import("@/lib/album-accesso");
  regole = await import("@/lib/album-password");
  ({ chiudiPerTest } = await import("@/lib/db/db"));
  raw = new Database(percorso);
});

after(() => {
  raw?.close();
  chiudiPerTest?.();
  delete process.env.SITO_DB;
  delete process.env.SITO_DATI_DIR;
  delete process.env.SITO_TOTP_SEGRETO;
  if (cartella) rmSync(cartella, { recursive: true, force: true });
});

beforeEach(() => {
  raw.prepare("DELETE FROM foto").run();
  raw.prepare("DELETE FROM album").run();
});

const nuovo = (titolo = "Campo estivo") =>
  album.creaAlbum(
    { titolo, anno: "2026 – 2027", unita: "u1", data: "Agosto 2026", sottotitolo: "", tag: "" },
    0,
    "",
  );

describe("la password proposta", () => {
  it("ha la forma xxxxx-xxxxx e passa le regole", () => {
    for (let i = 0; i < 200; i++) {
      const p = regole.proponiPasswordAlbum();
      assert.match(p, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
      assert.equal(regole.errorePasswordAlbum(p), null);
    }
  });

  it("non usa i caratteri che si confondono ricopiandoli", () => {
    const tutte = Array.from({ length: 300 }, () => regole.proponiPasswordAlbum()).join("");
    assert.doesNotMatch(tutte, /[01oil]/);
  });

  it("non si ripete", () => {
    const viste = new Set(Array.from({ length: 500 }, () => regole.proponiPasswordAlbum()));
    assert.equal(viste.size, 500);
  });
});

describe("le regole di una password scelta a mano", () => {
  it("rifiuta le troppo corte, le troppo lunghe e quelle con spazi", () => {
    assert.ok(regole.errorePasswordAlbum("corta"));
    assert.ok(regole.errorePasswordAlbum("x".repeat(65)));
    assert.ok(regole.errorePasswordAlbum("campo estivo"));
    assert.equal(regole.errorePasswordAlbum("CampoEstivo2026"), null);
  });
});

describe("la serratura", () => {
  it("un album appena creato è chiuso finché non ha una password", async () => {
    const slug = await nuovo();
    const s = accesso.serraturaPerIndirizzo(slug);
    assert.ok(s);
    assert.equal(s.versione, null);
    assert.equal(accesso.provaPassword(slug, "qualunque-cosa"), null);
    assert.equal(accesso.cookieValido(s, "qualunque"), false);
  });

  it("per il modulo pubblico un album non pubblicato è come uno che non c'è (SEC-AUTH-001)", async () => {
    const slug = await nuovo();
    accesso.impostaPasswordAlbum(slug, "k7mq3-xr9tb");
    for (const stato of ["bozza", "in_revisione"]) {
      raw.prepare("UPDATE album SET stato = ? WHERE slug = ?").run(stato, slug);
      assert.equal(accesso.serraturaPubblica(slug), null, stato);
    }
    assert.equal(accesso.serraturaPubblica("non-esiste"), null);

    raw.prepare("UPDATE album SET stato = 'pubblicato' WHERE slug = ?").run(slug);
    const s = accesso.serraturaPubblica(slug);
    assert.ok(s?.versione);
    assert.deepEqual(s, accesso.serraturaPerIndirizzo(slug));
  });

  it("con la password giusta si ottiene un cookie che apre, con quella sbagliata no", async () => {
    const slug = await nuovo();
    assert.equal(accesso.impostaPasswordAlbum(slug, "k7mq3-xr9tb"), true);

    assert.equal(accesso.provaPassword(slug, "k7mq3-xr9tc"), null);
    assert.equal(accesso.provaPassword(slug, "K7MQ3-XR9TB"), null, "le maiuscole contano");

    const c = accesso.provaPassword(slug, "k7mq3-xr9tb");
    assert.ok(c);
    const s = accesso.serraturaPerIndirizzo(slug);
    assert.equal(c.nome, accesso.nomeCookieAlbum(s.id));
    assert.equal(accesso.cookieValido(s, c.valore), true);
    assert.equal(accesso.cookieValido(s, c.valore.slice(0, -1) + "x"), false);
  });

  it("il cookie di un album non apre un altro album", async () => {
    const a = await nuovo("Primo");
    const b = await nuovo("Secondo");
    accesso.impostaPasswordAlbum(a, "stessa-password");
    accesso.impostaPasswordAlbum(b, "stessa-password");

    const c = accesso.provaPassword(a, "stessa-password");
    assert.equal(accesso.cookieValido(accesso.serraturaPerIndirizzo(b), c.valore), false);
  });

  it("cambiare la password chiude l'album a chi l'aveva già aperto", async () => {
    const slug = await nuovo();
    accesso.impostaPasswordAlbum(slug, "prima-password");
    const vecchio = accesso.provaPassword(slug, "prima-password");

    // anche reimpostando la stessa: è il modo di chiudere l'album a tutti
    accesso.impostaPasswordAlbum(slug, "prima-password");
    assert.equal(accesso.cookieValido(accesso.serraturaPerIndirizzo(slug), vecchio.valore), false);
    assert.ok(accesso.provaPassword(slug, "prima-password"), "la password resta valida");
  });

  it("il cookie non contiene la password", async () => {
    const slug = await nuovo();
    accesso.impostaPasswordAlbum(slug, "segreto-album");
    const c = accesso.provaPassword(slug, "segreto-album");
    assert.doesNotMatch(c.valore, /segreto/);
  });
});

describe("la password a riposo", () => {
  it("in tabella è cifrata, e i referenti la rileggono in chiaro", async () => {
    const slug = await nuovo();
    accesso.impostaPasswordAlbum(slug, "k7mq3-xr9tb");
    const riga = raw.prepare("SELECT password_accesso p FROM album WHERE slug = ?").get(slug);
    assert.doesNotMatch(riga.p, /k7mq3/);
    assert.match(riga.p, /^g1:/);
    assert.equal(accesso.passwordDellAlbum(slug), "k7mq3-xr9tb");
  });

  it("un album senza password non ne restituisce una", async () => {
    const slug = await nuovo();
    assert.equal(accesso.passwordDellAlbum(slug), null);
  });

  it("albumConPassword elenca solo quelli che l'hanno", async () => {
    const a = await nuovo("Con");
    const b = await nuovo("Senza");
    accesso.impostaPasswordAlbum(a, "una-password");
    const con = accesso.albumConPassword();
    assert.ok(con.has(a));
    assert.ok(!con.has(b));
  });

  it("impostare la password di un album che non c'è non scrive niente", () => {
    assert.equal(accesso.impostaPasswordAlbum("album-inventato", "una-password"), false);
  });
});

describe("le fotografie portano la serratura del loro album", () => {
  it("fotoPubblica restituisce la versione solo quando l'album ha una password", async () => {
    const slug = await nuovo();
    await album.cambiaStatoAlbum(slug, "pubblicato", 0, "");
    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#4a7d55" },
    })
      .png()
      .toBuffer();
    const { foto } = await album.aggiungiFoto(slug, png, "", 1, "");

    assert.equal((await album.fotoPubblica(foto.file)).serratura.versione, null);
    accesso.impostaPasswordAlbum(slug, "una-password");
    const s = (await album.fotoPubblica(foto.file)).serratura;
    assert.equal(s.versione, accesso.serraturaPerIndirizzo(slug).versione);
    const c = accesso.provaPassword(slug, "una-password");
    assert.equal(accesso.cookieValido(s, c.valore), true);
  });

  it("solo la prima fotografia è la copertina, e resta tale finché è la prima", async () => {
    const slug = await nuovo();
    await album.cambiaStatoAlbum(slug, "pubblicato", 0, "");
    accesso.impostaPasswordAlbum(slug, "una-password");
    const sharp = (await import("sharp")).default;
    const png = (colore) =>
      sharp({ create: { width: 40, height: 40, channels: 3, background: colore } }).png().toBuffer();
    const prima = (await album.aggiungiFoto(slug, await png("#4a7d55"), "", 1, "")).foto;
    const seconda = (await album.aggiungiFoto(slug, await png("#7d4a55"), "", 2, "")).foto;
    const terza = (await album.aggiungiFoto(slug, await png("#554a7d"), "", 3, "")).foto;

    // è l'unica che `/foto-file` serve senza password
    assert.equal((await album.fotoPubblica(prima.file)).copertina, true);
    assert.equal((await album.fotoPubblica(seconda.file)).copertina, false);
    assert.equal((await album.fotoPubblica(terza.file)).copertina, false);

    // tolta la prima, la copertina diventa la seconda — e la prima non c'è più
    await album.togliFoto(slug, prima.file, 0, "");
    assert.equal(await album.fotoPubblica(prima.file), null);
    assert.equal((await album.fotoPubblica(seconda.file)).copertina, true);
  });

  it("la copertina di una bozza non è pubblica", async () => {
    const slug = await nuovo();
    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#4a7d55" },
    })
      .png()
      .toBuffer();
    const { foto } = await album.aggiungiFoto(slug, png, "", 1, "");
    assert.equal(await album.fotoPubblica(foto.file), null);
  });
});
