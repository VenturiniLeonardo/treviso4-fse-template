CREATE TABLE `cartelle_referenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`titolo` text NOT NULL,
	`descrizione` text DEFAULT '' NOT NULL,
	`ordine` integer NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "cartelle_referenti_titolo" CHECK(length(trim("cartelle_referenti"."titolo")) > 0),
	CONSTRAINT "cartelle_referenti_ordine" CHECK("cartelle_referenti"."ordine" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `cartelle_referenti_titolo_unico` ON `cartelle_referenti` (lower("titolo"));--> statement-breakpoint
CREATE TABLE `documenti_referenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`cartella_id` integer NOT NULL,
	`titolo` text NOT NULL,
	`nota` text DEFAULT '' NOT NULL,
	`formato` text NOT NULL,
	`byte` integer NOT NULL,
	`file` text NOT NULL,
	`caricato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`cartella_id`) REFERENCES `cartelle_referenti`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documenti_referenti_titolo" CHECK(length(trim("documenti_referenti"."titolo")) > 0),
	CONSTRAINT "documenti_referenti_formato" CHECK("documenti_referenti"."formato" IN ('PDF','DOCX','XLSX','PPTX','ODT','ODS','ODP','DOC','XLS','PPT')),
	CONSTRAINT "documenti_referenti_byte" CHECK("documenti_referenti"."byte" > 0),
	CONSTRAINT "documenti_referenti_file" CHECK("documenti_referenti"."file" GLOB 'referenti-*')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_referenti_file_unique` ON `documenti_referenti` (`file`);--> statement-breakpoint
CREATE INDEX `documenti_referenti_cartella` ON `documenti_referenti` (`cartella_id`);