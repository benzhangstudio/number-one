import { useEffect, useState } from "react";
import { MAX_VOICE_IGNORED, type VoiceLogResponse, type VoiceLogSettings } from "../../../src/shared/voiceLogs";
import { type GuildDetails, api } from "../api";
import { ChannelPicker, ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

/** Dashboard section for Voice logs: log channel, what to log, and what to skip. */
export function VoiceLogsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<VoiceLogResponse | null>(null);
  const [draft, setDraft] = useState<VoiceLogSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: VoiceLogResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.voiceLogs(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading voice logs…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: VoiceLogSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveVoiceLogs(guild.id, draft));
      setNotice("Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel voice-logs">
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
        <div className="sub-body vclog-options">
          <Toggle label="🔊 Joins" checked={draft.joins} onChange={(v) => set((d) => { d.joins = v; })} />
          <Toggle label="🔇 Leaves" hint="With how long they stayed." checked={draft.leaves} onChange={(v) => set((d) => { d.leaves = v; })} />
          <Toggle label="🔀 Moves between channels" checked={draft.moves} onChange={(v) => set((d) => { d.moves = v; })} />
          <Toggle label="🙉 Server mutes and deafens" hint="Done by staff, not people muting themselves." checked={draft.serverMutes} onChange={(v) => set((d) => { d.serverMutes = v; })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head"><strong>Don't log</strong></div>
        <div className="sub-body vclog-options">
          <Toggle label="Bots" checked={draft.ignoreBots} onChange={(v) => set((d) => { d.ignoreBots = v; })} />
          <div className="field">
            <span>These voice channels (or whole categories)</span>
            <ChannelPicker guild={guild} value={draft.ignoredChannelIds} max={MAX_VOICE_IGNORED} onChange={(v) => set((d) => { d.ignoredChannelIds = v; })} />
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
