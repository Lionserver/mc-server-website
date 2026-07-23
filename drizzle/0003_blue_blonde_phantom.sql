CREATE TABLE `server_assets` (
	`server_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `kind`)
);
--> statement-breakpoint
CREATE INDEX `server_assets_server_idx` ON `server_assets` (`server_id`);