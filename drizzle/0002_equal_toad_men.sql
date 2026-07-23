CREATE TABLE `directory_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`title` text NOT NULL,
	`short_description` text NOT NULL,
	`description` text NOT NULL,
	`edition` text NOT NULL,
	`min_version` text NOT NULL,
	`max_version` text NOT NULL,
	`address` text NOT NULL,
	`port` integer DEFAULT 25565 NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`bridge_server_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `directory_servers_owner_idx` ON `directory_servers` (`owner_email`);--> statement-breakpoint
CREATE INDEX `directory_servers_status_idx` ON `directory_servers` (`status`);--> statement-breakpoint
CREATE INDEX `directory_servers_address_idx` ON `directory_servers` (`address`,`port`);