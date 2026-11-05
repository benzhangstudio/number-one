import { useEffect, useState } from "react";
import type { MemberLogResponse, MemberLogSettings } from "../../../src/shared/memberLogs";
import { type GuildDetails, api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

/** Dashboard section for Member logs: log channel and what to log. */
export function MemberLogsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<MemberLogResponse | null>(null);
  const [draft, setDraft] = useState<MemberLogSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: MemberLogResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.memberLogs(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading member logs…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: MemberLogSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveMemberLogs(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel member-logs">
      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      <section className="sub">
        <div className="sub-head"><strong>Log channel</strong><small className="muted">Best kept private to staff.</small></div>
        <div className="sub-body">
          <ChannelSelect guild={guild} value={draft.channelId} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.channelId = v; })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head"><strong>What to log</strong></div>
        <div className="sub-body memlog-options">
          <Toggle label="📥 Joins" hint="With how old their account is and the new member count." checked={draft.joins} onChange={(v) => set((d) => { d.joins = v; })} />
          {draft.joins && (
            <label className="field memlog-days">
              <span>Mark accounts younger than this many days as new (0 = never)</span>
              <NumberInput
                min={0}
                max={90}
                value={draft.newAccountDays}
                onChange={(v) => set((d) => { d.newAccountDays = v; })}
              />
            </label>
          )}
          <Toggle label="📤 Leaves" hint="When they joined and the roles they had." checked={draft.leaves} onChange={(v) => set((d) => { d.leaves = v; })} />
          <Toggle label="🏷️ Nickname changes" hint="Before and after, and who changed it." checked={draft.nicknames} onChange={(v) => set((d) => { d.nicknames = v; })} />
          <Toggle label="🎭 Role changes" hint="Roles added and removed, and who changed them." checked={draft.roles} onChange={(v) => set((d) => { d.roles = v; })} />
          <Toggle label="👤 Username and avatar changes" checked={draft.profiles} onChange={(v) => set((d) => { d.profiles = v; })} />
          <Toggle label="Skip bots" checked={draft.ignoreBots} onChange={(v) => set((d) => { d.ignoreBots = v; })} />
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : "No changes to save."}</span>
        <button className="btn ghost small" disabled={saving || !dirty} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
        <button className="btn primary small" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}
