CREATE TABLE `custom_commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`details` text NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_commands_name_idx` ON `custom_commands` (`guild_id`,`name`);