CREATE TABLE `guides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`details` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `guides_guild_idx` ON `guides` (`guild_id`);--> statement-breakpoint
CREATE INDEX `guides_message_idx` ON `guides` (`message_id`);