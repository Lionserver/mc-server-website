CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_conversations` (
	`server_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`unread_admin` integer DEFAULT 0 NOT NULL,
	`unread_owner` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_conversations_updated_idx` ON `admin_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `admin_login_attempts` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`sender_role` text NOT NULL,
	`sender_email` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_messages_thread_idx` ON `admin_messages` (`server_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`admin_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_expiry_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `server_blacklist` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_blacklist_lookup_idx` ON `server_blacklist` (`kind`,`value`,`status`);--> statement-breakpoint
CREATE INDEX `server_blacklist_status_idx` ON `server_blacklist` (`status`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `votes_override` integer;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `uptime_basis_points` integer;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `premium_managed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `premium_tier` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `premium_starts_at` integer;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `premium_ends_at` integer;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `premium_note` text DEFAULT '' NOT NULL;