CREATE TABLE `dev_update_deliveries` (
	`update_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`delivered_at` integer NOT NULL,
	PRIMARY KEY(`update_id`, `guild_id`),
	FOREIGN KEY (`update_id`) REFERENCES `dev_updates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dev_update_deliveries_guild_idx` ON `dev_update_deliveries` (`guild_id`);--> statement-breakpoint
CREATE TABLE `dev_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`mention` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'sending' NOT NULL
);
