-- SCRITTA A MANO, partendo da quella di drizzle-kit. I tre punti che le
-- correzioni dell'audit degli accessi del 4 ottobre 2026 avevano lasciato fuori
-- (docs/implementation/accessi-ruoli.md, §5), fatti il 7 ottobre 2026:
--
--   1. `proposte` ricostruita per allargare il CHECK sul tipo ad `album`: il
--      social media manager chiede di ritirare un album pubblicato, e la
--      richiesta aspetta lì come quelle sulle attività (M-1b). Nessuna tabella
--      punta a `proposte`, quindi ricostruirla non tocca nient'altro.
--   2. `eliminata_il` ed `eliminata_da` su `foto`: la cancellazione logica (A-1).
--      La fotografia eliminata resta trenta giorni nel cestino dell'album, poi
--      la porta via il lavoro notturno.
--   3. cinque colonne su `iscrizioni` per la verifica a campione dei consensi
--      (I-1): dove sta il modulo di carta, chi ha registrato il consenso, e
--      l'esito del controllo con chi e quando. Nessuna scansione.
--   4. la riga `consensi-verifica` della matrice, solo se la matrice è già
--      seminata: sviluppatore e gestore sì, gli altri no. Come in 0014,
--      `npm run db:permessi` la aggiungerebbe comunque dal seme.
--
-- drizzle-kit aveva scritto le chiavi esterne senza `ON DELETE SET NULL`, che è
-- quello che lo schema dichiara: aggiunto qui, come in 0014.

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
	CONSTRAINT "proposte_tipo" CHECK("__new_proposte"."tipo" IN ('pagina','faq','immagine','copertina','attivita','album')),
	CONSTRAINT "proposte_chiave" CHECK(length("__new_proposte"."chiave") > 0),
	CONSTRAINT "proposte_file_solo_immagini" CHECK("__new_proposte"."file" IS NULL OR "__new_proposte"."tipo" IN ('immagine','copertina'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_proposte`("id", "tipo", "chiave", "valore", "file", "autore_id", "creato_il") SELECT "id", "tipo", "chiave", "valore", "file", "autore_id", "creato_il" FROM `proposte`;--> statement-breakpoint
DROP TABLE `proposte`;--> statement-breakpoint
ALTER TABLE `__new_proposte` RENAME TO `proposte`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `proposte_tipo_chiave` ON `proposte` (`tipo`,`chiave`);--> statement-breakpoint
ALTER TABLE `foto` ADD `eliminata_il` text;--> statement-breakpoint
ALTER TABLE `foto` ADD `eliminata_da` integer REFERENCES utenti(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `iscrizioni` ADD `consenso_modulo` text;--> statement-breakpoint
ALTER TABLE `iscrizioni` ADD `consenso_da` integer REFERENCES utenti(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `iscrizioni` ADD `consenso_verifica` text;--> statement-breakpoint
ALTER TABLE `iscrizioni` ADD `consenso_verificato_il` text;--> statement-breakpoint
ALTER TABLE `iscrizioni` ADD `consenso_verificato_da` integer REFERENCES utenti(id) ON DELETE SET NULL;--> statement-breakpoint
INSERT INTO `permessi` (`funzione`, `nome`, `ruolo`, `livello`, `ordine`)
	SELECT 'consensi-verifica', 'Verificare a campione i consensi', `ruolo`,
		CASE WHEN `ruolo` IN ('sviluppatore', 'gestore') THEN 'completo' ELSE 'nessuno' END,
		(SELECT max(`ordine`) + 1 FROM `permessi`)
	FROM `permessi` WHERE `funzione` = 'utenti'
		AND NOT EXISTS (SELECT 1 FROM `permessi` WHERE `funzione` = 'consensi-verifica');
