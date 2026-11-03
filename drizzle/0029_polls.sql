CREATE TABLE `poll_votes` (
	`poll_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`answer` integer NOT NULL,
	`voted_at` integer NOT NULL,
	PRIMARY KEY(`poll_id`, `user_id`, `answer`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `poll_votes_guild_idx` ON `poll_votes` (`guild_id`);--> statement-breakpoint
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`details` text NOT NULL,
	`ends_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_tag` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `polls_guild_idx` ON `polls` (`guild_id`,`status`);--> statement-breakpoint
CREATE INDEX `polls_ends_idx` ON `polls` (`status`,`ends_at`);