-- Welcome and goodbye messages moved out of Member onboarding into their own feature ("join-leave").
-- Copy each server's existing welcome/goodbye settings across, with the same on/off state onboarding had.
-- json_patch drops missing (null) parts, so the new feature fills them in from its defaults.
INSERT INTO `feature_settings` (`guild_id`, `feature_id`, `enabled`, `settings`, `updated_at`, `updated_by`)
SELECT `guild_id`, 'join-leave', `enabled`,
  json_patch('{}', json_object('welcome', json(`settings` -> '$.welcome'), 'goodbye', json(`settings` -> '$.goodbye'))),
  `updated_at`, `updated_by`
FROM `feature_settings`
WHERE `feature_id` = 'onboarding'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE `onboarding_progress` DROP COLUMN `welcomed`;
