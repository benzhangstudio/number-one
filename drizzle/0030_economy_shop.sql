CREATE TABLE `economy_inventory` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `user_id`, `item_id`),
	FOREIGN KEY (`item_id`) REFERENCES `economy_shop_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `economy_inventory_item_idx` ON `economy_inventory` (`item_id`);--> statement-breakpoint
CREATE TABLE `economy_shop_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`emoji` text DEFAULT '' NOT NULL,
	`price` integer NOT NULL,
	`role_id` text,
	`stock` integer,
	`max_per_member` integer,
	`sold` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `economy_shop_guild_idx` ON `economy_shop_items` (`guild_id`,`position`);