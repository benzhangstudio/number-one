CREATE TABLE `ticket_counters` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`last` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ticket_panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`details` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ticket_panels_guild_idx` ON `ticket_panels` (`guild_id`);--> statement-breakpoint
CREATE INDEX `ticket_panels_message_idx` ON `ticket_panels` (`message_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`number` integer NOT NULL,
	`channel_id` text NOT NULL,
	`panel_id` integer,
	`type` text NOT NULL,
	`staff_role_ids` text DEFAULT '[]' NOT NULL,
	`opener_id` text NOT NULL,
	`opener_tag` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'open' NOT NULL,
	`claimed_by_id` text,
	`claimed_by_tag` text,
	`closed_by_tag` text,
	`close_reason` text,
	`created_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_number_idx` ON `tickets` (`guild_id`,`number`);--> statement-breakpoint
CREATE INDEX `tickets_channel_idx` ON `tickets` (`channel_id`);--> statement-breakpoint
CREATE INDEX `tickets_status_idx` ON `tickets` (`guild_id`,`status`,`opener_id`);