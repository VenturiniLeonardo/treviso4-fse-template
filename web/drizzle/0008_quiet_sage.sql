CREATE TABLE `faq` (
	`id` integer PRIMARY KEY NOT NULL,
	`domanda` text NOT NULL,
	`risposta` text NOT NULL,
	`fascia` text DEFAULT 'gruppo' NOT NULL,
	`link_testo` text,
	`link_href` text,
	`link_coda` text,
	`ordine` integer DEFAULT 0 NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "faq_fascia" CHECK("faq"."fascia" IN ('gialla','verde','rossa','gruppo')),
	CONSTRAINT "faq_link_completo" CHECK(("faq"."link_testo" IS NULL) + ("faq"."link_href" IS NULL) + ("faq"."link_coda" IS NULL) IN (0, 3)),
	CONSTRAINT "faq_link_interno" CHECK("faq"."link_href" IS NULL OR ("faq"."link_href" GLOB '/*' AND "faq"."link_href" NOT GLOB '//*' AND "faq"."link_href" NOT LIKE '%..%'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `faq_ordine` ON `faq` (`ordine`);