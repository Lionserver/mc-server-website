CREATE TABLE `operator_channel_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`server_title` text NOT NULL,
	`owner_email` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_channel_created_idx` ON `operator_channel_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `operator_channel_server_idx` ON `operator_channel_messages` (`server_id`,`created_at`);