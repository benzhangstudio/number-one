CREATE TABLE `channel_designs` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`base_name` text NOT NULL,
	`applied_name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `channel_designs_guild_idx` ON `channel_designs` (`guild_id`);