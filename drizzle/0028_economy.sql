CREATE TABLE `economy_balances` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`daily_streak` integer DEFAULT 0 NOT NULL,
	`last_daily_at` integer,
	`last_work_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `economy_balances_rich_idx` ON `economy_balances` (`guild_id`,`balance`);--> statement-breakpoint
CREATE TABLE `economy_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`kind` text NOT NULL,
	`other_user_id` text,
	`by_user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `economy_tx_guild_idx` ON `economy_transactions` (`guild_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `economy_tx_member_idx` ON `economy_transactions` (`guild_id`,`user_id`,`created_at`);