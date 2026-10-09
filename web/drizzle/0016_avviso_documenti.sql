-- L'avviso di un documento: il riquadro che la pagina pubblica mostra sotto il
-- file. Nato per i tesseramenti dell'ottobre 2026 — chi è già tesserato al
-- un altro gruppo non compila il modulo, chiede il trasferimento. Il predefinito
-- vuoto lascia senza riquadro i documenti che esistono già.

ALTER TABLE `documenti` ADD `avviso` text DEFAULT '' NOT NULL;
