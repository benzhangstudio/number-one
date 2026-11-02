import type { BotFeature } from "../server/bot/types.js";
import { announcementsBot } from "./announcements/index.js";
import { antiRaid } from "./anti-raid/index.js";
import { automod } from "./automod/index.js";
import { channelDesignsBot } from "./channel-designs/index.js";
import { core } from "./core/index.js";
import { embeds } from "./embeds/index.js";
import { eventsBot } from "./events/index.js";
import { joinLeave } from "./join-leave/index.js";
import { memberLogs } from "./member-logs/index.js";
import { messageLogs } from "./message-logs/index.js";
import { moderation } from "./moderation/index.js";
import { onboarding } from "./onboarding/index.js";
import { reactionRoles } from "./reaction-roles/index.js";
import { serverLogs } from "./server-logs/index.js";
import { voiceLogs } from "./voice-logs/index.js";

/** Every feature the bot runs. Each one also needs an entry in src/shared/features.ts. */
export const features: BotFeature[] = [core, moderation, automod, antiRaid, joinLeave, onboarding, reactionRoles, announcementsBot, embeds, eventsBot, channelDesignsBot, messageLogs, memberLogs, serverLogs, voiceLogs];
