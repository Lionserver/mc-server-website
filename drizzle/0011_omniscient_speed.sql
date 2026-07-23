CREATE TABLE `server_status_history` (
	`server_id` text NOT NULL,
	`bucket_at` integer NOT NULL,
	`players` integer NOT NULL,
	`max_players` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`online` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`server_id`, `bucket_at`)
);
--> statement-breakpoint
CREATE INDEX `server_status_history_time_idx` ON `server_status_history` (`server_id`,`bucket_at`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `discord_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `website_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `kakao_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `kakao_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `server_staff_profiles` ADD `discord_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `server_staff_profiles` ADD `discord_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `directory_servers` SET `discord_enabled` = CASE WHEN `discord_url` <> '' THEN 1 ELSE 0 END,
  `website_enabled` = CASE WHEN `website_url` <> '' THEN 1 ELSE 0 END;--> statement-breakpoint
INSERT OR IGNORE INTO `server_status_history`
  (`server_id`, `bucket_at`, `players`, `max_players`, `latency_ms`, `online`, `source`)
  SELECT d.`id`, h.`bucket_at`, h.`total_players`, h.`max_players`, h.`average_ping_ms`, h.`online`, 'bridge'
  FROM `bridge_telemetry_history` h JOIN `directory_servers` d ON d.`bridge_server_id` = h.`server_id`;
