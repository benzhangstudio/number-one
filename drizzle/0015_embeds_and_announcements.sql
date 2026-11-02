CREATE TABLE `announcement_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`channel_id` text,
	`message` text NOT NULL,
	`ping` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcement_templates_guild_idx` ON `announcement_templates` (`guild_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`message` text NOT NULL,
	`ping` text NOT NULL,
	`publish` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`scheduled_at` integer,
	`sent_at` integer,
	`error` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_tag` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcements_guild_idx` ON `announcements` (`guild_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `announcements_due_idx` ON `announcements` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `embed_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`embeds` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `embed_messages_guild_idx` ON `embed_messages` (`guild_id`);--> statement-breakpoint
CREATE INDEX `embed_messages_channel_idx` ON `embed_messages` (`channel_id`);