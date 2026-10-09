-- Aggiunge `permessi.ordine`.
--
-- MIGRAZIONE CORRETTA A MANO, e va detto perché.
--
-- drizzle-kit l'aveva generata con una ricostruzione della tabella — necessaria,
-- perché SQLite non sa aggiungere un CHECK con ALTER TABLE — ma la riga di
-- travaso selezionava «ordine» dalla tabella VECCHIA, che quella colonna non ce
-- l'ha ancora:
--
--   SELECT "id","funzione","nome","ruolo","livello","ordine" FROM `permessi`
--                                                   ^^^^^^^^ no such column
--
-- SQLite valida i nomi di colonna alla preparazione, quindi falliva anche su una
-- tabella vuota. Provato: «no such column: "ordine"», SQLITE_ERROR, e il
-- migratore di Drizzle — che avvolge tutte le migrazioni pendenti in UNA
-- transazione — annullava anche la 0000, lasciando un database vuoto.
--
-- La correzione è una parola: la colonna nuova si travasa come letterale 0, che
-- è anche il suo valore predefinito. Il piano §9 prevede esattamente questo caso
-- («per modifiche strutturali SQLite che richiedono ricostruzione tabella, si fa,
-- ma con una migrazione scritta a mano e una prova di ripristino prima»).
--
-- Lo snapshot in meta/ non va toccato: descrive già lo schema giusto, quindi le
-- generazioni successive non vedono nessuna deriva.
--
-- Nota su PRAGMA foreign_keys: dentro una transazione SQLite lo ignora, quindi le
-- due righe generate da drizzle-kit non fanno nulla. Qui è indifferente —
-- `permessi` non ha chiavi esterne, né in entrata né in uscita.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_permessi` (
	`id` integer PRIMARY KEY NOT NULL,
	`funzione` text NOT NULL,
	`nome` text NOT NULL,
	`ruolo` text NOT NULL,
	`livello` text NOT NULL,
	`ordine` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "permessi_ruolo" CHECK("__new_permessi"."ruolo" IN ('sviluppatore','gestore','referente')),
	CONSTRAINT "permessi_livello" CHECK("__new_permessi"."livello" IN ('completo','limitato','nessuno')),
	CONSTRAINT "permessi_ordine" CHECK("__new_permessi"."ordine" >= 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_permessi`("id", "funzione", "nome", "ruolo", "livello", "ordine") SELECT "id", "funzione", "nome", "ruolo", "livello", 0 FROM `permessi`;--> statement-breakpoint
DROP TABLE `permessi`;--> statement-breakpoint
ALTER TABLE `__new_permessi` RENAME TO `permessi`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `permessi_funzione_ruolo` ON `permessi` (`funzione`,`ruolo`);--> statement-breakpoint
CREATE INDEX `permessi_ordine_idx` ON `permessi` (`ordine`,`funzione`);