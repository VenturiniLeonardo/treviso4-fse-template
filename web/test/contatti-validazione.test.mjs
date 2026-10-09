import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

/**
 * La validazione del modulo contatti — presenza, forma e lunghezza.
 *
 * La parte sulla **lunghezza** nasce dall'audit di produzione (SEC-04): prima
 * nessun campo aveva un tetto, e l'unico limite era i 24 MB del corpo della
 * richiesta, alzati per le fotografie. Una riga `messaggi` poteva così pesare
 * quanto una foto ed essere conservata due anni.
 *
 * `validaContatti` è una funzione pura, senza `next/headers`: la si prova qui
 * direttamente, mentre la Server Action ci mette solo indirizzo, limite e
 * salvataggio.
 */

let validaContatti, LIMITI_CONTATTI;

const BASE = {
  nome: "Mario Rossi",
  email: "mario.rossi@example.it",
  telefono: "+39 340 1234567",
  motivo: "iscrizione",
  messaggio: "Buongiorno, vorrei qualche informazione. Grazie.",
};

before(async () => {
  ({ validaContatti, LIMITI_CONTATTI } = await import("@/lib/contatti"));
});

describe("presenza e forma", () => {
  it("un modulo completo e valido passa", () => {
    assert.deepEqual(validaContatti(BASE, true), { ok: true });
  });

  it("il nome mancante è segnalato", () => {
    const r = validaContatti({ ...BASE, nome: "" }, true);
    assert.equal(r.ok, false);
    assert.ok(r.campi.includes("nome"));
    assert.equal(
      r.errore,
      "Controllate i campi evidenziati: nome, email, motivo, messaggio di almeno 9 caratteri e lettura dell’informativa privacy.",
    );
  });

  it("un'email storta è segnalata (un «@» non basta)", () => {
    assert.ok(validaContatti({ ...BASE, email: "mario@" }, true).campi.includes("email"));
    assert.ok(validaContatti({ ...BASE, email: "@" }, true).campi.includes("email"));
  });

  it("un messaggio troppo corto è segnalato", () => {
    assert.ok(validaContatti({ ...BASE, messaggio: "ciao" }, true).campi.includes("messaggio"));
  });

  it("il consenso privacy mancante è segnalato", () => {
    assert.ok(validaContatti(BASE, false).campi.includes("privacy"));
  });

  it("un motivo che non esiste è segnalato", () => {
    assert.ok(validaContatti({ ...BASE, motivo: "inventato" }, true).campi.includes("motivo"));
  });
});

describe("lunghezza massima (SEC-04)", () => {
  it("un nome oltre il limite è «troppo lungo», e torna tagliato al limite", () => {
    const r = validaContatti({ ...BASE, nome: "a".repeat(LIMITI_CONTATTI.nome + 1) }, true);
    assert.equal(r.ok, false);
    assert.deepEqual(r.campi, ["nome"]);
    assert.match(r.errore, /troppo lungo/);
    assert.equal(r.valori.nome.length, LIMITI_CONTATTI.nome, "il valore rimandato è tagliato al limite");
  });

  it("un messaggio oltre il limite è rifiutato prima di salvare", () => {
    const r = validaContatti({ ...BASE, messaggio: "x".repeat(LIMITI_CONTATTI.messaggio + 1) }, true);
    assert.equal(r.ok, false);
    assert.deepEqual(r.campi, ["messaggio"]);
    assert.equal(r.valori.messaggio.length, LIMITI_CONTATTI.messaggio);
  });

  it("un telefono enorme è rifiutato (anche se il formato non si controlla)", () => {
    const r = validaContatti({ ...BASE, telefono: "3".repeat(LIMITI_CONTATTI.telefono + 5) }, true);
    assert.equal(r.ok, false);
    assert.ok(r.campi.includes("telefono"));
  });

  it("un'email lunga ma valida oltre il limite è rifiutata", () => {
    const lunga = "a".repeat(LIMITI_CONTATTI.email) + "@ex.it"; // valida per forma, oltre il limite
    const r = validaContatti({ ...BASE, email: lunga }, true);
    assert.equal(r.ok, false);
    assert.ok(r.campi.includes("email"));
  });

  it("al limite esatto è ancora valido (solo l'eccesso è rifiutato)", () => {
    const alLimite = {
      ...BASE,
      nome: "a".repeat(LIMITI_CONTATTI.nome),
      messaggio: "m".repeat(LIMITI_CONTATTI.messaggio),
      telefono: "3".repeat(LIMITI_CONTATTI.telefono),
    };
    assert.deepEqual(validaContatti(alLimite, true), { ok: true });
  });

  it("la presenza viene prima della lunghezza: un campo mancante vince", () => {
    // messaggio enorme MA nome vuoto: si segnala la presenza, non la lunghezza
    const r = validaContatti(
      { ...BASE, nome: "", messaggio: "x".repeat(LIMITI_CONTATTI.messaggio + 1) },
      true,
    );
    assert.ok(r.campi.includes("nome"));
    assert.equal(
      r.errore,
      "Controllate i campi evidenziati: nome, email, motivo, messaggio di almeno 9 caratteri e lettura dell’informativa privacy.",
    );
  });
});

