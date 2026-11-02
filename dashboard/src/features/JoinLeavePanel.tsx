import { useEffect, useState } from "react";
import { type JoinLeaveResponse, type JoinLeaveSettings, PLACEHOLDERS } from "../../../src/shared/joinLeave";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];
type Draft = JoinLeaveSettings;

/** Dashboard section for Join & leave messages: a welcome box and a goodbye box. */
export function JoinLeavePanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<JoinLeaveResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: JoinLeaveResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.joinLeave(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading join &amp; leave messages…</p>;

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
      load(await api.saveJoinLeave(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel join-leave">
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

      <section className="sub half">
        <Toggle
          label="Welcome message"
          hint="Greet new members in a channel."
          checked={draft.welcome.enabled}
          onChange={(v) => set((d) => { d.welcome.enabled = v; })}
        />
        {draft.welcome.enabled && (
          <div className="sub-body">
            <label className="field">
              <span>Channel</span>
              <ChannelSelect guild={guild} value={draft.welcome.channelId} emptyLabel="Server's system channel" onChange={(v) => set((d) => { d.welcome.channelId = v; })} />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea rows={3} maxLength={1800} value={draft.welcome.message} onChange={(e) => set((d) => { d.welcome.message = e.target.value; })} />
              <Placeholders />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.welcome.useEmbed} onChange={(e) => set((d) => { d.welcome.useEmbed = e.target.checked; })} />
              <span><strong>Show as a card</strong><small className="muted">A pink card with the member's avatar instead of plain text.</small></span>
            </label>
          </div>
        )}
        <Toggle
          label="Welcome DM"
          hint="Also send new members a private welcome. Some members block DMs; they simply won't get it."
          checked={draft.welcome.dmEnabled}
          onChange={(v) => set((d) => { d.welcome.dmEnabled = v; })}
        />
        {draft.welcome.dmEnabled && (
          <div className="sub-body">
            <label className="field">
              <span>DM message</span>
              <textarea rows={2} maxLength={1800} value={draft.welcome.dmMessage} onChange={(e) => set((d) => { d.welcome.dmMessage = e.target.value; })} />
              <Placeholders />
            </label>
          </div>
        )}
      </section>

      <section className="sub half">
        <Toggle
          label="Goodbye message"
          hint="Post a message when someone leaves."
          checked={draft.goodbye.enabled}
          onChange={(v) => set((d) => { d.goodbye.enabled = v; })}
        />
        {draft.goodbye.enabled && (
          <div className="sub-body">
            <label className="field">
              <span>Channel</span>
              <ChannelSelect guild={guild} value={draft.goodbye.channelId} emptyLabel="Server's system channel" onChange={(v) => set((d) => { d.goodbye.channelId = v; })} />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea rows={2} maxLength={1800} value={draft.goodbye.message} onChange={(e) => set((d) => { d.goodbye.message = e.target.value; })} />
              <Placeholders />
            </label>
          </div>
        )}
      </section>

      <p className="muted small">Bots are never welcomed or said goodbye to. While Anti-raid's raid mode is on, nobody is, so raiders don't flood these channels.</p>

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

function Placeholders() {
  return (
    <small className="muted">
      You can use{" "}
      {PLACEHOLDERS.map((p, i) => (
        <span key={p.key} title={p.means}>
          <code>{p.key}</code>
          {i < PLACEHOLDERS.length - 1 ? " " : ""}
        </span>
      ))}
    </small>
  );
}
