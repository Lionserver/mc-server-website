CREATE TABLE `server_ownership_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`claimant_email` text NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'pending_verification' NOT NULL,
	`challenge_hash` text NOT NULL,
	`challenge_expires_at` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`verified_at` integer,
	`reviewed_at` integer,
	`reviewed_by` text,
	`review_note` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ownership_claims_server_idx` ON `server_ownership_claims` (`server_id`,`status`);--> statement-breakpoint
CREATE INDEX `ownership_claims_claimant_idx` ON `server_ownership_claims` (`claimant_email`,`status`);--> statement-breakpoint
CREATE TABLE `server_ownership_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`from_email` text NOT NULL,
	`to_email` text NOT NULL,
	`status` text DEFAULT 'pending_acceptance' NOT NULL,
	`challenge_hash` text,
	`challenge_expires_at` integer,
	`requested_at` integer NOT NULL,
	`accepted_at` integer,
	`verified_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ownership_transfers_server_idx` ON `server_ownership_transfers` (`server_id`,`status`);--> statement-breakpoint
CREATE INDEX `ownership_transfers_target_idx` ON `server_ownership_transfers` (`to_email`,`status`);--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer NOT NULL,
	`last_login_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_accounts_email_idx` ON `user_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `user_login_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_login_codes_email_idx` ON `user_login_codes` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_login_codes_expiry_idx` ON `user_login_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_sessions_account_idx` ON `user_sessions` (`account_id`);--> statement-breakpoint
CREATE INDEX `user_sessions_expiry_idx` ON `user_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `owner_verification_status` text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `owner_verified_at` integer;