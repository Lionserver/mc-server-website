CREATE INDEX `bridge_backends_server_idx` ON `bridge_backends` (`server_id`);--> statement-breakpoint
CREATE INDEX `bridge_nonces_expiry_idx` ON `bridge_nonces` (`expires_at`);