describe("costo della validazione dell'email (DOS-01)", () => {
  /*
   * La regex di prima, `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`, aveva un costo
   * quadratico su una sequenza di punti che non chiude con un dominio: 38 ms a
   * 8 000 caratteri, minuti a qualche megabyte — e il modulo è pubblico. Qui
   * l'input è quello della prova dell'audit, allargato a un megabyte.
   */
  const ostile = (n) => "a@" + ".".repeat(n) + "@";

  it("un'email ostile da 1 MB è rifiutata in pochi millisecondi", () => {
    const inizio = performance.now();
    const r = validaContatti({ ...BASE, email: ostile(1_000_000) }, true);
    const ms = performance.now() - inizio;
    assert.equal(r.ok, false);
    assert.ok(r.campi.includes("email"));
    // con la regex di prima, minuti; la soglia è larga per una macchina carica
    assert.ok(ms < 200, `validazione in ${ms.toFixed(1)} ms`);
  });

  it("emailValida accetta gli indirizzi normali e rifiuta quelli storti", async () => {
    const { emailValida } = await import("@/lib/email");
    for (const buono of ["mario.rossi@example.it", "a@b.cc", "x+y@sotto.dominio.org"]) {
      assert.equal(emailValida(buono), true, buono);
    }
    for (const storto of ["@", "mario@", "@ex.it", "a@b", "a@b.c", "a b@ex.it", "a@b@ex.it", "a@b..it", "a@.b.it"]) {
      assert.equal(emailValida(storto), false, storto);
    }
  });
});

describe("la posta ai gestori", () => {
  let oggetto, testo;
  before(async () => {
    ({ oggettoMessaggioContatti: oggetto, testoMessaggioContatti: testo } = await import(
      "@/lib/contatti"
    ));
  });

  it("il corpo contiene tutto quello che la persona ha scritto", () => {
    const t = testo(BASE, "Iscrizione di un ragazzo", 7, new Date("2026-10-06T12:00:00Z"));
    for (const v of [BASE.nome, BASE.email, BASE.telefono, BASE.messaggio, "Iscrizione di un ragazzo", "n. 7"]) {
      assert.ok(t.includes(v), `manca «${v}»`);
    }
  });

  it("senza telefono scrive un trattino, e senza id non scrive «n.»", () => {
    const t = testo({ ...BASE, telefono: "" }, "Altro", undefined, new Date());
    assert.match(t, /Telefono:\s+—/);
    assert.doesNotMatch(t, /n\. /);
  });

  it("l'oggetto non può portarsi dietro intestazioni", () => {
    const o = oggetto("Altro", "Mario\r\nBcc: estraneo@esempio.it");
    assert.doesNotMatch(o, /[\r\n]/);
  });

  it("l'oggetto ha un tetto sul nome", () => {
    assert.ok(oggetto("Altro", "x".repeat(500)).length < 130);
  });
});
