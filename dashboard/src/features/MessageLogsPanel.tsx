import { useEffect, useState } from "react";
import {
  MAX_LOG_IGNORED_CHANNELS,
  MAX_LOG_IGNORED_ROLES,
  type MessageLogResponse,
  type MessageLogSettings,
} from "../../../src/shared/messageLogs";
import { type GuildDetails, api } from "../api";
import { ChannelPicker, ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

/** Dashboard section for Message logs: log channel, what to log, and what to skip. */
export function MessageLogsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<MessageLogResponse | null>(null);
  const [draft, setDraft] = useState<MessageLogSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: MessageLogResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.messageLogs(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading message logs…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: MessageLogSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveMessageLogs(guild.id, draft));
      setNotice("Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel message-logs">
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
        <div className="sub-head">
          <strong>Log channel</strong>
          <small className="muted">Keep it private to staff: logs show what deleted and edited messages said.</small>
        </div>
        <div className="sub-body">
          <ChannelSelect guild={guild} value={draft.channelId} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.channelId = v; })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head"><strong>What to log</strong></div>
        <div className="sub-body msglog-options">
          <Toggle label="✏️ Edited messages" hint="What it said before and after, with a link to the message." checked={draft.edits} onChange={(v) => set((d) => { d.edits = v; })} />
          <Toggle label="🗑️ Deleted messages" hint="What it said, who sent it, and any files it had." checked={draft.deletes} onChange={(v) => set((d) => { d.deletes = v; })} />
          <Toggle
            label="🧹 Bulk deletes"
            hint="Purges and other mass deletes: one log with a text file of every message."
            checked={draft.bulkDeletes}
            onChange={(v) => set((d) => { d.bulkDeletes = v; })}
          />
          <small className="muted">
            I remember recent messages, so I can show what they said. Messages sent before I last restarted are logged without their text.
          </small>
        </div>
      </section>

      <section className="sub">
        <div className="sub-head"><strong>Don't log</strong></div>
        <div className="sub-body msglog-options">
          <Toggle label="Bots and webhooks" checked={draft.ignoreBots} onChange={(v) => set((d) => { d.ignoreBots = v; })} />
          <div className="field">
            <span>These channels (or whole categories)</span>
            <ChannelPicker guild={guild} value={draft.ignoredChannelIds} max={MAX_LOG_IGNORED_CHANNELS} onChange={(v) => set((d) => { d.ignoredChannelIds = v; })} />
          </div>
          <div className="field">
            <span>Members with these roles</span>
            <RolePicker guild={guild} anyRole value={draft.ignoredRoleIds} max={MAX_LOG_IGNORED_ROLES} onChange={(v) => set((d) => { d.ignoredRoleIds = v; })} />
          </div>
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
