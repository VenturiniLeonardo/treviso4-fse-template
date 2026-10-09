CREATE TABLE `immagini` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`file` text NOT NULL,
	`tipo` text NOT NULL,
	`larghezza` integer NOT NULL,
	`altezza` integer NOT NULL,
	`descrizione` text,
	`caricata_il` text,
	`autore_id` integer,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "immagini_misure" CHECK("immagini"."larghezza" > 0 AND "immagini"."altezza" > 0),
	CONSTRAINT "immagini_chiave" CHECK(length("immagini"."chiave") > 0),
	CONSTRAINT "immagini_file" CHECK(length("immagini"."file") > 0),
	CONSTRAINT "immagini_tipo" CHECK("immagini"."tipo" IN ('image/jpeg','image/png'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `immagini_chiave_unique` ON `immagini` (`chiave`);