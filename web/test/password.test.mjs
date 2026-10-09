import assert from "node:assert/strict";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import {
  ARGON2,
  creaHashPassword,
  daRiHashare,
  formatoHash,
  passwordAccettabile,
  PASSWORD_MIN,
  verificaAVuoto,
  verificaPassword,
} from "@/lib/auth/password";

/**
 * Le password: argon2id adesso, scrypt per quelle di prima.
 *
 * La prova che conta è che un hash **scritto dal codice vecchio** continui a
 * verificarsi: è l'unica cosa che sta fra un rilascio e quattordici persone
 * chiuse fuori. Per questo lo scrypt di queste prove non lo produce il modulo —
 * lo produce `node:crypto` a mano, nello stesso formato del file `utenti.json`.
 */

const scryptAsync = promisify(scrypt);

/** Un hash nel formato vecchio, fabbricato senza passare dal modulo. */
async function scryptComeIlVecchioCodice(password) {
  const N = 16384;
  const R = 8;
  const P = 1;
  const salt = randomBytes(16);
  const derivata = await scryptAsync(password, salt, 32, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), derivata.toString("base64")].join("$");
}

describe("argon2id", () => {
  it("produce il formato PHC con i parametri di §7 del piano", async () => {
    const h = await creaHashPassword("una-password-qualunque");
    assert.match(
      h,
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${ARGON2.memoriaKiB},t=${ARGON2.passate},p=${ARGON2.parallelismo}\\$`,
      ),
    );
    assert.equal(formatoHash(h), "argon2id");
  });

  it("verifica quella giusta e rifiuta quella sbagliata", async () => {
    const h = await creaHashPassword("la-password-vera-12");
    assert.equal(await verificaPassword("la-password-vera-12", h), true);
    assert.equal(await verificaPassword("la-password-vera-13", h), false);
    assert.equal(await verificaPassword("", h), false);
  });

  it("due hash della stessa password sono diversi: il sale è casuale", async () => {
    const a = await creaHashPassword("stessa-password-qui");
    const b = await creaHashPassword("stessa-password-qui");
    assert.notEqual(a, b);
    assert.equal(await verificaPassword("stessa-password-qui", b), true);
  });

  it("è i byte della password, non le lettere che si vedono", async () => {
    // «è» si può scrivere in due modi che sullo schermo sono identici: un solo
    // codepoint (U+00E8) oppure «e» seguito da un accento combinante (U+0300).
    // Qui sono scritti con le sequenze di fuga apposta, perché scritti a lettere
    // questa prova sembrerebbe sbagliata a chiunque la legga.
    const precomposta = "caff\u00E8-lungo-1234";
    const decomposta = "caffe\u0300-lungo-1234";
    assert.equal(precomposta.length + 1, decomposta.length);

    const h = await creaHashPassword(precomposta);
    assert.equal(await verificaPassword(precomposta, h), true);
    // e chi la ridigita su un sistema che normalizza in modo diverso non entra:
    // è un limite reale di qualunque hash di password, non un difetto di questo
    assert.equal(await verificaPassword(decomposta, h), false);
  });
});

describe("gli hash scrypt che c'erano già", () => {
  it("si verificano ancora, ed è il motivo per cui il codice resta", async () => {
    const vecchio = await scryptComeIlVecchioCodice("password-del-2025");
    assert.equal(formatoHash(vecchio), "scrypt");
    assert.equal(await verificaPassword("password-del-2025", vecchio), true);
    assert.equal(await verificaPassword("password-del-2026", vecchio), false);
  });

  it("sono segnalati come da riscrivere; quelli argon2id no", async () => {
    assert.equal(daRiHashare(await scryptComeIlVecchioCodice("x")), true);
    assert.equal(daRiHashare(await creaHashPassword("x")), false);
  });
});

describe("gli hash rotti", () => {
  it("sono un rifiuto, mai un'eccezione", async () => {
    const rotti = [
      "",
      "scrypt$",
      "scrypt$16384$8$1$non-base64$nemmeno-questo",
      // N non è una potenza di due: scrypt solleva, e qui non deve uscire
      "scrypt$3$8$1$AAAA$AAAA",
      "$argon2id$v=19$m=19456,t=2,p=1$troncato",
      "$argon2d$v=19$m=19456,t=2,p=1$AAAA$AAAA",
      "password-in-chiaro",
    ];
    for (const r of rotti) {
      assert.equal(await verificaPassword("qualunque", r), false, r);
    }
  });

  it("un formato sconosciuto si riconosce prima di provare a verificarlo", () => {
    assert.equal(formatoHash("bcrypt$2b$12$..."), "sconosciuto");
    // e va riscritto: è quello che non sappiamo verificare
    assert.equal(daRiHashare("bcrypt$2b$12$..."), true);
  });
});

describe("la verifica a vuoto", () => {
  it("restituisce sempre falso, e ci mette il tempo di una vera", async () => {
    // il valore non è interessante: è il tempo che serve, e qui si prova solo
    // che il ramo esiste e non solleva
    assert.equal(await verificaAVuoto("qualunque-cosa"), false);
  });
});

describe("i requisiti della password nuova", () => {
  it("rifiuta quelle corte, lunghe, e con gli spazi ai bordi", () => {
    assert.match(passwordAccettabile("corta"), /almeno 12/);
    assert.equal(passwordAccettabile("x".repeat(PASSWORD_MIN)), null);
    assert.match(passwordAccettabile("x".repeat(201)), /troppo lunga/);
    assert.match(passwordAccettabile(" spazio-davanti-12"), /spazio/);
    assert.match(passwordAccettabile("spazio-dietro-12 "), /spazio/);
  });

  it("una password con spazi in mezzo va bene: le frasi sono buone password", () => {
    assert.equal(passwordAccettabile("tre parole scelte a caso"), null);
  });
});
