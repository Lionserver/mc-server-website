CREATE TABLE `admin_feature_controls` (
	`feature_key` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'enabled' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`expires_at` integer,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_job_statuses` (
	`job_key` text PRIMARY KEY NOT NULL,
	`last_started_at` integer,
	`last_succeeded_at` integer,
	`last_failed_at` integer,
	`last_duration_ms` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`last_result` text DEFAULT '{}' NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_operational_checks` (
	`check_key` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`checked_by` text NOT NULL,
	`checked_at` integer NOT NULL,
	`valid_until` integer
);
--> statement-breakpoint
INSERT OR IGNORE INTO `admin_job_statuses`
  (`job_key`, `last_started_at`, `last_succeeded_at`, `last_failed_at`, `last_duration_ms`,
   `last_error`, `last_result`, `run_count`, `failure_count`, `updated_at`)
VALUES
  ('public_status_snapshots', NULL, NULL, NULL, NULL, '', '{}', 0, 0, CAST(strftime('%s','now') AS INTEGER)),
  ('application_retention_cleanup', NULL, NULL, NULL, NULL, '', '{}', 0, 0, CAST(strftime('%s','now') AS INTEGER)),
  ('server_quarantine_purge', NULL, NULL, NULL, NULL, '', '{}', 0, 0, CAST(strftime('%s','now') AS INTEGER)),
  ('broadcast_cache_cleanup', NULL, NULL, NULL, NULL, '', '{}', 0, 0, CAST(strftime('%s','now') AS INTEGER));--> statement-breakpoint
DROP INDEX `admin_audit_created_idx`;--> statement-breakpoint
CREATE INDEX `admin_audit_actor_idx` ON `admin_audit_logs` (`admin_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_action_idx` ON `admin_audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_target_idx` ON `admin_audit_logs` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit_logs` (`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `elevated_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `source_ip_masked` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD `user_agent_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `admin_sessions` SET `session_id` = lower(hex(randomblob(16))) WHERE `session_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_session_id_idx` ON `admin_sessions` (`session_id`);--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `status_before_deletion` text;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `deletion_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `purge_after` integer;--> statement-breakpoint
ALTER TABLE `directory_servers` ADD `purged_at` integer;--> statement-breakpoint
UPDATE `directory_servers` SET
  `status_before_deletion` = CASE WHEN `status` = 'deleted' THEN 'draft' ELSE `status` END,
  `deletion_reason` = CASE WHEN `deletion_reason` = '' THEN '기존 삭제 기록 마이그레이션' ELSE `deletion_reason` END,
  `deleted_by` = COALESCE(`deleted_by`, 'legacy@minecraft.kr'),
  `purge_after` = `deleted_at` + 604800
WHERE `deleted_at` IS NOT NULL AND `purge_after` IS NULL;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `account_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `suspended_by` text;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD `suspension_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `user_accounts_status_idx` ON `user_accounts` (`account_status`,`updated_at`);
