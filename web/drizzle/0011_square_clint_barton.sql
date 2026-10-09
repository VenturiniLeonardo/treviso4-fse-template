PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attivita` (
	`id` integer PRIMARY KEY NOT NULL,
	`anno_id` integer NOT NULL,
	`unita_id` integer,
	`unita_chiavi` text DEFAULT '' NOT NULL,
	`titolo` text NOT NULL,
	`data_testo` text NOT NULL,
	`data_iso` text,
	`tipo` text NOT NULL,
	`nota` text DEFAULT '' NOT NULL,
	`luogo` text DEFAULT '' NOT NULL,
	`durata` text DEFAULT '' NOT NULL,
	`stato` text DEFAULT 'bozza' NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`anno_id`) REFERENCES `anni_sociali`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "attivita_stato" CHECK("__new_attivita"."stato" IN ('bozza','in_revisione','pubblicato')),
	CONSTRAINT "attivita_tipo" CHECK("__new_attivita"."tipo" IN ('riunione','uscita','uscita-squadra','attivita-squadra','campo','escursione','festa','servizio','distretto')),
	CONSTRAINT "attivita_ambito_uno_solo" CHECK("__new_attivita"."unita_id" IS NULL OR "__new_attivita"."unita_chiavi" = '')
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_attivita`("id", "anno_id", "unita_id", "unita_chiavi", "titolo", "data_testo", "data_iso", "tipo", "nota", "luogo", "durata", "stato", "aggiornato_il", "autore_id") SELECT "id", "anno_id", "unita_id", "unita_chiavi", "titolo", "data_testo", "data_iso", "tipo", "nota", "luogo", "durata", "stato", "aggiornato_il", "autore_id" FROM `attivita`;--> statement-breakpoint
DROP TABLE `attivita`;--> statement-breakpoint
ALTER TABLE `__new_attivita` RENAME TO `attivita`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attivita_anno_data` ON `attivita` (`anno_id`,`data_iso`);