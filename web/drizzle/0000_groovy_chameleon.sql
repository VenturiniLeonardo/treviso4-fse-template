CREATE TABLE `album` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`anno_id` integer NOT NULL,
	`unita_id` integer,
	`titolo` text NOT NULL,
	`data_testo` text NOT NULL,
	`sottotitolo` text DEFAULT '' NOT NULL,
	`tag` text DEFAULT '' NOT NULL,
	`stato` text DEFAULT 'bozza' NOT NULL,
	`escluse` integer DEFAULT 0 NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`anno_id`) REFERENCES `anni_sociali`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "album_stato" CHECK("album"."stato" IN ('bozza','in_revisione','pubblicato')),
	CONSTRAINT "album_escluse_non_negative" CHECK("album"."escluse" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `album_slug_unique` ON `album` (`slug`);--> statement-breakpoint
CREATE INDEX `album_unita_anno` ON `album` (`unita_id`,`anno_id`);--> statement-breakpoint
CREATE INDEX `album_stato_idx` ON `album` (`stato`);--> statement-breakpoint
CREATE TABLE `anni_sociali` (
	`id` integer PRIMARY KEY NOT NULL,
	`etichetta` text NOT NULL,
	`inizio` text NOT NULL,
	`fine` text NOT NULL,
	`corrente` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "anni_corrente_booleano" CHECK("anni_sociali"."corrente" IN (0,1)),
	CONSTRAINT "anni_etichetta_forma" CHECK("anni_sociali"."etichetta" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `anni_sociali_etichetta_unique` ON `anni_sociali` (`etichetta`);--> statement-breakpoint
CREATE UNIQUE INDEX `anni_uno_corrente` ON `anni_sociali` (`corrente`) WHERE "anni_sociali"."corrente" = 1;--> statement-breakpoint
CREATE TABLE `attivita` (
	`id` integer PRIMARY KEY NOT NULL,
	`anno_id` integer NOT NULL,
	`unita_id` integer,
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
	CONSTRAINT "attivita_stato" CHECK("attivita"."stato" IN ('bozza','in_revisione','pubblicato'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `attivita_anno_data` ON `attivita` (`anno_id`,`data_iso`);--> statement-breakpoint
CREATE TABLE `documenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`anno_id` integer NOT NULL,
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
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "documenti_categoria" CHECK("documenti"."categoria" IN ('iscrizioni','autorizzazioni','campi','quote','statuti')),
	CONSTRAINT "documenti_formato" CHECK("documenti"."formato" IN ('PDF','DOCX')),
	CONSTRAINT "documenti_stato" CHECK("documenti"."stato" IN ('bozza','in_revisione','pubblicato'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_chiave_unique` ON `documenti` (`chiave`);--> statement-breakpoint
CREATE UNIQUE INDEX `documenti_file` ON `documenti` (`file`);--> statement-breakpoint
CREATE INDEX `documenti_anno_categoria` ON `documenti` (`anno_id`,`categoria`);--> statement-breakpoint
CREATE TABLE `foto` (
	`id` integer PRIMARY KEY NOT NULL,
	`album_id` integer NOT NULL,
	`file` text NOT NULL,
	`tipo` text NOT NULL,
	`larghezza` integer NOT NULL,
	`altezza` integer NOT NULL,
	`peso` integer,
	`didascalia` text DEFAULT '' NOT NULL,
	`ordine` integer DEFAULT 0 NOT NULL,
	`creata_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `album`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "foto_larghezza" CHECK("foto"."larghezza" > 0),
	CONSTRAINT "foto_altezza" CHECK("foto"."altezza" > 0),
	CONSTRAINT "foto_peso" CHECK("foto"."peso" IS NULL OR "foto"."peso" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `foto_file_unique` ON `foto` (`file`);--> statement-breakpoint
CREATE INDEX `foto_album_ordine` ON `foto` (`album_id`,`ordine`);--> statement-breakpoint
CREATE TABLE `inviti` (
	`id` integer PRIMARY KEY NOT NULL,
	`utente_id` integer NOT NULL,
	`impronta` text NOT NULL,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`scade_il` text NOT NULL,
	`usato_il` text,
	FOREIGN KEY (`utente_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inviti_impronta_unique` ON `inviti` (`impronta`);--> statement-breakpoint
CREATE INDEX `inviti_scade` ON `inviti` (`scade_il`);--> statement-breakpoint
CREATE TABLE `iscrizioni` (
	`id` integer PRIMARY KEY NOT NULL,
	`ragazzo_id` integer NOT NULL,
	`unita_id` integer NOT NULL,
	`anno_id` integer NOT NULL,
	`gruppo_interno` text,
	`quota` text DEFAULT 'da_saldare' NOT NULL,
	`consenso_immagini` integer DEFAULT 0 NOT NULL,
	`consenso_data` text,
	FOREIGN KEY (`ragazzo_id`) REFERENCES `ragazzi`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`anno_id`) REFERENCES `anni_sociali`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "iscrizioni_quota" CHECK("iscrizioni"."quota" IN ('da_saldare','saldata','ridotta')),
	CONSTRAINT "iscrizioni_consenso_booleano" CHECK("iscrizioni"."consenso_immagini" IN (0,1)),
	CONSTRAINT "iscrizioni_consenso_datato" CHECK("iscrizioni"."consenso_immagini" = 0 OR "iscrizioni"."consenso_data" IS NOT NULL)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `iscrizioni_ragazzo_anno` ON `iscrizioni` (`ragazzo_id`,`anno_id`);--> statement-breakpoint
CREATE INDEX `iscrizioni_unita_anno` ON `iscrizioni` (`unita_id`,`anno_id`);--> statement-breakpoint
CREATE TABLE `lavori` (
	`id` integer PRIMARY KEY NOT NULL,
	`tipo` text DEFAULT 'foto' NOT NULL,
	`foto_id` integer,
	`stato` text DEFAULT 'in_attesa' NOT NULL,
	`tentativi` integer DEFAULT 0 NOT NULL,
	`motivo` text,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`iniziato_il` text,
	`finito_il` text,
	FOREIGN KEY (`foto_id`) REFERENCES `foto`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lavori_tipo" CHECK("lavori"."tipo" IN ('foto')),
	CONSTRAINT "lavori_stato" CHECK("lavori"."stato" IN ('in_attesa','in_corso','fatto','errore')),
	CONSTRAINT "lavori_tentativi" CHECK("lavori"."tentativi" BETWEEN 0 AND 3)
) STRICT;
--> statement-breakpoint
CREATE INDEX `lavori_stato_creato` ON `lavori` (`stato`,`creato_il`);--> statement-breakpoint
CREATE TABLE `limiti` (
	`id` integer PRIMARY KEY NOT NULL,
	`ambito` text NOT NULL,
	`chiave` text NOT NULL,
	`finestra_da` text NOT NULL,
	`conteggio` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "limiti_conteggio" CHECK("limiti"."conteggio" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `limiti_ambito_chiave_finestra` ON `limiti` (`ambito`,`chiave`,`finestra_da`);--> statement-breakpoint
CREATE TABLE `messaggi` (
	`id` integer PRIMARY KEY NOT NULL,
	`quando` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`nome` text NOT NULL,
	`email` text NOT NULL,
	`telefono` text DEFAULT '' NOT NULL,
	`motivo` text NOT NULL,
	`messaggio` text NOT NULL,
	`stato` text DEFAULT 'da_leggere' NOT NULL,
	`ip` text,
	CONSTRAINT "messaggi_motivo" CHECK("messaggi"."motivo" IN ('iscrizione','informazioni','quote','referenti','privacy','altro')),
	CONSTRAINT "messaggi_stato" CHECK("messaggi"."stato" IN ('da_leggere','letto','risposto'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `messaggi_quando` ON `messaggi` (`quando`);--> statement-breakpoint
CREATE TABLE `pagine_testi` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`valore` text NOT NULL,
	`stato` text DEFAULT 'pubblicato' NOT NULL,
	`aggiornato_il` text,
	`autore_id` integer,
	FOREIGN KEY (`autore_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pagine_stato" CHECK("pagine_testi"."stato" IN ('bozza','in_revisione','pubblicato'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `pagine_testi_chiave_unique` ON `pagine_testi` (`chiave`);--> statement-breakpoint
CREATE TABLE `permessi` (
	`id` integer PRIMARY KEY NOT NULL,
	`funzione` text NOT NULL,
	`nome` text NOT NULL,
	`ruolo` text NOT NULL,
	`livello` text NOT NULL,
	CONSTRAINT "permessi_ruolo" CHECK("permessi"."ruolo" IN ('sviluppatore','gestore','referente')),
	CONSTRAINT "permessi_livello" CHECK("permessi"."livello" IN ('completo','limitato','nessuno'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `permessi_funzione_ruolo` ON `permessi` (`funzione`,`ruolo`);--> statement-breakpoint
CREATE TABLE `ragazzi` (
	`id` integer PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`cognome` text NOT NULL,
	`nato_il` text,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `ragazzi_cognome_nome` ON `ragazzi` (`cognome`,`nome`);--> statement-breakpoint
CREATE TABLE `registro` (
	`id` integer PRIMARY KEY NOT NULL,
	`quando` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`utente_id` integer,
	`utente` text NOT NULL,
	`nome` text NOT NULL,
	`ruolo` text NOT NULL,
	`tipo` text NOT NULL,
	`operazione` text NOT NULL,
	`origine` text NOT NULL,
	`esito` text DEFAULT 'ok' NOT NULL,
	FOREIGN KEY (`utente_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "registro_tipo" CHECK("registro"."tipo" IN ('accesso','uscita','contenuto','pubblicazione','eliminazione','configurazione','permessi')),
	CONSTRAINT "registro_esito" CHECK("registro"."esito" IN ('ok','rifiutato'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `registro_quando` ON `registro` (`quando`);--> statement-breakpoint
CREATE INDEX `registro_utente_quando` ON `registro` (`utente`,`quando`);--> statement-breakpoint
CREATE TABLE `richieste_gdpr` (
	`id` integer PRIMARY KEY NOT NULL,
	`arrivata_il` text NOT NULL,
	`diritto` text NOT NULL,
	`descrizione` text NOT NULL,
	`stato` text DEFAULT 'ricevuta' NOT NULL,
	`chiusa_il` text,
	`aperta_da` integer,
	FOREIGN KEY (`aperta_da`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "gdpr_diritto" CHECK("richieste_gdpr"."diritto" IN ('accesso','rettifica','cancellazione','limitazione','portabilita','opposizione','rimozione_foto','revoca_consenso')),
	CONSTRAINT "gdpr_stato" CHECK("richieste_gdpr"."stato" IN ('ricevuta','in_corso','eseguita','respinta'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `gdpr_arrivata` ON `richieste_gdpr` (`arrivata_il`);--> statement-breakpoint
CREATE TABLE `sessioni` (
	`id` integer PRIMARY KEY NOT NULL,
	`utente_id` integer NOT NULL,
	`impronta` text NOT NULL,
	`creata_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`ultimo_uso` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`scade_il` text NOT NULL,
	`ip` text,
	FOREIGN KEY (`utente_id`) REFERENCES `utenti`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessioni_impronta_unique` ON `sessioni` (`impronta`);--> statement-breakpoint
CREATE INDEX `sessioni_scade` ON `sessioni` (`scade_il`);--> statement-breakpoint
CREATE TABLE `tentativi_accesso` (
	`id` integer PRIMARY KEY NOT NULL,
	`tipo` text NOT NULL,
	`chiave` text NOT NULL,
	`quando` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	CONSTRAINT "tentativi_tipo" CHECK("tentativi_accesso"."tipo" IN ('email','ip'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `tentativi_tipo_chiave_quando` ON `tentativi_accesso` (`tipo`,`chiave`,`quando`);--> statement-breakpoint
CREATE TABLE `unita` (
	`id` integer PRIMARY KEY NOT NULL,
	`chiave` text NOT NULL,
	`slug` text NOT NULL,
	`nome` text NOT NULL,
	`fascia` text NOT NULL,
	`eta` text,
	`logo` text,
	`email` text,
	`telefono` text,
	`ordine` integer NOT NULL,
	CONSTRAINT "unita_fascia" CHECK("unita"."fascia" IN ('gialla','verde','rossa'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `unita_chiave_unique` ON `unita` (`chiave`);--> statement-breakpoint
CREATE UNIQUE INDEX `unita_slug_unique` ON `unita` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `unita_ordine_unique` ON `unita` (`ordine`);--> statement-breakpoint
CREATE TABLE `utenti` (
	`id` integer PRIMARY KEY NOT NULL,
	`utente` text NOT NULL,
	`email` text,
	`nome` text NOT NULL,
	`iniziali` text NOT NULL,
	`ruolo` text NOT NULL,
	`unita_id` integer,
	`password_hash` text,
	`totp_secret` text,
	`stato` text DEFAULT 'invitato' NOT NULL,
	`creato_il` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`ultimo_accesso` text,
	FOREIGN KEY (`unita_id`) REFERENCES `unita`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "utenti_ruolo" CHECK("utenti"."ruolo" IN ('sviluppatore','gestore','referente')),
	CONSTRAINT "utenti_stato" CHECK("utenti"."stato" IN ('invitato','attivo','revocato')),
	CONSTRAINT "utenti_unita_solo_referente" CHECK(("utenti"."ruolo" = 'referente') = ("utenti"."unita_id" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `utenti_utente` ON `utenti` (lower("utente"));--> statement-breakpoint
CREATE UNIQUE INDEX `utenti_email` ON `utenti` (lower("email"));