CREATE TABLE `premium_auctions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_starts_at` integer NOT NULL,
	`target_ends_at` integer NOT NULL,
	`bidding_opens_at` integer NOT NULL,
	`bidding_closes_at` integer NOT NULL,
	`slot_count` integer DEFAULT 4 NOT NULL,
	`minimum_bid` integer DEFAULT 10000 NOT NULL,
	`minimum_increment` integer DEFAULT 1000 NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finalized_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premium_auctions_target_idx` ON `premium_auctions` (`target_starts_at`);--> statement-breakpoint
CREATE INDEX `premium_auctions_status_idx` ON `premium_auctions` (`status`);--> statement-breakpoint
CREATE TABLE `premium_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`auction_id` text NOT NULL,
	`bid_id` text NOT NULL,
	`server_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'payment_pending' NOT NULL,
	`payment_confirmed_at` integer,
	`confirmed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `premium_awards_auction_idx` ON `premium_awards` (`auction_id`,`status`);--> statement-breakpoint
CREATE INDEX `premium_awards_server_idx` ON `premium_awards` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `premium_awards_bid_idx` ON `premium_awards` (`bid_id`);--> statement-breakpoint
CREATE TABLE `premium_bids` (
	`id` text PRIMARY KEY NOT NULL,
	`auction_id` text NOT NULL,
	`server_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`verified_at` integer NOT NULL,
	`placed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `premium_bids_ranking_idx` ON `premium_bids` (`auction_id`,`status`,`amount`,`updated_at`);--> statement-breakpoint
CREATE INDEX `premium_bids_server_idx` ON `premium_bids` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `premium_bids_auction_server_idx` ON `premium_bids` (`auction_id`,`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `premium_bids_auction_owner_idx` ON `premium_bids` (`auction_id`,`owner_email`);