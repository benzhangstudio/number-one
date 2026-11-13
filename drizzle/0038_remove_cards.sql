DROP TABLE `card_defs`;--> statement-breakpoint
DROP TABLE `card_inventory`;--> statement-breakpoint
DROP TABLE `card_photos`;--> statement-breakpoint
DROP TABLE `card_players`;--> statement-breakpoint
DELETE FROM `feature_settings` WHERE `feature_id` = 'cards';--> statement-breakpoint
DELETE FROM `cooldown_reminders` WHERE `kind` = 'cards';
