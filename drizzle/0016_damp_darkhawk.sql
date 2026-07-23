CREATE TABLE `premium_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`origin_key` text NOT NULL,
	`auction_id` text,
	`award_id` text,
	`server_id` text NOT NULL,
	`server_title` text NOT NULL,
	`owner_email` text NOT NULL,
	`source` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premium_placements_origin_idx` ON `premium_placements` (`origin_key`);--> statement-breakpoint
CREATE INDEX `premium_placements_period_idx` ON `premium_placements` (`status`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `premium_placements_server_idx` ON `premium_placements` (`server_id`,`starts_at`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `votes_adjustment` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `uptime_adjustment_basis_points` integer DEFAULT 0 NOT NULL;