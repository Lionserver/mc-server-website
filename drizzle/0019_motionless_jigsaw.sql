CREATE TABLE `minecraft_profiles` (
	`nickname_key` text PRIMARY KEY NOT NULL,
	`canonical_name` text NOT NULL,
	`minecraft_uuid` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `minecraft_profiles_uuid_idx` ON `minecraft_profiles` (`minecraft_uuid`);--> statement-breakpoint
CREATE INDEX `minecraft_profiles_expiry_idx` ON `minecraft_profiles` (`expires_at`);--> statement-breakpoint
ALTER TABLE `server_staff_profiles` ADD `minecraft_uuid` text;--> statement-breakpoint
ALTER TABLE `server_votes` ADD `minecraft_uuid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `server_votes_uuid_daily_idx` ON `server_votes` (`server_id`,`minecraft_uuid`,`vote_day`) WHERE "server_votes"."minecraft_uuid" is not null;