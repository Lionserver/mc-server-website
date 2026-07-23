CREATE TABLE `server_description_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_description_assets_server_idx` ON `server_description_assets` (`server_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `description_document` text DEFAULT '' NOT NULL;