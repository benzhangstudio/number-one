CREATE TABLE `raid_state` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`started_by_id` text,
	`started_by_tag` text,
	`previous_verification` integer,
	`invites_paused` integer DEFAULT false NOT NULL,
	`handled` integer DEFAULT 0 NOT NULL
);
