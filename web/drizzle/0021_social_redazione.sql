-- Il social media manager fa la redazione del sito (6 ottobre 2026): modifica e
-- cancella le attività di chiunque, con l'approvazione del gestore, e le
-- fotografie le nasconde invece di eliminarle.
--
--   1. `proposte` ricostruita per allargare il CHECK sul tipo ad `attivita`: la
--      modifica di un'attività già pubblicata aspetta lì, e quella online resta
--      com'è finché un gestore non decide. Nessuna tabella punta a
--      `proposte`, quindi ricostruirla non tocca nient'altro.
--   2. `nascosta` su `foto` e `immagini`, `copertina_nascosta` su `unita`: 1 vuol
--      dire che il file resta, ma il sito non lo mostra.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_proposte` (
	`id` integer PRIMARY KEY NOT NULL,
	`tipo` text NOT NULL,
	`chiave` text NOT NULL,
	`valore` text NOT NULL,
	`file` text,
	`autore_id` integer,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "proposte_tipo" CHECK("__new_proposte"."tipo" IN ('pagina','faq','immagine','copertina','attivita')),
	CONSTRAINT "proposte_chiave" CHECK(length("__new_proposte"."chiave") > 0),
	CONSTRAINT "proposte_file_solo_immagini" CHECK("__new_proposte"."file" IS NULL OR "__new_proposte"."tipo" IN ('immagine','copertina'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_proposte`("id", "tipo", "chiave", "valore", "file", "autore_id", "creato_il") SELECT "id", "tipo", "chiave", "valore", "file", "autore_id", "creato_il" FROM `proposte`;--> statement-breakpoint
DROP TABLE `proposte`;--> statement-breakpoint
ALTER TABLE `__new_proposte` RENAME TO `proposte`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `proposte_tipo_chiave` ON `proposte` (`tipo`,`chiave`);--> statement-breakpoint
ALTER TABLE `foto` ADD `nascosta` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `immagini` ADD `nascosta` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `unita` ADD `copertina_nascosta` integer DEFAULT 0 NOT NULL;