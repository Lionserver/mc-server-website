CREATE TABLE `chat_realtime_tickets` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`server_id` text,
	`role` text NOT NULL,
	`principal_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_realtime_tickets_expiry_idx` ON `chat_realtime_tickets` (`expires_at`);