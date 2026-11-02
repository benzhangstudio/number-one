import { useEffect, useState } from "react";
import {
  type AntiRaidResponse,
  type AntiRaidSettings,
  MAX_RAID_MINUTES,
  type RaidAction,
  type YoungAccountAction,
  raidActionInfo,
  raidActions,
  youngAccountActions,
} from "../../../src/shared/antiRaid";
import { durationChoices, formatDuration } from "../../../src/shared/moderation";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RoleSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];
type Draft = AntiRaidSettings;

const TIMEOUT_CHOICES = durationChoices.filter((c) => c.minutes <= 28 * 24 * 60);
const RAID_LENGTHS = [5, 10, 15, 30, 60, 120, 360, 720, MAX_RAID_MINUTES];

const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);

/** Dashboard section for Anti-raid: live status with start/end buttons, then the settings. */
export function AntiRaidPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<AntiRaidResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: AntiRaidResponse, keepDraft = false) => {
    setData(r);
    if (!keepDraft) setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.antiRaid(guild.id).then((r) => load(r)).catch((err) => setError(err.message));
  }, [guild.id]);

  // Keep the status (raid mode, joins) fresh while the page is open.
  useEffect(() => {
    const timer = setInterval(() => {
      api.antiRaid(guild.id).then((r) => load(r, true)).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading anti-raid…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const run = async (fn: () => Promise<AntiRaidResponse>, done: string, keepDraft = false) => {
    setBusy(true);
    setError("");
    try {
      load(await fn(), keepDraft);
      setNotice(done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const { status } = data;
  const raid = status.raid;

  const number = (label: string, value: number, min: number, max: number, apply: (d: Draft, v: number) => void) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => set((d) => apply(d, clamp(e.target.valueAsNumber, min, max)))} />
    </label>
  );

  const timeoutSelect = (value: number, apply: (d: Draft, v: number) => void) => (
    <label className="field">
      <span>Timeout length</span>
      <select value={value} onChange={(e) => set((d) => apply(d, Number(e.target.value)))}>
        {!TIMEOUT_CHOICES.some((c) => c.minutes === value) && <option value={value}>{formatDuration(value * 60_000)}</option>}
        {TIMEOUT_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
      </select>
    </label>
  );

  return (
    <div className="panel moderation automod anti-raid">
      {raid ? (
        <div className="raid-banner on">
          <div>
            <strong>🚨 Raid mode is on</strong>
            <span className="small">
              {raid.startedBy ? `Started by ${raid.startedBy}` : "Started by the join limit"} · ends {new Date(raid.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
              {raid.handled} account{raid.handled === 1 ? "" : "s"} dealt with
            </span>
            <span className="small muted">
              {[raid.invitesPaused && "Invites paused", raid.verificationRaised && "Verification raised to High"].filter(Boolean).join(" · ") || "Nothing locked down"}
            </span>
          </div>
          <button className="btn primary small" disabled={busy} onClick={() => run(() => api.endRaid(guild.id), "Raid mode ended. Everything is back to how it was.", true)}>
            End raid mode
          </button>
        </div>
      ) : (
        <div className="raid-banner">
          <div>
            <strong>✅ No raid right now</strong>
            <span className="small muted">
              Raid mode starts by itself when more than {data.settings.joinCount} people join within {data.settings.joinSeconds} seconds. You can also
              start it by hand, here or with <code>/raidmode on</code>.
            </span>
          </div>
          <button
            className="btn danger small"
            disabled={busy}
            onClick={() => {
              if (confirm(`Start raid mode for ${formatDuration(data.settings.durationMinutes * 60_000)}? New joiners will be dealt with as set below.`)) {
                void run(() => api.startRaid(guild.id), "Raid mode is on.", true);
              }
            }}
          >
            Start raid mode
          </button>
        </div>
      )}

      <div className="stats mod-stats">
        <div><strong>{status.joinsLastMinute}</strong><span className="muted small">joins in the last minute</span></div>
        <div><strong>{status.youngTurnedAway}</strong><span className="muted small">new accounts turned away since restart</span></div>
      </div>

      {status.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {status.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      <section className="sub">
        <div className="sub-head">
          <strong>Alerts</strong>
          <small className="muted">One alert when raid mode starts (pinging the role you pick) and one summary when it ends.</small>
        </div>
        <div className="mod-row">
          <div className="field">
            <span>Alert channel</span>
            <ChannelSelect guild={guild} value={draft.alertChannelId} emptyLabel="No alerts" onChange={(v) => set((d) => { d.alertChannelId = v; })} />
          </div>
          <div className="field">
            <span>Role to ping</span>
            <RoleSelect guild={guild} value={draft.alertRoleId} emptyLabel="No ping" onChange={(v) => set((d) => { d.alertRoleId = v; })} />
            {draft.alertRoleId && (
              <button className="link small" onClick={() => set((d) => { d.alertRoleId = null; })}>Don't ping anyone</button>
            )}
          </div>
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>🌊 When is it a raid?</strong>
          <small className="muted">
            Raid mode starts when more people join than this. Pick a limit your server never reaches on a normal day. If you expect a rush (a big
            announcement or a giveaway), raise it for the day.
          </small>
        </div>
        <div className="mod-row">
          {number("More than this many joins", draft.joinCount, 3, 100, (d, v) => { d.joinCount = v; })}
          {number("Within (seconds)", draft.joinSeconds, 5, 300, (d, v) => { d.joinSeconds = v; })}
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>🔒 During raid mode</strong>
          <small className="muted">Everything here is undone automatically when raid mode ends. Admins, people with Manage Server and bots are never touched.</small>
        </div>
        <div className="mod-row">
          <label className="field">
            <span>Raiders (everyone in the wave, and anyone who joins during raid mode)</span>
            <select value={draft.action} onChange={(e) => set((d) => { d.action = e.target.value as RaidAction; })}>
              {raidActions.map((a) => <option key={a} value={a}>{raidActionInfo[a].label}</option>)}
            </select>
            <small className="muted">{raidActionInfo[draft.action].hint}</small>
          </label>
          {draft.action === "timeout" && timeoutSelect(draft.timeoutMinutes, (d, v) => { d.timeoutMinutes = v; })}
        </div>
        <Toggle
          label="Pause invites"
          hint="Nobody can join with an invite until raid mode ends. Discord lifts the pause by itself, even if Number One goes offline."
          checked={draft.pauseInvites}
          onChange={(v) => set((d) => { d.pauseInvites = v; })}
        />
        <Toggle
          label="Raise verification to High"
          hint="New members must wait 10 minutes before they can chat. Set back to what it was afterwards (unless someone changed it meanwhile)."
          checked={draft.raiseVerification}
          onChange={(v) => set((d) => { d.raiseVerification = v; })}
        />
        <label className="field">
          <span>Raid mode lasts</span>
          <select value={draft.durationMinutes} onChange={(e) => set((d) => { d.durationMinutes = Number(e.target.value); })}>
            {!RAID_LENGTHS.includes(draft.durationMinutes) && <option value={draft.durationMinutes}>{formatDuration(draft.durationMinutes * 60_000)}</option>}
            {RAID_LENGTHS.map((m) => <option key={m} value={m}>{formatDuration(m * 60_000)}</option>)}
          </select>
          <small className="muted">If joins keep coming too fast, it lasts longer. End it early anytime.</small>
        </label>
      </section>

      <section className="sub automod-rule">
        <Toggle
          label="👶 Turn away new accounts"
          hint="At any time, not only during raids. Brand-new accounts are a common sign of throwaway raid and spam accounts. Each one becomes a Moderation case and gets a DM saying why."
          checked={draft.youngAccounts.enabled}
          onChange={(v) => set((d) => { d.youngAccounts.enabled = v; })}
        />
        {draft.youngAccounts.enabled && (
          <div className="sub-body automod-body">
            <div className="mod-row">
              {number("Accounts younger than (days)", draft.youngAccounts.minAgeDays, 1, 90, (d, v) => { d.youngAccounts.minAgeDays = v; })}
              <label className="field">
                <span>What happens</span>
                <select value={draft.youngAccounts.action} onChange={(e) => set((d) => { d.youngAccounts.action = e.target.value as YoungAccountAction; })}>
                  {youngAccountActions.map((a) => <option key={a} value={a}>{raidActionInfo[a].label}</option>)}
                </select>
              </label>
              {draft.youngAccounts.action === "timeout" && timeoutSelect(draft.youngAccounts.timeoutMinutes, (d, v) => { d.youngAccounts.timeoutMinutes = v; })}
            </div>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : "No changes to save."}</span>
        <button className="btn ghost small" disabled={busy || !dirty} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
        <button className="btn primary small" disabled={busy || !dirty} onClick={() => run(() => api.saveAntiRaid(guild.id, draft), "")}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
