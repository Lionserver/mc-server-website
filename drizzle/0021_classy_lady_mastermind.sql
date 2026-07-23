CREATE TABLE `vote_source_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_ip_hash` text NOT NULL,
	`source_ip_masked` text NOT NULL,
	`source_ip_version` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vote_source_blocks_lookup_idx` ON `vote_source_blocks` (`source_ip_hash`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `vote_source_blocks_status_idx` ON `vote_source_blocks` (`status`,`expires_at`);