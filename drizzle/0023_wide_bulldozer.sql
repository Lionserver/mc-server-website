CREATE TABLE `security_rate_limits` (
	`bucket` text NOT NULL,
	`identity_hash` text NOT NULL,
	`window_started` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket`, `identity_hash`)
);
--> statement-breakpoint
CREATE INDEX `security_rate_limits_updated_idx` ON `security_rate_limits` (`updated_at`);