CREATE TABLE `sticky_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`details` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_by_tag` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sticky_messages_channel_idx` ON `sticky_messages` (`channel_id`);--> statement-breakpoint
CREATE INDEX `sticky_messages_guild_idx` ON `sticky_messages` (`guild_id`);