CREATE TABLE `site_daily_visitors` (
	`visit_day` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`visit_day`, `visitor_hash`)
);
--> statement-breakpoint
CREATE INDEX `site_daily_visitors_seen_idx` ON `site_daily_visitors` (`first_seen_at`);