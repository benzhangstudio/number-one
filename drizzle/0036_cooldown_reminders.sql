CREATE TABLE `cooldown_reminders` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`always` integer DEFAULT false NOT NULL,
	`channel_id` text,
	`due_at` integer,
	PRIMARY KEY(`guild_id`, `user_id`, `kind`)
);
--> statement-breakpoint
CREATE INDEX `cooldown_reminders_due` ON `cooldown_reminders` (`due_at`);