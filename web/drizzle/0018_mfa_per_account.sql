-- Secondo fattore per account: 1 (il predefinito, e per chi esiste già) vuol dire
-- che all'accesso serve anche il codice; 0 che a quell'account basta la password.
-- Lo cambia solo uno sviluppatore, dalla schermata degli utenti. Ottobre 2026.

ALTER TABLE `utenti` ADD `mfa_richiesto` integer DEFAULT 1 NOT NULL;
