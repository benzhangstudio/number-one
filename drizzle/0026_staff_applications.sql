CREATE TABLE `application_panels` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`details` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`number` integer NOT NULL,
	`position_id` text NOT NULL,
	`position_name` text NOT NULL,
	`applicant_id` text NOT NULL,
	`applicant_tag` text NOT NULL,
	`answers` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`channel_id` text,
	`message_id` text,
	`claimed_by_id` text,
	`claimed_by_tag` text,
	`decided_by_id` text,
	`decided_by_tag` text,
	`decision_reason` text,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_applications_number_idx` ON `staff_applications` (`guild_id`,`number`);--> statement-breakpoint
CREATE INDEX `staff_applications_applicant_idx` ON `staff_applications` (`guild_id`,`applicant_id`,`position_id`);--> statement-breakpoint
CREATE INDEX `staff_applications_status_idx` ON `staff_applications` (`guild_id`,`status`);