ALTER TABLE `bridge_servers` ADD `last_ping_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `bridge_servers` ADD `last_ping_success_at` integer;--> statement-breakpoint
ALTER TABLE `bridge_servers` ADD `ping_players` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bridge_servers` ADD `ping_max_players` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bridge_servers` ADD `ping_latency_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bridge_servers` ADD `ping_version` text DEFAULT 'unknown' NOT NULL;