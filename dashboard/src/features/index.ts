import type { ComponentType } from "react";
import type { GuildDetails } from "../api";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { AntiRaidPanel } from "./AntiRaidPanel";
import { EmbedsPanel } from "./EmbedsPanel";
import { EventsPanel } from "./EventsPanel";
import { AutomodPanel } from "./AutomodPanel";
import { ChannelDesignsPanel } from "./ChannelDesignsPanel";
import { JoinLeavePanel } from "./JoinLeavePanel";
import { MessageLogsPanel } from "./MessageLogsPanel";
import { ModerationPanel } from "./ModerationPanel";
import { OnboardingPanel } from "./OnboardingPanel";
import { ReactionRolesPanel } from "./ReactionRolesPanel";

/** Extra dashboard section shown under a feature (keyed by feature ID). */
export const featurePanels: Record<string, ComponentType<{ guild: GuildDetails["guild"] }>> = {
  moderation: ModerationPanel,
  automod: AutomodPanel,
  "anti-raid": AntiRaidPanel,
  "join-leave": JoinLeavePanel,
  onboarding: OnboardingPanel,
  "reaction-roles": ReactionRolesPanel,
  announcements: AnnouncementsPanel,
  embeds: EmbedsPanel,
  events: EventsPanel,
  "channel-designs": ChannelDesignsPanel,
  "message-logs": MessageLogsPanel,
};
