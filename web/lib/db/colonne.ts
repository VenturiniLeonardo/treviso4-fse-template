import type { Handle } from "@/lib/db/db";

/**
 * Una colonna c'è già, in questo database?
 *
 * Serve alle colonne aggiunte da una migrazione e lette da codice che deve
 * reggere anche lo schema di prima: il rilascio compila **prima** di applicare
 * le migrazioni, contro il database in esercizio (`docs/implementation/rilascio.md`),
 * e una query su una colonna che non c'è ancora fa fallire la compilazione. È
 * lo stesso problema di `tabellaPresente()` in `lib/cartelle-store.ts`, per le
 * colonne invece che per le tabelle.
 *
 * La risposta positiva si ricorda per tutto il processo — una colonna non
 * sparisce — quella negativa no, così dopo `db:applica` basta la prossima
 * richiesta per accorgersene.
 */
const viste = new Set<string>();

export function haColonna(d: Handle, tabella: string, colonna: string): boolean {
  const chiave = `${tabella}.${colonna}`;
  if (viste.has(chiave)) return true;
  // `tabella` non arriva mai dall'utente: è un nome scritto nel codice, ma lo si
  // controlla lo stesso, perché finisce dentro una PRAGMA che non accetta segnaposti
  if (!/^[a-z_]+$/.test(tabella)) return false;
  const righe = d.$client.prepare(`PRAGMA table_info(${tabella})`).all() as { name: string }[];
  const c = righe.some((r) => r.name === colonna);
  if (c) viste.add(chiave);
  return c;
}
