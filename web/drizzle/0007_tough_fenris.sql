-- Fase 14 — il CMS dei contenuti: le unità diventano modificabili.
--
-- SCRITTA A MANO. drizzle-kit l'aveva generata ricreando `unita` e `documenti`
-- con il procedimento «tabella nuova, copia, scambia», e in due punti non
-- andava:
--
--   1. l'`INSERT … SELECT` elencava le colonne **nuove** leggendole dalla
--      tabella **vecchia** (`SELECT "occhiello", "motto", … FROM unita`), che è
--      un `no such column` garantito, su database vuoto come su database pieno;
--   2. per `unita` faceva `DROP TABLE` dietro `PRAGMA foreign_keys=OFF` —
--      che dentro una transazione è un'istruzione senza effetto (SQLite lo
--      documenta) — e sette tabelle referenziano `unita`.
--
-- Quindi due strade diverse, scelte per quanto ciascuna tabella è esposta:
--
--   `unita`      ALTER TABLE ADD COLUMN, sedici volte. Nessuna riga si sposta,
--                nessuna chiave esterna resta appesa. Verificato che SQLite
--                accetta un CHECK multi-colonna in ADD COLUMN, che lo applica,
--                e che STRICT sopravvive.
--   `documenti`  ricreazione, perché allargare un CHECK esistente non si fa
--                altrimenti. È sicura qui e non lo sarebbe su `unita`:
--                **nessuna tabella referenzia `documenti`**.

-- ==========================================================================
-- unita: le colonne di contenuto
--
-- Tutte nullable, e il nullo significa «usa il predefinito di lib/data.ts».
-- L'ordine non è casuale: le quattro colonne della copertina vengono prima del
-- CHECK che le lega, perché un CHECK non può guardare una colonna che ancora
-- non c'è.
-- ==========================================================================
ALTER TABLE `unita` ADD COLUMN `occhiello` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `motto` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `ritrovo` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `fondazione` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `referente` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `ruolo_referente` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `sigla` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `iscritti` integer CONSTRAINT `unita_iscritti` CHECK(`iscritti` IS NULL OR `iscritti` >= 0);--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `storia_titolo` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `nota_storico` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `copertina` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `copertina_tipo` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `copertina_larghezza` integer;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `copertina_altezza` integer CONSTRAINT `unita_copertina_completa` CHECK((`copertina` IS NULL) + (`copertina_tipo` IS NULL) + (`copertina_larghezza` IS NULL) + (`copertina_altezza` IS NULL) IN (0, 4)) CONSTRAINT `unita_copertina_misure` CHECK((`copertina_larghezza` IS NULL OR `copertina_larghezza` > 0) AND (`copertina_altezza` IS NULL OR `copertina_altezza` > 0));--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `aggiornato_il` text;--> statement-breakpoint
ALTER TABLE `unita` ADD COLUMN `autore_id` integer REFERENCES `utenti`(`id`) ON DELETE set null;--> statement-breakpoint

-- ==========================================================================
-- unita_persone: responsabili, staff e storico
-- ==========================================================================
CREATE TABLE `unita_persone` (
	`id` integer PRIMARY KEY NOT NULL,
	`unita_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`nome` text NOT NULL,
	`ruolo` text DEFAULT '' NOT NULL,
	`periodo` text DEFAULT '' NOT NULL,
	`nota` text DEFAULT '' NOT NULL,
	`ordine` integer DEFAULT 0 NOT NULL,
	`stato` text DEFAULT 'bozza' NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "unita_persone_tipo" CHECK("unita_persone"."tipo" IN ('responsabile','staff','storico')),
	CONSTRAINT "unita_persone_stato" CHECK("unita_persone"."stato" IN ('bozza','in_revisione','pubblicato'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `unita_persone_unita_tipo` ON `unita_persone` (`unita_id`,`tipo`,`ordine`);--> statement-breakpoint

-- ==========================================================================
-- unita_proposte: le modifiche che aspettano l'approvazione
-- ==========================================================================
CREATE TABLE `unita_proposte` (
	`id` integer PRIMARY KEY NOT NULL,
	`unita_id` integer NOT NULL,
	`campo` text NOT NULL,
	`valore` text NOT NULL,
	`autore_id` integer,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `unita_proposte_campo` ON `unita_proposte` (`unita_id`,`campo`);--> statement-breakpoint

-- ==========================================================================
-- documenti: l'ambito d'unità, e «circolari» fra le categorie
--
-- Qui la ricreazione serve: `documenti_categoria` è un CHECK di tabella e
-- allargarlo non si fa con ALTER TABLE. Il procedimento è quello di §7 della
-- documentazione SQLite, con l'`INSERT … SELECT` che elenca le **tredici
-- colonne vecchie** — `unita_id` non c'è ancora, e prende il suo NULL, che è
-- quello che significa «documento di gruppo».
--
-- Niente PRAGMA foreign_keys: nessuna tabella referenzia `documenti`, quindi
-- non c'è nulla da spegnere — e spegnerlo dentro una transazione non farebbe
-- niente comunque.
-- ==========================================================================
CREATE TABLE `__new_documenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`anno_id` integer NOT NULL,
	`unita_id` integer,
	`categoria` text NOT NULL,
	`titolo` text NOT NULL,
	`nota` text DEFAULT '' NOT NULL,
	`formato` text DEFAULT 'PDF' NOT NULL,
	`peso` text DEFAULT '—' NOT NULL,
	`aggiornamento` text DEFAULT '' NOT NULL,
	`stato` text DEFAULT 'bozza' NOT NULL,
	`file` text,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`anno_id`) REFERENCES `anni_sociali`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documenti_categoria" CHECK(`categoria` IN ('iscrizioni','autorizzazioni','campi','quote','statuti','circolari')),
	CONSTRAINT "documenti_formato" CHECK(`formato` IN ('PDF','DOCX')),
	CONSTRAINT "documenti_stato" CHECK(`stato` IN ('bozza','in_revisione','pubblicato')),
	CONSTRAINT "documenti_circolari_hanno_unita" CHECK((`categoria` = 'circolari') = (`unita_id` IS NOT NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_documenti`("id", "chiave", "anno_id", "categoria", "titolo", "nota", "formato", "peso", "aggiornamento", "stato", "file", "aggiornato_il", "autore_id") SELECT "id", "chiave", "anno_id", "categoria", "titolo", "nota", "formato", "peso", "aggiornamento", "stato", "file", "aggiornato_il", "autore_id" FROM `documenti`;--> statement-breakpoint
DROP TABLE `documenti`;--> statement-breakpoint
ALTER TABLE `__new_documenti` RENAME TO `documenti`;--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_chiave_unique` ON `documenti` (`chiave`);--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_file` ON `documenti` (`file`);--> statement-breakpoint
CREATE INDEX `documenti_anno_categoria` ON `documenti` (`anno_id`,`categoria`);--> statement-breakpoint
CREATE INDEX `documenti_unita` ON `documenti` (`unita_id`);
