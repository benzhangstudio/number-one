CREATE TABLE `card_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`pile` text NOT NULL,
	`name` text NOT NULL,
	`rarity` text NOT NULL,
	`type` text NOT NULL,
	`hp` integer NOT NULL,
	`power` integer NOT NULL,
	`credit` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `card_defs_pile_idx` ON `card_defs` (`pile`);