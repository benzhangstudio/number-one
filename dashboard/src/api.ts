import type {
  CategoryId,
  DashboardGuild,
  DashboardUser,
  FeatureState,
  ReactionRoleInput,
  ReactionRoleMessageView,
  SetupState,
} from "../../src/shared/features";
import type { AnnouncementInput, AnnouncementMessage, AnnouncementView, AnnouncementsResponse, TemplateInput, TemplateView } from "../../src/shared/announcements";
import type { AntiRaidResponse, AntiRaidSettings } from "../../src/shared/antiRaid";
import type { ChannelDesignSettings, ChannelDesignsResponse, CleanupSettings } from "../../src/shared/channelDesigns";
import type { CustomCommandInput, CustomCommandsResponse, RulesSettings } from "../../src/shared/customCommands";
import type { EmbedMessageInput, EmbedMessageView } from "../../src/shared/embeds";
import type { EventInput, EventView, EventsResponse, RsvpView } from "../../src/shared/events";
import type { PollInput, PollSettings, PollView, PollVoterView, PollsResponse } from "../../src/shared/polls";
import type { SuggestionSettings, SuggestionStatusInput, SuggestionsResponse } from "../../src/shared/suggestions";
import type { ForumAutomation, ForumInput, ForumsResponse, PostAction } from "../../src/shared/forums";
import type { MemberLogResponse, MemberLogSettings } from "../../src/shared/memberLogs";
import type { MessageLogResponse, MessageLogSettings } from "../../src/shared/messageLogs";
import type { RuleVerificationResponse, RuleVerificationSettings } from "../../src/shared/ruleVerification";
import type { GuideKind, GuideSettings, GuidesResponse } from "../../src/shared/guides";
import type { TicketPanelInput, TicketSettings, TicketsResponse } from "../../src/shared/tickets";
import type { ServerLogResponse, ServerLogSettings } from "../../src/shared/serverLogs";
import type { VoiceLogResponse, VoiceLogSettings } from "../../src/shared/voiceLogs";
import type { AppPanelInput, ApplicationDecisionInput, StaffApplicationSettings, StaffApplicationsResponse } from "../../src/shared/staffApplications";
import type {
  BotUpdateFailure,
  BotUpdateInput,
  BotUpdateSettings,
  BotUpdateSummary,
  BotUpdateTemplateInput,
  BotUpdatesPanelData,
  DeveloperOverview,
  MaintenanceInput,
  MaintenanceState,
} from "../../src/shared/botUpdates";
import type { AutomodResponse, AutomodSettings } from "../../src/shared/automod";
import type { CaseListResponse, CaseView, ModerationResponse, ModerationSettings } from "../../src/shared/moderation";
import type { JoinLeaveResponse, JoinLeaveSettings } from "../../src/shared/joinLeave";
import type { LevelsResponse, LevelsSettings } from "../../src/shared/levels";
import type { EconomyResponse, EconomySettings, ShopItemInput } from "../../src/shared/economy";
import type { CommunityToolsResponse, DiscordOnboardingInput, EnableCommunityInput, WelcomeScreenInput } from "../../src/shared/communityTools";
import type { OnboardingSettings, OnboardingStatus } from "../../src/shared/onboarding";
import { offerUndo } from "./undo";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * A settings save that can be undone: reads the settings first, saves the new ones, then shows the timed
 * Undo button. Undo saves the earlier settings back (without offering another undo).
 * `pick` gets the settings out of the read; `put` saves a given set of settings.
 */
async function undoable<R, S>(read: () => Promise<R>, pick: (r: R) => S, put: (s: S) => Promise<R>, next: S): Promise<R> {
  const before = await read().then(pick, () => null);
  const result = await put(next);
  if (before !== null && JSON.stringify(before) !== JSON.stringify(pick(result))) {
    offerUndo(() => put(before));
  }
  return result;
}

/** The usual shape: GET and PUT on the same address, with the settings under `settings`. */
function undoableSettings<R extends { settings: S }, S>(url: string, next: S) {
  return undoable<R, S>(
    () => request<R>(url),
    (r) => r.settings,
    (s) => request<R>(url, { method: "PUT", body: JSON.stringify(s) }),
    next,
  );
}

