import { useEffect, useState } from "react";
import type { ServerLogResponse, ServerLogSettings } from "../../../src/shared/serverLogs";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

/** Dashboard section for Server logs: log channel and what to log. */
export function ServerLogsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<ServerLogResponse | null>(null);
  const [draft, setDraft] = useState<ServerLogSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: ServerLogResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.serverLogs(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading server logs…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: ServerLogSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveServerLogs(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel server-logs">
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
        <div className="sub-head"><strong>What to log</strong><small className="muted">Each log shows who made the change.</small></div>
        <div className="sub-body srvlog-options">
          <Toggle label="📁 Channels" hint="Created, deleted, renamed, moved, topic, slowmode and permission changes." checked={draft.channels} onChange={(v) => set((d) => { d.channels = v; })} />
          <Toggle label="🎭 Roles" hint="Created, deleted, and changes to name, colour and permissions." checked={draft.roles} onChange={(v) => set((d) => { d.roles = v; })} />
          <Toggle label="⚙️ Server settings" hint="Name, icon, verification level, system channel and more." checked={draft.server} onChange={(v) => set((d) => { d.server = v; })} />
          <Toggle label="😀 Emojis and stickers" checked={draft.emojis} onChange={(v) => set((d) => { d.emojis = v; })} />
          <Toggle label="🔗 Invites" hint="Created and deleted, with who made them." checked={draft.invites} onChange={(v) => set((d) => { d.invites = v; })} />
          <Toggle
            label="Skip Number One's own changes"
            hint="For example, channel designs renaming channels."
            checked={draft.skipOwnChanges}
            onChange={(v) => set((d) => { d.skipOwnChanges = v; })}
          />
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {dirty && (
        <div className="save-bar">
          <span>You have unsaved changes.</span>
          <button className="btn ghost small" disabled={saving} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
          <button className="btn primary small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </div>
  );
}
