CREATE TABLE `site_daily_visitor_totals` (
	`visit_day` text PRIMARY KEY NOT NULL,
	`visitor_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `site_daily_visitors_increment_total`
AFTER INSERT ON `site_daily_visitors`
BEGIN
	INSERT INTO `site_daily_visitor_totals` (`visit_day`, `visitor_count`, `updated_at`)
	VALUES (NEW.`visit_day`, 1, NEW.`first_seen_at`)
	ON CONFLICT(`visit_day`) DO UPDATE SET
		`visitor_count` = `visitor_count` + 1,
		`updated_at` = MAX(`updated_at`, NEW.`first_seen_at`);
END;
--> statement-breakpoint
INSERT INTO `site_daily_visitor_totals` (`visit_day`, `visitor_count`, `updated_at`)
SELECT `visit_day`, COUNT(*), MAX(`first_seen_at`)
FROM `site_daily_visitors`
GROUP BY `visit_day`
ON CONFLICT(`visit_day`) DO UPDATE SET
	`visitor_count` = excluded.`visitor_count`,
	`updated_at` = excluded.`updated_at`;
