CREATE TABLE `card_inventory` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`first_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `card_id`)
);
--> statement-breakpoint
CREATE INDEX `card_inventory_guild_idx` ON `card_inventory` (`guild_id`);--> statement-breakpoint
CREATE TABLE `card_photos` (
	`key` text PRIMARY KEY NOT NULL,
	`credit` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `card_players` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team` text NOT NULL,
	`last_daily_at` integer,
	`wins_day` text,
	`wins_today` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
