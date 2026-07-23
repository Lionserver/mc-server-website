CREATE TABLE `bridge_telemetry_history` (
	`server_id` text NOT NULL,
	`bucket_at` integer NOT NULL,
	`total_players` integer NOT NULL,
	`max_players` integer NOT NULL,
	`average_ping_ms` integer NOT NULL,
	`online` integer NOT NULL,
	PRIMARY KEY(`server_id`, `bucket_at`)
);
--> statement-breakpoint
CREATE INDEX `bridge_history_server_time_idx` ON `bridge_telemetry_history` (`server_id`,`bucket_at`);--> statement-breakpoint
CREATE TABLE `server_staff_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`role` text NOT NULL,
	`nickname` text NOT NULL,
	`introduction` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_staff_order_idx` ON `server_staff_profiles` (`server_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `server_staff_server_idx` ON `server_staff_profiles` (`server_id`);--> statement-breakpoint
CREATE TABLE `server_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`nickname` text NOT NULL,
	`vote_day` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`reward_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_votes_daily_idx` ON `server_votes` (`server_id`,`nickname`,`vote_day`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_votes_daily_nocase_idx` ON `server_votes` (`server_id`,lower(`nickname`),`vote_day`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_votes_source_daily_idx` ON `server_votes` (`server_id`,`source_fingerprint`,`vote_day`);--> statement-breakpoint
CREATE INDEX `server_votes_recent_idx` ON `server_votes` (`server_id`,`created_at`);--> statement-breakpoint
DROP INDEX `directory_servers_address_idx`;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `discord_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `website_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `staff_intro_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `resolved_ips` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `status_before_blacklist` text;--> statement-breakpoint
CREATE UNIQUE INDEX `directory_servers_address_idx` ON `directory_servers` (`address`,`port`) WHERE "directory_servers"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE `premium_awards` ADD `payment_reference` text;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `identity_verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `identity_verified_at` integer;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `identity_provider` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `identity_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_login_codes` ADD `request_ip_hash` text DEFAULT '' NOT NULL;
