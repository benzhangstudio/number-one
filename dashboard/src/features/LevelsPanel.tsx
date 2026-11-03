import { useEffect, useState } from "react";
import {
  LEVEL_PLACEHOLDERS,
  type LevelUpPlace,
  type LevelsResponse,
  type LevelsSettings,
  MAX_LEVEL,
  MAX_REWARDS,
  totalXpFor,
} from "../../../src/shared/levels";
import { type GuildDetails, api } from "../api";
import { ChannelPicker, ChannelSelect, RolePicker, RoleSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];
type Draft = LevelsSettings;

const PLACES: { value: LevelUpPlace; label: string }[] = [
  { value: "same", label: "In the channel they were chatting in" },
  { value: "channel", label: "In a channel I pick" },
  { value: "dm", label: "In a DM" },
  { value: "off", label: "Don't announce level-ups" },
];

const COOLDOWNS = [
  { seconds: 0, label: "No cooldown" },
  { seconds: 15, label: "15 seconds" },
  { seconds: 30, label: "30 seconds" },
  { seconds: 60, label: "1 minute" },
  { seconds: 120, label: "2 minutes" },
  { seconds: 300, label: "5 minutes" },
];

const n = (x: number) => x.toLocaleString("en-US");

/** Dashboard section for Levels: how XP is earned, level-up messages, reward roles and the leaderboard. */
export function LevelsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<LevelsResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = (r: LevelsResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.levels(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading levels…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveLevels(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm("Reset everyone's XP to zero? This can't be undone. Reward roles members already have are kept.")) return;
    setResetting(true);
    setError("");
    try {
      const r = await api.resetLevels(guild.id);
      setData((d) => (d ? { ...d, members: r.members, leaderboard: r.leaderboard } : r));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const usedLevels = new Set(draft.rewards.map((r) => r.level));
  const nextLevel = () => {
    let l = 5;
    while (usedLevels.has(l) && l < MAX_LEVEL) l += 5;
    return l;
  };
  const rewardRoleIds = draft.rewards.map((r) => r.roleId);

  return (
    <div className="panel levels">
      <div className="stats">
        <div><strong>{n(data.members)}</strong><span className="muted small">members with XP</span></div>
        <div><strong>{data.leaderboard[0] ? `Level ${data.leaderboard[0].level}` : "—"}</strong><span className="muted small">highest level</span></div>
        <div><strong>{draft.rewards.length}</strong><span className="muted small">reward roles</span></div>
      </div>

      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}

      <div className="mod-grid">
        <section className="sub">
          <div className="sub-head">
            <strong>Earning XP</strong>
            <small className="muted">Members get a random amount of XP for a message, then wait for the cooldown before the next one counts.</small>
          </div>
          <div className="mod-row">
            <label className="field">
              <span>XP per message, from</span>
              <input type="number" min={1} max={100} value={draft.xpMin} onChange={(e) => set((d) => { d.xpMin = clamp(e.target.valueAsNumber, 1, 100); })} />
            </label>
            <label className="field">
              <span>to</span>
              <input type="number" min={1} max={100} value={draft.xpMax} onChange={(e) => set((d) => { d.xpMax = clamp(e.target.valueAsNumber, 1, 100); })} />
            </label>
          </div>
          <label className="field">
            <span>Cooldown</span>
            <select value={draft.cooldownSeconds} onChange={(e) => set((d) => { d.cooldownSeconds = Number(e.target.value); })}>
              {!COOLDOWNS.some((c) => c.seconds === draft.cooldownSeconds) && <option value={draft.cooldownSeconds}>{draft.cooldownSeconds} seconds</option>}
              {COOLDOWNS.map((c) => <option key={c.seconds} value={c.seconds}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>No XP in these channels</span>
            <ChannelPicker guild={guild} value={draft.noXpChannelIds} onChange={(v) => set((d) => { d.noXpChannelIds = v; })} placeholder="Add a channel or category…" />
            <small className="muted">Picking a category covers every channel in it. Threads follow their channel.</small>
          </label>
          <label className="field">
            <span>No XP for these roles</span>
            <RolePicker guild={guild} value={draft.noXpRoleIds} max={25} onChange={(v) => set((d) => { d.noXpRoleIds = v; })} anyRole />
          </label>
        </section>

        <section className="sub">
          <div className="sub-head">
            <strong>Level-up message</strong>
            <small className="muted">Posted when a member reaches a new level.</small>
          </div>
          <label className="field">
            <span>Where</span>
            <select value={draft.levelUp.where} onChange={(e) => set((d) => { d.levelUp.where = e.target.value as LevelUpPlace; })}>
              {PLACES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          {draft.levelUp.where === "channel" && (
            <label className="field">
              <span>Channel</span>
              <ChannelSelect guild={guild} value={draft.levelUp.channelId} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.levelUp.channelId = v; })} />
            </label>
          )}
          {draft.levelUp.where !== "off" && (
            <label className="field">
              <span>Message</span>
              <textarea rows={3} maxLength={1000} value={draft.levelUp.message} onChange={(e) => set((d) => { d.levelUp.message = e.target.value; })} />
              <small className="muted">
                You can use{" "}
                {LEVEL_PLACEHOLDERS.map((p, i) => (
                  <span key={p.key} title={p.means}>
                    <code>{p.key}</code>
                    {i < LEVEL_PLACEHOLDERS.length - 1 ? " " : ""}
                  </span>
                ))}
              </small>
            </label>
          )}
        </section>
      </div>

      <section className="sub">
        <div className="sub-head">
          <strong>Reward roles</strong>
          <small className="muted">Give a role when members reach a level. Number One's role must be above these roles.</small>
        </div>
        {draft.rewards.map((reward, i) => (
          <div className="levels-reward" key={i}>
            <span className="muted small">At level</span>
            <input
              type="number"
              min={1}
              max={MAX_LEVEL}
              value={reward.level}
              onChange={(e) => set((d) => { d.rewards[i].level = clamp(e.target.valueAsNumber, 1, MAX_LEVEL); })}
            />
            <span className="muted small">give</span>
            <RoleSelect
              guild={guild}
              value={reward.roleId || null}
              onChange={(v) => set((d) => { d.rewards[i].roleId = v ?? ""; })}
            />
            <span className="muted small levels-xp-note">{n(totalXpFor(reward.level))} XP</span>
            <button className="icon-btn small" aria-label="Remove reward" onClick={() => set((d) => { d.rewards.splice(i, 1); })}>×</button>
          </div>
        ))}
        {draft.rewards.length === 0 && <p className="muted small">No reward roles yet.</p>}
        {draft.rewards.length < MAX_REWARDS && (
          <button className="link add-row" onClick={() => set((d) => { d.rewards.push({ level: nextLevel(), roleId: "" }); })}>
            + Add a reward role
          </button>
        )}
        {draft.rewards.length > 0 && (
          <div className="spaced-top">
            <Toggle
              label="Keep earlier reward roles"
              hint={draft.keepOldRewards ? "Members keep every reward role they've reached." : "Members only keep their highest reward role. Earlier ones are taken away as they level up."}
              checked={draft.keepOldRewards}
              onChange={(v) => set((d) => { d.keepOldRewards = v; })}
            />
          </div>
        )}
        {new Set(rewardRoleIds.filter(Boolean)).size !== rewardRoleIds.filter(Boolean).length && (
          <p className="error small">Each role can only be the reward for one level.</p>
        )}
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>Leaderboard</strong>
          <small className="muted">The top 25. Members see the full list with <code>/leaderboard</code> and their own rank with <code>/rank</code>.</small>
        </div>
        {data.leaderboard.length === 0 ? (
          <p className="muted small">Nobody has earned XP yet.</p>
        ) : (
          <ol className="levels-board">
            {data.leaderboard.map((e, i) => (
              <li key={e.userId}>
                <span className="levels-place">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                {e.avatar ? <img src={e.avatar} alt="" /> : <span className="levels-avatar" />}
                <span className="levels-name">{e.name}</span>
                <span className="muted small">{n(e.messages)} messages</span>
                <strong>Level {e.level}</strong>
                <span className="muted small">{n(e.xp)} XP</span>
              </li>
            ))}
          </ol>
        )}
        {data.members > 0 && (
          <button className="btn danger small spaced-top" disabled={resetting} onClick={reset}>
            {resetting ? "Resetting…" : "Reset everyone's XP"}
          </button>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : "No changes to save."}</span>
        <button className="btn ghost small" disabled={saving || !dirty} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
        <button
          className="btn primary small"
          disabled={saving || !dirty || draft.rewards.some((r) => !r.roleId)}
          title={draft.rewards.some((r) => !r.roleId) ? "Pick a role for every reward" : undefined}
          onClick={save}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

const clamp = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min);
