import type { ComponentType } from "react";
import type { GuildDetails } from "../api";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { AntiRaidPanel } from "./AntiRaidPanel";
import { EmbedsPanel } from "./EmbedsPanel";
import { EventsPanel } from "./EventsPanel";
import { GuidesPanel } from "./GuidesPanel";
import { AutomodPanel } from "./AutomodPanel";
import { BotUpdatesPanel } from "./BotUpdatesPanel";
import { ChannelDesignsPanel } from "./ChannelDesignsPanel";
import { CustomCommandsPanel } from "./CustomCommandsPanel";
import { JoinLeavePanel } from "./JoinLeavePanel";
import { MemberLogsPanel } from "./MemberLogsPanel";
import { MessageLogsPanel } from "./MessageLogsPanel";
import { ModerationPanel } from "./ModerationPanel";
import { OnboardingPanel } from "./OnboardingPanel";
import { ReactionRolesPanel } from "./ReactionRolesPanel";
import { RuleVerificationPanel } from "./RuleVerificationPanel";
import { ServerLogsPanel } from "./ServerLogsPanel";
import { StaffApplicationsPanel } from "./StaffApplicationsPanel";
import { TicketsPanel } from "./TicketsPanel";
import { VoiceLogsPanel } from "./VoiceLogsPanel";

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
  "member-logs": MemberLogsPanel,
  "server-logs": ServerLogsPanel,
  "voice-logs": VoiceLogsPanel,
  "custom-commands": CustomCommandsPanel,
  "rule-verification": RuleVerificationPanel,
  tickets: TicketsPanel,
  "staff-applications": StaffApplicationsPanel,
  guides: GuidesPanel,
  "bot-updates": BotUpdatesPanel,
};
