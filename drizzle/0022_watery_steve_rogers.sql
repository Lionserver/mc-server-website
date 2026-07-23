CREATE TABLE `site_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text NOT NULL,
	`publication_status` text DEFAULT 'draft' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	CONSTRAINT "site_announcements_status_check" CHECK("site_announcements"."publication_status" in ('draft', 'published', 'archived')),
	CONSTRAINT "site_announcements_period_check" CHECK("site_announcements"."ends_at" > "site_announcements"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `site_announcements_window_idx` ON `site_announcements` (`publication_status`,`deleted_at`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `site_announcements_admin_idx` ON `site_announcements` (`deleted_at`,`updated_at`,`id`);