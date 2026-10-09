-- Password provvisoria: chi prepara l'account la imposta con 1, e al primo
-- accesso non si entra finché non la si cambia. Il predefinito 0 lascia com'è
-- chi esiste già. Ottobre 2026, messa in produzione.

ALTER TABLE `utenti` ADD `password_da_cambiare` integer DEFAULT 0 NOT NULL;