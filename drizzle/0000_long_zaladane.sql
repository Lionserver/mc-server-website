CREATE TABLE `bridge_backends` (
	`server_id` text NOT NULL,
	`backend_id` text NOT NULL,
	`players` integer NOT NULL,
	`max_players` integer NOT NULL,
	`online` integer NOT NULL,
	`software` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `backend_id`)
);
--> statement-breakpoint
CREATE TABLE `bridge_nonces` (
	`server_id` text NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `nonce`)
);
--> statement-breakpoint
CREATE TABLE `bridge_servers` (
	`server_id` text PRIMARY KEY NOT NULL,
	`platform` text DEFAULT 'unknown' NOT NULL,
	`public_host` text NOT NULL,
	`public_port` integer NOT NULL,
	`challenge_hash` text NOT NULL,
	`challenge_expires_at` integer NOT NULL,
	`verified_at` integer,
	`last_seen_at` integer,
	`total_players` integer DEFAULT 0 NOT NULL,
	`max_players` integer DEFAULT 0 NOT NULL,
	`backend_count` integer DEFAULT 0 NOT NULL,
	`average_ping_ms` integer DEFAULT 0 NOT NULL,
	`software` text DEFAULT 'unknown' NOT NULL,
	`version` text DEFAULT 'unknown' NOT NULL,
	`plugin_version` text DEFAULT 'unknown' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
