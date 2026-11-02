import type { ComponentType } from "react";
import type { GuildDetails } from "../api";
import { AntiRaidPanel } from "./AntiRaidPanel";
import { AutomodPanel } from "./AutomodPanel";
import { JoinLeavePanel } from "./JoinLeavePanel";
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
};
