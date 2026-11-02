CREATE TABLE `guide_posts` (
	`guild_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_ids` text NOT NULL,
	PRIMARY KEY(`guild_id`, `kind`)
);
