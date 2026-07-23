ALTER TABLE `server_votes` ADD `source_ip_masked` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `server_votes` ADD `source_ip_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `server_votes` ADD `source_ip_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `server_votes_source_ip_idx` ON `server_votes` (`source_ip_hash`,`created_at`);