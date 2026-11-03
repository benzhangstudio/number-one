import { useEffect, useState } from "react";
import {
  type CommunityToolsResponse,
  type DiscordOnboardingInput,
  ONBOARDING_MIN_DEFAULT_CHANNELS,
  PROMPTS_MAX,
  PROMPT_OPTIONS_MAX,
  type PromptInput,
  WELCOME_CHANNELS_MAX,
  WELCOME_CHANNEL_DESCRIPTION_MAX,
  WELCOME_DESCRIPTION_MAX,
  type WelcomeScreenInput,
} from "../../../src/shared/communityTools";
import { type GuildDetails, api } from "../api";
import { CategorySelect, ChannelPicker, ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const TEXT = 0;
const ANNOUNCEMENT = 5;
const CATEGORY = 4;

/** Dashboard section for Community tools: Community on/off, announcement channels, Welcome Screen, Discord's onboarding. */
export function CommunityToolsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<CommunityToolsResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api.communityTools(guild.id).then(setData).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading community tools…</p>;

  // Channel types change as channels are converted, so pickers use the fresh list from Discord.
  const live: Guild = { ...guild, channels: data.channels };

  /** Runs one action, shows its error, and swaps in the fresh state from Discord. */
  const run = async (what: string, action: () => Promise<CommunityToolsResponse>) => {
    setBusy(what);
    setError("");
    try {
      setData(await action());
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="panel community-tools">
      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <CommunitySection data={data} guild={live} busy={busy} run={run} guildId={guild.id} />

      {data.community ? (
        <>
          <AnnouncementSection data={data} guild={live} busy={busy} run={run} guildId={guild.id} />
          {data.welcomeScreen && <WelcomeScreenSection initial={data.welcomeScreen} guild={live} busy={busy} run={run} guildId={guild.id} />}
          {data.onboarding && (
            <OnboardingSection initial={data.onboarding} ourOnboardingOn={data.ourOnboardingOn} guild={live} busy={busy} run={run} guildId={guild.id} />
          )}
        </>
      ) : (
        <p className="muted small">Announcement channels, the Welcome Screen and Discord's onboarding show up here once Community is on.</p>
      )}

      <p className="muted small">
        Discord doesn't let bots set up the Server Guide's resource channels. Add those in Discord: Server Settings → Onboarding → Server Guide.
        For a guide Number One can post, use <a href="/docs/guides">Guides</a>.
      </p>
    </div>
  );
}

type SectionProps = {
  data: CommunityToolsResponse;
  guild: Guild;
  guildId: string;
  busy: string;
  run: (what: string, action: () => Promise<CommunityToolsResponse>) => Promise<boolean>;
};

/* ------------------------------------------------------------ Community on/off */

function CommunitySection({ data, guild, guildId, busy, run }: SectionProps) {
  const [rules, setRules] = useState<string | null>(null);
  const [updates, setUpdates] = useState<string | null>(null);
  const name = (id: string | null) => (id ? `#${guild.channels.find((c) => c.id === id)?.name ?? "deleted channel"}` : "none");

  if (data.community) {
    return (
      <section className="sub">
        <div className="sub-head">
          <strong>✅ Community is on</strong>
          <small className="muted">Rules channel: {name(data.rulesChannelId)} · Updates from Discord: {name(data.updatesChannelId)}</small>
        </div>
        {data.canChangeCommunity && (
          <button
            className="btn ghost small"
            disabled={Boolean(busy)}
            onClick={() => {
              if (confirm("Switch off Community? Announcement channels, the Welcome Screen and Discord's onboarding stop working. Discord may ask you to change announcement channels back to text first.")) {
                run("community", () => api.disableCommunity(guildId));
              }
            }}
          >
            {busy === "community" ? "Switching off…" : "Switch off Community"}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="sub">
      <div className="sub-head">
        <strong>Switch on Community</strong>
        <small className="muted">Discord's Community features unlock announcement channels, a Welcome Screen and Discord's own onboarding. Switching it on will:</small>
      </div>
      <ul className="small community-plan">
        {data.enablePlan.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <div className="mod-row">
        <label className="field">
          <span>Rules channel</span>
          <ChannelSelect guild={guild} value={rules} onChange={setRules} emptyLabel="Make a new #rules" />
        </label>
        <label className="field">
          <span>Updates from Discord</span>
          <ChannelSelect guild={guild} value={updates} onChange={setUpdates} emptyLabel="Make a new staff-only #moderator-only" />
        </label>
      </div>
      {data.canChangeCommunity ? (
        <button
          className="btn primary small"
          disabled={Boolean(busy) || (Boolean(rules) && rules === updates)}
          onClick={() => run("community", () => api.enableCommunity(guildId, { rulesChannelId: rules, updatesChannelId: updates }))}
        >
          {busy === "community" ? "Switching on…" : "Switch on Community"}
        </button>
      ) : (
        <p className="muted small">Only the server owner or an Administrator can switch Community on.</p>
      )}
      {rules && rules === updates && <p className="error small">Pick two different channels.</p>}
    </section>
  );
}

/* ------------------------------------------------------------ announcement channels */

function AnnouncementSection({ data, guild, guildId, busy, run }: SectionProps) {
  const [name, setName] = useState("announcements");
  const [parent, setParent] = useState<string | null>(null);
  const channels = data.channels.filter((c) => c.type === TEXT || c.type === ANNOUNCEMENT);
  const categoryName = (id: string | null) => (id ? data.channels.find((c) => c.id === id && c.type === CATEGORY)?.name : null);
  const locked = new Set([data.rulesChannelId, data.updatesChannelId]);

  return (
    <section className="sub">
      <div className="sub-head">
        <strong>Announcement channels</strong>
        <small className="muted">Posts in announcement channels can be published, so other servers that follow the channel get them too.</small>
      </div>
      <div className="community-new">
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Channel name" />
        <CategorySelect guild={guild} value={parent} onChange={setParent} />
        <button
          className="btn primary small"
          disabled={Boolean(busy) || !name.trim()}
          onClick={async () => {
            if (await run("create", () => api.createAnnouncementChannel(guildId, { name: name.trim(), parentId: parent }))) setName("announcements");
          }}
        >
          {busy === "create" ? "Making…" : "+ Make announcement channel"}
        </button>
      </div>
      <small className="muted">New announcement channels are read-only for @everyone, so only staff can post.</small>
      <ul className="community-channels">
        {channels.map((c) => {
          const isAnn = c.type === ANNOUNCEMENT;
          return (
            <li key={c.id}>
              <span>{isAnn ? "📢" : "#"} {c.name}</span>
              <span className="muted small">{categoryName(c.parentId) ?? ""}</span>
              {locked.has(c.id) ? (
                <span className="muted small">{c.id === data.rulesChannelId ? "Rules channel" : "Updates channel"}</span>
              ) : (
                <button
                  className="btn ghost small"
                  disabled={Boolean(busy)}
                  onClick={() => run(c.id, () => api.convertChannel(guildId, { channelId: c.id, to: isAnn ? "text" : "announcement" }))}
                >
                  {busy === c.id ? "Changing…" : isAnn ? "Make text" : "Make announcement"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ Welcome Screen */

function WelcomeScreenSection({ initial, guild, guildId, busy, run }: Omit<SectionProps, "data"> & { initial: WelcomeScreenInput }) {
  const [draft, setDraft] = useState(structuredClone(initial));
  // Reset only when Discord's saved version changes, not on every refresh (e.g. after converting a channel).
  const saved = JSON.stringify(initial);
  useEffect(() => setDraft(structuredClone(initial)), [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = (fn: (d: WelcomeScreenInput) => void) => setDraft((d) => { const n = structuredClone(d); fn(n); return n; });
  const used = new Set(draft.channels.map((c) => c.channelId));

  return (
    <section className="sub">
      <Toggle
        label="Welcome Screen"
        hint="What new members see before they join: a short description and up to 5 channels to start in."
        checked={draft.enabled}
        onChange={(v) => set((d) => { d.enabled = v; })}
      />
      <div className="sub-body">
        <label className="field">
          <span>Description</span>
          <textarea rows={2} maxLength={WELCOME_DESCRIPTION_MAX} value={draft.description} placeholder="What's this server about?" onChange={(e) => set((d) => { d.description = e.target.value; })} />
        </label>
        {draft.channels.map((c, i) => (
          <div className="community-welcome-row" key={i}>
            <input className="community-emoji" value={c.emoji} maxLength={64} placeholder="😀" onChange={(e) => set((d) => { d.channels[i].emoji = e.target.value; })} />
            <ChannelSelect guild={guild} value={c.channelId || null} onChange={(v) => set((d) => { d.channels[i].channelId = v ?? ""; })} />
            <input value={c.description} maxLength={WELCOME_CHANNEL_DESCRIPTION_MAX} placeholder="What it's for" onChange={(e) => set((d) => { d.channels[i].description = e.target.value; })} />
            <button className="icon-btn small" aria-label="Remove channel" onClick={() => set((d) => { d.channels.splice(i, 1); })}>×</button>
          </div>
        ))}
        {draft.channels.length < WELCOME_CHANNELS_MAX && (
          <button className="link add-row" onClick={() => set((d) => { d.channels.push({ channelId: guild.channels.find((ch) => (ch.type === TEXT || ch.type === ANNOUNCEMENT) && !used.has(ch.id))?.id ?? "", description: "", emoji: "" }); })}>
            + Add a channel
          </button>
        )}
      </div>
      <div className="editor-actions">
        <button className="btn ghost small" disabled={!dirty || Boolean(busy)} onClick={() => setDraft(structuredClone(initial))}>Discard</button>
        <button
          className="btn primary small"
          disabled={!dirty || Boolean(busy) || draft.channels.some((c) => !c.channelId || !c.description.trim())}
          title={draft.channels.some((c) => !c.channelId || !c.description.trim()) ? "Every channel needs a description" : undefined}
          onClick={() => run("welcome", () => api.saveWelcomeScreen(guildId, draft))}
        >
          {busy === "welcome" ? "Saving…" : "Save Welcome Screen"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Discord's onboarding */

const newPrompt = (): PromptInput => ({
  id: null,
  title: "",
  singleSelect: false,
  required: false,
  inOnboarding: true,
  type: 0,
  options: [{ id: null, title: "", description: "", emoji: "", roleIds: [], channelIds: [] }],
});

function OnboardingSection({
  initial,
  ourOnboardingOn,
  guild,
  guildId,
  busy,
  run,
}: Omit<SectionProps, "data"> & { initial: DiscordOnboardingInput; ourOnboardingOn: boolean }) {
  const [draft, setDraft] = useState(structuredClone(initial));
  // Reset only when Discord's saved version changes, not on every refresh (e.g. after converting a channel).
  const saved = JSON.stringify(initial);
  useEffect(() => setDraft(structuredClone(initial)), [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = (fn: (d: DiscordOnboardingInput) => void) => setDraft((d) => { const n = structuredClone(d); fn(n); return n; });
  // Default channels can't be categories or voice channels.
  const notAllowed = Object.fromEntries(guild.channels.filter((c) => c.type === CATEGORY || c.type === 2 || c.type === 13).map((c) => [c.id, "can't be a default channel"]));
  const incomplete = draft.prompts.some((p) => !p.title.trim() || p.options.some((o) => !o.title.trim() || (!o.roleIds.length && !o.channelIds.length)));

  return (
    <section className="sub">
      <Toggle
        label="Discord's onboarding"
        hint="Discord's own questions and default channels for new members, shown when they join."
        checked={draft.enabled}
        onChange={(v) => set((d) => { d.enabled = v; })}
      />
      {ourOnboardingOn && draft.enabled && (
        <div className="notice warning-box small">
          Number One's Member onboarding is on too, so new members would go through both. Use one or the other.
        </div>
      )}
      <div className="sub-body">
        <label className="field">
          <span>Default channels</span>
          <ChannelPicker guild={guild} value={draft.defaultChannelIds} max={500} exclude={notAllowed} onChange={(v) => set((d) => { d.defaultChannelIds = v; })} />
          <small className="muted">
            Everyone sees these. Discord needs at least {ONBOARDING_MIN_DEFAULT_CHANNELS}, with 5 where @everyone can chat. You've picked {draft.defaultChannelIds.length}.
          </small>
        </label>
        <label className="field">
          <span>What counts towards Discord's minimum</span>
          <select value={draft.mode} onChange={(e) => set((d) => { d.mode = Number(e.target.value) as 0 | 1; })}>
            <option value={0}>Only default channels</option>
            <option value={1}>Default channels and channels from answers</option>
          </select>
        </label>

        <div className="sub-head spaced">
          <strong>Questions</strong>
          <small className="muted">Each answer gives roles, channels or both.</small>
        </div>
        {draft.prompts.map((p, pi) => (
          <div className="community-prompt" key={pi}>
            <div className="community-prompt-head">
              <input value={p.title} maxLength={100} placeholder="Question, like “What games do you play?”" onChange={(e) => set((d) => { d.prompts[pi].title = e.target.value; })} />
              <button className="icon-btn small" aria-label="Remove question" onClick={() => set((d) => { d.prompts.splice(pi, 1); })}>×</button>
            </div>
            <div className="community-prompt-flags small">
              <label className="check"><input type="checkbox" checked={p.singleSelect} onChange={(e) => set((d) => { d.prompts[pi].singleSelect = e.target.checked; })} /><span>Only one answer</span></label>
              <label className="check"><input type="checkbox" checked={p.required} onChange={(e) => set((d) => { d.prompts[pi].required = e.target.checked; })} /><span>Must answer</span></label>
              <label className="check"><input type="checkbox" checked={p.inOnboarding} onChange={(e) => set((d) => { d.prompts[pi].inOnboarding = e.target.checked; })} /><span>Ask when joining</span></label>
              <select value={p.type} onChange={(e) => set((d) => { d.prompts[pi].type = Number(e.target.value) as 0 | 1; })}>
                <option value={0}>Buttons</option>
                <option value={1}>Dropdown</option>
              </select>
            </div>
            {p.options.map((o, oi) => (
              <div className="community-option" key={oi}>
                <div className="community-option-row">
                  <input className="community-emoji" value={o.emoji} maxLength={64} placeholder="😀" onChange={(e) => set((d) => { d.prompts[pi].options[oi].emoji = e.target.value; })} />
                  <input value={o.title} maxLength={50} placeholder="Answer" onChange={(e) => set((d) => { d.prompts[pi].options[oi].title = e.target.value; })} />
                  <input value={o.description} maxLength={100} placeholder="Description (optional)" onChange={(e) => set((d) => { d.prompts[pi].options[oi].description = e.target.value; })} />
                  {p.options.length > 1 && (
                    <button className="icon-btn small" aria-label="Remove answer" onClick={() => set((d) => { d.prompts[pi].options.splice(oi, 1); })}>×</button>
                  )}
                </div>
                <div className="mod-row">
                  <RolePicker guild={guild} value={o.roleIds} max={25} placeholder="Give a role…" onChange={(v) => set((d) => { d.prompts[pi].options[oi].roleIds = v; })} />
                  <ChannelPicker guild={guild} value={o.channelIds} placeholder="Show a channel…" onChange={(v) => set((d) => { d.prompts[pi].options[oi].channelIds = v; })} />
                </div>
              </div>
            ))}
            {p.options.length < PROMPT_OPTIONS_MAX && (
              <button className="link add-row" onClick={() => set((d) => { d.prompts[pi].options.push({ id: null, title: "", description: "", emoji: "", roleIds: [], channelIds: [] }); })}>
                + Add an answer
              </button>
            )}
          </div>
        ))}
        {draft.prompts.length < PROMPTS_MAX && (
          <button className="link add-row" onClick={() => set((d) => { d.prompts.push(newPrompt()); })}>+ Add a question</button>
        )}
      </div>
      <div className="editor-actions">
        <button className="btn ghost small" disabled={!dirty || Boolean(busy)} onClick={() => setDraft(structuredClone(initial))}>Discard</button>
        <button
          className="btn primary small"
          disabled={!dirty || Boolean(busy) || incomplete}
          title={incomplete ? "Every question needs a title, and every answer a title and a role or channel" : undefined}
          onClick={() => run("onboarding", () => api.saveDiscordOnboarding(guildId, draft))}
        >
          {busy === "onboarding" ? "Saving…" : "Save onboarding"}
        </button>
      </div>
    </section>
  );
}
