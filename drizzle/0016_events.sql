CREATE TABLE `event_rsvps` (
	`event_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`choice` text NOT NULL,
	`answered_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_rsvps_guild_idx` ON `event_rsvps` (`guild_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`details` text NOT NULL,
	`start_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`remind_at` integer,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`discord_event_id` text,
	`created_by` text NOT NULL,
	`created_by_tag` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_guild_idx` ON `events` (`guild_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `events_remind_idx` ON `events` (`remind_at`);--> statement-breakpoint
CREATE INDEX `events_status_idx` ON `events` (`status`,`ends_at`);