export interface GuildDetails {
  guild: {
    id: string;
    name: string;
    icon: string | null;
    memberCount: number;
    channels: { id: string; name: string; type: number; parentId: string | null }[];
    roles: { id: string; name: string; color: string; assignable: boolean }[];
    emojis: { id: string; name: string; animated: boolean; text: string }[];
  };
  features: FeatureState[];
  setup: SetupState;
  /** Only the server owner can delete the server's data. */
  isOwner: boolean;
}

export interface OnboardingResponse {
  settings: OnboardingSettings;
  status: OnboardingStatus;
  /** What "Set it up for me" will do, in plain words. */
  setupPlan: string[];
  /** Only the server owner can set up, change or turn off the access gate. */
  canManageAccess: boolean;
  warnings: string[];
}

/** A saved event, plus a warning when adding it to Discord's Events tab didn't work. */
export type EventResult = { event: EventView; warning: string | null };

export type ReactionRoleSaveResult = { message: ReactionRoleMessageView; warnings: string[] };

export const api = {
  config: () => request<{ clientId: string | null; loginReady: boolean; botReady: boolean; maintenance?: MaintenanceState }>("/api/config"),
  me: () => request<DashboardUser>("/api/me"),
  guilds: () => request<DashboardGuild[]>("/api/guilds"),
  guild: (id: string) => request<GuildDetails>(`/api/guilds/${id}`),
  saveFeature: async (guildId: string, featureId: string, state: Omit<FeatureState, "id">) => {
    const put = (s: Omit<FeatureState, "id">) =>
      request<FeatureState>(`/api/guilds/${guildId}/features/${featureId}`, { method: "PUT", body: JSON.stringify(s) });
    const result = await put(state);
    offerUndo(() => put({ enabled: !state.enabled, settings: state.settings }));
    return result;
  },
  reactionRoles: (guildId: string) => request<ReactionRoleMessageView[]>(`/api/guilds/${guildId}/reaction-roles`),
  createReactionRole: (guildId: string, input: ReactionRoleInput) =>
    request<ReactionRoleSaveResult>(`/api/guilds/${guildId}/reaction-roles`, { method: "POST", body: JSON.stringify(input) }),
  updateReactionRole: (guildId: string, messageId: string, input: ReactionRoleInput) =>
    request<ReactionRoleSaveResult>(`/api/guilds/${guildId}/reaction-roles/${messageId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  saveSetup: async (guildId: string, categories: CategoryId[]) => {
    type SetupResult = { turnedOn: string[]; setup: SetupState; features: FeatureState[] };
    const put = (c: CategoryId[]) => request<SetupResult>(`/api/guilds/${guildId}/setup`, { method: "PUT", body: JSON.stringify({ categories: c }) });
    const before = await request<GuildDetails>(`/api/guilds/${guildId}`).then((g) => g.setup.categories, () => null);
    const result = await put(categories);
    if (before) {
      // Undo puts the old choices back and switches off whatever this save switched on.
      offerUndo(async () => {
        await put(before);
        for (const id of result.turnedOn) {
          const f = result.features.find((x) => x.id === id);
          if (f) await request(`/api/guilds/${guildId}/features/${id}`, { method: "PUT", body: JSON.stringify({ enabled: false, settings: f.settings }) });
        }
      });
    }
    return result;
  },
  deleteReactionRole: (guildId: string, messageId: string) =>
    request<{ ok: true }>(`/api/guilds/${guildId}/reaction-roles/${messageId}`, { method: "DELETE" }),
  onboarding: (guildId: string) => request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding`),
  saveOnboarding: (guildId: string, settings: OnboardingSettings) =>
    undoableSettings<OnboardingResponse, OnboardingSettings>(`/api/guilds/${guildId}/onboarding`, settings),
  setUpGate: (guildId: string) =>
    request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding/gate/setup`, { method: "POST", body: "{}" }),
  removeGate: (guildId: string) =>
    request<OnboardingResponse>(`/api/guilds/${guildId}/onboarding/gate/remove`, { method: "POST", body: "{}" }),
  deleteGuildData: (guildId: string) => request<{ ok: true }>(`/api/guilds/${guildId}/data`, { method: "DELETE" }),
  moderation: (guildId: string) => request<ModerationResponse>(`/api/guilds/${guildId}/moderation`),
  saveModeration: (guildId: string, settings: ModerationSettings) =>
    undoableSettings<ModerationResponse, ModerationSettings>(`/api/guilds/${guildId}/moderation`, settings),
  cases: (guildId: string, filters: { q?: string; action?: string; before?: number | null }) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.action) params.set("action", filters.action);
    if (filters.before) params.set("before", String(filters.before));
    return request<CaseListResponse>(`/api/guilds/${guildId}/moderation/cases?${params}`);
  },
  editCase: (guildId: string, caseNumber: number, reason: string) =>
    request<CaseView>(`/api/guilds/${guildId}/moderation/cases/${caseNumber}`, { method: "PATCH", body: JSON.stringify({ reason }) }),
  deleteCase: (guildId: string, caseNumber: number) =>
    request<{ ok: true }>(`/api/guilds/${guildId}/moderation/cases/${caseNumber}`, { method: "DELETE" }),
  liftCase: (guildId: string, caseNumber: number) =>
    request<CaseView>(`/api/guilds/${guildId}/moderation/cases/${caseNumber}/lift`, { method: "POST", body: "{}" }),
  automod: (guildId: string) => request<AutomodResponse>(`/api/guilds/${guildId}/automod`),
  saveAutomod: (guildId: string, settings: AutomodSettings) =>
    undoableSettings<AutomodResponse, AutomodSettings>(`/api/guilds/${guildId}/automod`, settings),
  joinLeave: (guildId: string) => request<JoinLeaveResponse>(`/api/guilds/${guildId}/join-leave`),
  levels: (guildId: string) => request<LevelsResponse>(`/api/guilds/${guildId}/levels`),
  saveLevels: (guildId: string, settings: LevelsSettings) =>
    undoableSettings<LevelsResponse, LevelsSettings>(`/api/guilds/${guildId}/levels`, settings),
  resetLevels: (guildId: string) => request<LevelsResponse>(`/api/guilds/${guildId}/levels/reset`, { method: "POST", body: "{}" }),
  economy: (guildId: string) => request<EconomyResponse>(`/api/guilds/${guildId}/economy`),
  saveEconomy: (guildId: string, settings: EconomySettings) =>
    undoableSettings<EconomyResponse, EconomySettings>(`/api/guilds/${guildId}/economy`, settings),
  resetEconomy: (guildId: string) => request<EconomyResponse>(`/api/guilds/${guildId}/economy/reset`, { method: "POST", body: "{}" }),
  createShopItem: (guildId: string, item: ShopItemInput) =>
    request<EconomyResponse>(`/api/guilds/${guildId}/economy/shop`, { method: "POST", body: JSON.stringify(item) }),
  updateShopItem: (guildId: string, id: number, item: ShopItemInput) =>
    request<EconomyResponse>(`/api/guilds/${guildId}/economy/shop/${id}`, { method: "PUT", body: JSON.stringify(item) }),
  deleteShopItem: (guildId: string, id: number) => request<EconomyResponse>(`/api/guilds/${guildId}/economy/shop/${id}`, { method: "DELETE" }),
  communityTools: (guildId: string) => request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools`),
  enableCommunity: (guildId: string, input: EnableCommunityInput) =>
    request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools/community`, { method: "POST", body: JSON.stringify(input) }),
  disableCommunity: (guildId: string) => request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools/community`, { method: "DELETE" }),
  convertChannel: (guildId: string, input: { channelId: string; to: "announcement" | "text" }) =>
    request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools/convert`, { method: "POST", body: JSON.stringify(input) }),
  createAnnouncementChannel: (guildId: string, input: { name: string; parentId: string | null }) =>
    request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools/announcement`, { method: "POST", body: JSON.stringify(input) }),
  saveWelcomeScreen: (guildId: string, input: WelcomeScreenInput) =>
    request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools/welcome-screen`, { method: "PUT", body: JSON.stringify(input) }),
  saveDiscordOnboarding: (guildId: string, input: DiscordOnboardingInput) =>
    request<CommunityToolsResponse>(`/api/guilds/${guildId}/community-tools/onboarding`, { method: "PUT", body: JSON.stringify(input) }),
  saveJoinLeave: (guildId: string, settings: JoinLeaveSettings) =>
    undoableSettings<JoinLeaveResponse, JoinLeaveSettings>(`/api/guilds/${guildId}/join-leave`, settings),
  antiRaid: (guildId: string) => request<AntiRaidResponse>(`/api/guilds/${guildId}/anti-raid`),
  saveAntiRaid: (guildId: string, settings: AntiRaidSettings) =>
    undoableSettings<AntiRaidResponse, AntiRaidSettings>(`/api/guilds/${guildId}/anti-raid`, settings),
  startRaid: (guildId: string, minutes?: number) =>
    request<AntiRaidResponse>(`/api/guilds/${guildId}/anti-raid/start`, { method: "POST", body: JSON.stringify(minutes ? { minutes } : {}) }),
  endRaid: (guildId: string) => request<AntiRaidResponse>(`/api/guilds/${guildId}/anti-raid/end`, { method: "POST", body: "{}" }),
  embeds: (guildId: string) => request<EmbedMessageView[]>(`/api/guilds/${guildId}/embeds`),
  createEmbed: (guildId: string, input: EmbedMessageInput) =>
    request<EmbedMessageView>(`/api/guilds/${guildId}/embeds`, { method: "POST", body: JSON.stringify(input) }),
  updateEmbed: (guildId: string, messageId: string, input: EmbedMessageInput) =>
    request<EmbedMessageView>(`/api/guilds/${guildId}/embeds/${messageId}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteEmbed: (guildId: string, messageId: string) => request<{ ok: true }>(`/api/guilds/${guildId}/embeds/${messageId}`, { method: "DELETE" }),
  announcements: (guildId: string) => request<AnnouncementsResponse>(`/api/guilds/${guildId}/announcements`),
  createAnnouncement: (guildId: string, input: AnnouncementInput) =>
    request<AnnouncementView>(`/api/guilds/${guildId}/announcements`, { method: "POST", body: JSON.stringify(input) }),
  updateAnnouncement: (guildId: string, id: number, input: AnnouncementInput | { message: AnnouncementMessage }) =>
    request<AnnouncementView>(`/api/guilds/${guildId}/announcements/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteAnnouncement: (guildId: string, id: number) => request<{ ok: true }>(`/api/guilds/${guildId}/announcements/${id}`, { method: "DELETE" }),
  createAnnouncementTemplate: (guildId: string, input: TemplateInput) =>
    request<TemplateView>(`/api/guilds/${guildId}/announcements/templates`, { method: "POST", body: JSON.stringify(input) }),
  updateAnnouncementTemplate: (guildId: string, id: number, input: TemplateInput) =>
    request<TemplateView>(`/api/guilds/${guildId}/announcements/templates/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteAnnouncementTemplate: (guildId: string, id: number) =>
    request<{ ok: true }>(`/api/guilds/${guildId}/announcements/templates/${id}`, { method: "DELETE" }),
  events: (guildId: string) => request<EventsResponse>(`/api/guilds/${guildId}/events`),
  eventRsvps: (guildId: string, id: number) => request<RsvpView[]>(`/api/guilds/${guildId}/events/${id}/rsvps`),
  createEvent: (guildId: string, input: EventInput) =>
    request<EventResult>(`/api/guilds/${guildId}/events`, { method: "POST", body: JSON.stringify(input) }),
  updateEvent: (guildId: string, id: number, input: EventInput) =>
    request<EventResult>(`/api/guilds/${guildId}/events/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  pushEventToDiscord: (guildId: string, id: number) =>
    request<EventResult>(`/api/guilds/${guildId}/events/${id}/discord`, { method: "POST", body: "{}" }),
  cancelEvent: (guildId: string, id: number) => request<EventResult>(`/api/guilds/${guildId}/events/${id}/cancel`, { method: "POST", body: "{}" }),
  deleteEvent: (guildId: string, id: number) => request<{ ok: true }>(`/api/guilds/${guildId}/events/${id}`, { method: "DELETE" }),
  forums: (guildId: string) => request<ForumsResponse>(`/api/guilds/${guildId}/forums`),
  createForum: (guildId: string, input: ForumInput) => request<ForumsResponse>(`/api/guilds/${guildId}/forums`, { method: "POST", body: JSON.stringify(input) }),
  updateForum: (guildId: string, id: string, input: ForumInput) =>
    request<ForumsResponse>(`/api/guilds/${guildId}/forums/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  saveForumHelpers: (guildId: string, id: string, input: Omit<ForumAutomation, "channelId">) =>
    request<ForumsResponse>(`/api/guilds/${guildId}/forums/${id}/automation`, { method: "PUT", body: JSON.stringify(input) }),
  forumPostAction: (guildId: string, forumId: string, postId: string, action: PostAction) =>
    request<ForumsResponse>(`/api/guilds/${guildId}/forums/${forumId}/posts/${postId}`, { method: "POST", body: JSON.stringify({ action }) }),
  deleteForumPost: (guildId: string, forumId: string, postId: string) =>
    request<ForumsResponse>(`/api/guilds/${guildId}/forums/${forumId}/posts/${postId}`, { method: "DELETE" }),
  suggestions: (guildId: string) => request<SuggestionsResponse>(`/api/guilds/${guildId}/suggestions`),
  saveSuggestionSettings: (guildId: string, settings: SuggestionSettings) =>
    undoable<SuggestionsResponse, SuggestionSettings>(
      () => request<SuggestionsResponse>(`/api/guilds/${guildId}/suggestions`),
      (r) => r.settings,
      (s) => request<SuggestionsResponse>(`/api/guilds/${guildId}/suggestions/settings`, { method: "PUT", body: JSON.stringify(s) }),
      settings,
    ),
  setSuggestionStatus: (guildId: string, id: number, input: SuggestionStatusInput) =>
    request<SuggestionsResponse>(`/api/guilds/${guildId}/suggestions/${id}/status`, { method: "POST", body: JSON.stringify(input) }),
  deleteSuggestion: (guildId: string, id: number) => request<SuggestionsResponse>(`/api/guilds/${guildId}/suggestions/${id}`, { method: "DELETE" }),
  polls: (guildId: string) => request<PollsResponse>(`/api/guilds/${guildId}/polls`),
  savePollSettings: (guildId: string, settings: PollSettings) =>
    undoable<PollsResponse, PollSettings>(
      () => request<PollsResponse>(`/api/guilds/${guildId}/polls`),
      (r) => r.settings,
      (s) => request<PollsResponse>(`/api/guilds/${guildId}/polls/settings`, { method: "PUT", body: JSON.stringify(s) }),
      settings,
    ),
  createPoll: (guildId: string, input: PollInput) => request<PollView>(`/api/guilds/${guildId}/polls`, { method: "POST", body: JSON.stringify(input) }),
  pollVoters: (guildId: string, id: number) => request<PollVoterView[]>(`/api/guilds/${guildId}/polls/${id}/voters`),
  endPoll: (guildId: string, id: number) => request<PollView>(`/api/guilds/${guildId}/polls/${id}/end`, { method: "POST", body: "{}" }),
  deletePoll: (guildId: string, id: number) => request<{ ok: true }>(`/api/guilds/${guildId}/polls/${id}`, { method: "DELETE" }),
  channelDesigns: (guildId: string) => request<ChannelDesignsResponse>(`/api/guilds/${guildId}/channel-designs`),
  cleanChannelNames: (guildId: string, cleanup: CleanupSettings) =>
    request<ChannelDesignsResponse>(`/api/guilds/${guildId}/channel-designs/clean`, { method: "POST", body: JSON.stringify(cleanup) }),
  applyChannelDesign: (guildId: string, settings: ChannelDesignSettings) =>
    undoable<ChannelDesignsResponse, ChannelDesignSettings>(
      () => request(`/api/guilds/${guildId}/channel-designs`),
      (r) => r.settings,
      (s) => request(`/api/guilds/${guildId}/channel-designs/apply`, { method: "POST", body: JSON.stringify(s) }),
      settings,
    ),
  messageLogs: (guildId: string) => request<MessageLogResponse>(`/api/guilds/${guildId}/message-logs`),
  saveMessageLogs: (guildId: string, settings: MessageLogSettings) =>
    undoableSettings<MessageLogResponse, MessageLogSettings>(`/api/guilds/${guildId}/message-logs`, settings),
  memberLogs: (guildId: string) => request<MemberLogResponse>(`/api/guilds/${guildId}/member-logs`),
  saveMemberLogs: (guildId: string, settings: MemberLogSettings) =>
    undoableSettings<MemberLogResponse, MemberLogSettings>(`/api/guilds/${guildId}/member-logs`, settings),
  serverLogs: (guildId: string) => request<ServerLogResponse>(`/api/guilds/${guildId}/server-logs`),
  saveServerLogs: (guildId: string, settings: ServerLogSettings) =>
    undoableSettings<ServerLogResponse, ServerLogSettings>(`/api/guilds/${guildId}/server-logs`, settings),
  staffApplications: (guildId: string) => request<StaffApplicationsResponse>(`/api/guilds/${guildId}/staff-applications`),
  saveStaffApplicationSettings: (guildId: string, settings: StaffApplicationSettings) =>
    request<StaffApplicationsResponse>(`/api/guilds/${guildId}/staff-applications/settings`, { method: "PUT", body: JSON.stringify(settings) }),
  saveApplicationPanel: (guildId: string, panel: AppPanelInput) =>
    request<StaffApplicationsResponse>(`/api/guilds/${guildId}/staff-applications/panel`, { method: "PUT", body: JSON.stringify(panel) }),
  deleteApplicationPanel: (guildId: string) =>
    request<StaffApplicationsResponse>(`/api/guilds/${guildId}/staff-applications/panel`, { method: "DELETE" }),
  decideApplication: (guildId: string, id: number, input: ApplicationDecisionInput) =>
    request<StaffApplicationsResponse & { warnings: string[] }>(`/api/guilds/${guildId}/staff-applications/${id}/decision`, { method: "POST", body: JSON.stringify(input) }),
  botUpdates: (guildId: string) => request<BotUpdatesPanelData>(`/api/guilds/${guildId}/bot-updates`),
  saveBotUpdates: (guildId: string, settings: BotUpdateSettings) =>
    undoableSettings<BotUpdatesPanelData, BotUpdateSettings>(`/api/guilds/${guildId}/bot-updates`, settings),
  testBotUpdates: (guildId: string) => request<{ ok: true }>(`/api/guilds/${guildId}/bot-updates/test`, { method: "POST", body: "{}" }),
  // Developer page (only works for the bot's developer).
  developer: () => request<DeveloperOverview>("/api/developer"),
  sendBotUpdate: (input: BotUpdateInput) =>
    request<BotUpdateSummary>("/api/developer/updates", { method: "POST", body: JSON.stringify(input) }),
  botUpdateFailures: (id: number) => request<{ failures: BotUpdateFailure[] }>(`/api/developer/updates/${id}/failures`),
  createUpdateTemplate: (input: BotUpdateTemplateInput) =>
    request<DeveloperOverview>("/api/developer/templates", { method: "POST", body: JSON.stringify(input) }),
  updateUpdateTemplate: (id: number, input: BotUpdateTemplateInput) =>
    request<DeveloperOverview>(`/api/developer/templates/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteUpdateTemplate: (id: number) => request<DeveloperOverview>(`/api/developer/templates/${id}`, { method: "DELETE" }),
  setMaintenance: (input: MaintenanceInput) => request<DeveloperOverview>("/api/developer/maintenance", { method: "PUT", body: JSON.stringify(input) }),
  voiceLogs: (guildId: string) => request<VoiceLogResponse>(`/api/guilds/${guildId}/voice-logs`),
  saveVoiceLogs: (guildId: string, settings: VoiceLogSettings) =>
    undoableSettings<VoiceLogResponse, VoiceLogSettings>(`/api/guilds/${guildId}/voice-logs`, settings),
  customCommands: (guildId: string) => request<CustomCommandsResponse>(`/api/guilds/${guildId}/custom-commands`),
  createCustomCommand: (guildId: string, input: CustomCommandInput) =>
    request<CustomCommandsResponse>(`/api/guilds/${guildId}/custom-commands`, { method: "POST", body: JSON.stringify(input) }),
  updateCustomCommand: (guildId: string, id: number, input: CustomCommandInput) =>
    request<CustomCommandsResponse>(`/api/guilds/${guildId}/custom-commands/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  saveRules: (guildId: string, rules: RulesSettings) =>
    undoable<CustomCommandsResponse, RulesSettings>(
      () => request(`/api/guilds/${guildId}/custom-commands`),
      (r) => r.rules,
      (s) => request(`/api/guilds/${guildId}/custom-commands/rules`, { method: "PUT", body: JSON.stringify(s) }),
      rules,
    ),
  deleteCustomCommand: (guildId: string, id: number) =>
    request<CustomCommandsResponse>(`/api/guilds/${guildId}/custom-commands/${id}`, { method: "DELETE" }),
  ruleVerification: (guildId: string) => request<RuleVerificationResponse>(`/api/guilds/${guildId}/rule-verification`),
  saveRuleVerification: (guildId: string, settings: RuleVerificationSettings) =>
    undoableSettings<RuleVerificationResponse, RuleVerificationSettings>(`/api/guilds/${guildId}/rule-verification`, settings),
  tickets: (guildId: string) => request<TicketsResponse>(`/api/guilds/${guildId}/tickets`),
  saveTicketSettings: (guildId: string, settings: TicketSettings) =>
    undoable<TicketsResponse, TicketSettings>(
      () => request(`/api/guilds/${guildId}/tickets`),
      (r) => r.settings,
      (s) => request(`/api/guilds/${guildId}/tickets/settings`, { method: "PUT", body: JSON.stringify(s) }),
      settings,
    ),
  createTicketPanel: (guildId: string, input: TicketPanelInput) =>
    request<TicketsResponse>(`/api/guilds/${guildId}/tickets/panels`, { method: "POST", body: JSON.stringify(input) }),
  updateTicketPanel: (guildId: string, id: number, input: TicketPanelInput) =>
    request<TicketsResponse>(`/api/guilds/${guildId}/tickets/panels/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteTicketPanel: (guildId: string, id: number) =>
    request<TicketsResponse>(`/api/guilds/${guildId}/tickets/panels/${id}`, { method: "DELETE" }),
  guides: (guildId: string) => request<GuidesResponse>(`/api/guilds/${guildId}/guides`),
  saveGuide: (guildId: string, kind: GuideKind, guide: GuideSettings) =>
    undoable<GuidesResponse, GuideSettings>(
      () => request(`/api/guilds/${guildId}/guides`),
      (r) => r.settings[kind],
      (g) => request(`/api/guilds/${guildId}/guides/${kind}`, { method: "PUT", body: JSON.stringify(g) }),
      guide,
    ),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
};

export const guildIconUrl = (g: { id: string; icon: string | null }) =>
  g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null;

export const avatarUrl = (u: DashboardUser) =>
  u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;

export const inviteUrl = (clientId: string, guildId?: string) => {
  const params = new URLSearchParams({ client_id: clientId, scope: "bot applications.commands", permissions: "8" });
  if (guildId) params.set("guild_id", guildId);
  return `https://discord.com/oauth2/authorize?${params}`;
};
