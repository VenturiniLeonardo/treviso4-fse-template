#!/usr/bin/env node
/**
 * La copia di sicurezza: database più archivio, verificata.
 *
 *   npm run db:copia                 una copia, e tiene le ultime 7
 *   npm run db:copia -- --tieni 30   ne tiene 30
 *   npm run db:copia -- --elenco     mostra le copie presenti, senza farne una
 *
 * Dove finiscono: `SITO_COPIE_DIR`, o `<dati>/../copie`. Il perché di ogni
 * scelta — `VACUUM INTO` invece di `cp`, collegamenti fisici invece di copie,
 * verifica obbligatoria — è in `lib/db/copia.ts`.
 *
 * ## Il codice d'uscita
 *
 * `0` se la copia è sana; **`1` se la verifica è fallita**. Il secondo caso
 * merita di svegliare qualcuno: vuol dire che si è appena scoperto che il
 * database non è integro, e la copia appena fatta non serve a tornare indietro.
 *
 * ## Che cosa questo comando NON fa
 *
 * Non porta niente **fuori dalla macchina**. Se si perde il disco, si perdono i
 * dati e le copie insieme. La spinta verso un bucket europeo — Litestream per
 * il database, `restic` per i file — è §07 del piano, ed è la parte con le
 * credenziali: `deploy/README.md` dice cosa configurare. Questo comando è ciò
 * che rende quella parte facile, perché produce una cartella coerente e già
 * verificata da spingere; e da solo copre gli errori umani e la corruzione, che
 * sono i casi più frequenti.
 */
import { copia, elencoCopie, cartellaCopie } from "@/lib/db/copia";
import { percorsoDb } from "@/lib/db/percorso";

const argomenti = process.argv.slice(2);
const valore = (nome, difetto) => {
  const i = argomenti.indexOf(nome);
  if (i < 0) return difetto;
  const n = Number(argomenti[i + 1]);
  return Number.isInteger(n) && n > 0 ? n : difetto;
};

const kB = (b) => `${(b / 1000).toLocaleString("it-IT", { maximumFractionDigits: 0 })} kB`;

if (argomenti.includes("--elenco")) {
  const copie = elencoCopie();
  console.log(`copie in ${cartellaCopie()}`);
  if (copie.length === 0) {
    console.log("\nNessuna copia. Fatene una con «npm run db:copia».");
    process.exit(0);
  }
  console.log("");
  for (const c of copie) {
    const m = c.manifesto;
    console.log(
      `  ${c.nome}  ` +
        (m
          ? `${kB(m.byteDb).padStart(12)} db · ${String(m.file).padStart(4)} file · ` +
            `integrità: ${m.integrita}` +
            (m.collegamenti ? "" : " · file copiati, non collegati")
          : "manifesto illeggibile — copia da non usare"),
    );
  }
  process.exit(0);
}

const tieni = valore("--tieni", 7);

console.log(`database: ${percorsoDb()}`);
console.log(`copie in: ${cartellaCopie()}  (ne tengo ${tieni})\n`);

/*
 * La copia, con il guasto raccontato invece che sputato.
 *
 * Questo comando gira da un timer systemd alle due di notte, e chi lo legge lo
 * legge in `journalctl` — spesso mesi dopo, cercando perché il ripristino non
 * trova niente. Senza questo `try`, un database corrotto usciva come
 * `SqliteError: database disk image is malformed` con sei righe di stack e i
 * percorsi di `node_modules`: vero, e inutile a chi deve decidere che cosa
 * fare stanotte.
 *
 * Il database corrotto ha una riga sua perché è il caso urgente: significa che
 * l'ultima copia buona è quella di ieri, e che ogni ora che passa con il sito
 * acceso ne allontana un'altra.
 */
let e;
try {
  e = copia(tieni);
} catch (errore) {
  const corrotto = errore?.code === "SQLITE_CORRUPT" || /malformed/i.test(String(errore?.message));
  // `<3>` = errore per journald: la stessa scelta di notturno.mjs
  console.error(
    corrotto
      ? "<3>\nCOPIA NON FATTA: il database di partenza è corrotto.\n\n" +
          "SQLite dice «database disk image is malformed»: non si riesce a leggerlo\n" +
          "per intero, quindi non c'è niente di buono da copiare.\n\n" +
          "Che cosa fare, in quest'ordine:\n" +
          "  1. NON toccate il file e non riavviate il sito: ogni scrittura peggiora.\n" +
          "  2. Guardate qual è l'ultima copia buona:  npm run db:copia -- --elenco\n" +
          "  3. Ripristinatela su una cartella di prova:  npm run db:ripristina\n" +
          "  4. Solo dopo, con una copia in mano, provate a recuperare l'originale.\n"
      : `<3>\nCOPIA NON FATTA: ${errore?.message ?? errore}\n\n` +
          "La cartella a metà è stata tolta: in archivio non è rimasto niente che\n" +
          "somigli a una copia buona.\n",
  );
  process.exit(1);
}

console.log(`copia:    ${e.cartella}`);
console.log(`database: ${kB(e.byteDb)}`);
console.log(
  `archivio: ${e.file} file, ${kB(e.byteFile)}` +
    (e.collegamenti ? " (collegamenti fisici: non occupano spazio)" : " (copiati per intero)"),
);

const righe = Object.entries(e.righe);
if (righe.length) {
  console.log("\nrighe nella copia:");
  for (const [t, n] of righe) console.log(`  ${t.padEnd(16)} ${String(n).padStart(7)}`);
}

if (e.scadute.length) {
  console.log(`\ntolte perché oltre la conservazione: ${e.scadute.join(", ")}`);
}

if (e.integrita !== "ok") {
  // `<3>` = errore per journald: vedi la stessa scelta in notturno.mjs
  console.error(
    `<3>\nVERIFICA FALLITA: integrity_check dice «${e.integrita}».\n` +
      "La copia è stata fatta ma il database di partenza NON è integro: non\n" +
      "usatela per un ripristino e non toccate l'originale prima di aver capito.\n",
  );
  process.exit(1);
}

console.log("\nVerifica passata: la copia è integra.");
