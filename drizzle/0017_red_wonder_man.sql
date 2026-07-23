CREATE TABLE `server_enforcements` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer,
	`created_by` text NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`resolution_note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_enforcements_server_idx` ON `server_enforcements` (`server_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `server_enforcements_active_idx` ON `server_enforcements` (`status`,`kind`,`expires_at`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `status_before_enforcement` text;