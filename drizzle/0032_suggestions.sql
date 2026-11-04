CREATE TABLE `suggestion_counters` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`last` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestion_votes` (
	`suggestion_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`vote` integer NOT NULL,
	PRIMARY KEY(`suggestion_id`, `user_id`),
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suggestion_votes_guild_idx` ON `suggestion_votes` (`guild_id`);--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`number` integer NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`thread_id` text,
	`author_id` text NOT NULL,
	`author_tag` text NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`reviewed_by_tag` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_number_idx` ON `suggestions` (`guild_id`,`number`);--> statement-breakpoint
CREATE INDEX `suggestions_author_idx` ON `suggestions` (`guild_id`,`author_id`,`created_at`);