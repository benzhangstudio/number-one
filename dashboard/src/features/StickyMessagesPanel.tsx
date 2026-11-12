import { useEffect, useState } from "react";
import { MAX_STICKIES, STICKY_LIMITS, type StickiesResponse, type StickyInput, type StickyView } from "../../../src/shared/stickyMessages";
import { type GuildDetails, api } from "../api";
import { DiscordText } from "../components/DiscordText";
import { NumberInput } from "../components/NumberInput";
import { ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const blankSticky = (channelId: string): StickyInput => ({
  channelId,
  embed: false,
  title: "",
  text: "",
  color: "#ff4fa3",
  afterMessages: 1,
  delaySeconds: 10,
});

const toInput = (s: StickyView): StickyInput => ({
  channelId: s.channelId,
  embed: s.embed,
  title: s.title,
  text: s.text,
  color: s.color,
  afterMessages: s.afterMessages,
  delaySeconds: s.delaySeconds,
});

/** Dashboard section for Sticky messages: the list, pause/resume, and the editor. */
export function StickyMessagesPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<StickiesResponse | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; input: StickyInput } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = () => api.stickies(guild.id).then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading sticky messages…</p>;

  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel";
  const used = new Set(data.stickies.map((s) => s.channelId));
  const firstFree = guild.channels.find((c) => (c.type === 0 || c.type === 5) && !used.has(c.id))?.id ?? "";

  if (editing) {
    return (
      <StickyEditor
        guild={guild}
        id={editing.id}
        initial={editing.input}
        taken={used}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setNotice("Sticky message saved and posted.");
          void reload();
        }}
      />
    );
  }

  const act = async (s: StickyView, run: () => Promise<unknown>, done: string) => {
    setBusy(s.id);
    setError("");
    try {
      await run();
      setNotice(done);
      void reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel events">
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
      {error && <p className="error">{error}</p>}

      <div className="evt-head">
        <p className="muted small">
          A sticky message stays at the bottom of its channel. After new messages, Number One posts it again and deletes the old copy. One per channel. You can
          also use <code>/sticky set</code> in Discord. {data.stickies.length}/{MAX_STICKIES} used.
        </p>
        <button
          className="btn primary small"
          disabled={data.stickies.length >= MAX_STICKIES}
          onClick={() => setEditing({ id: null, input: blankSticky(firstFree) })}
        >
          New sticky message
        </button>
      </div>

      {data.stickies.length === 0 ? (
        <div className="card"><p className="muted">No sticky messages yet. Try one with your rules, a how-to, or "Please keep this channel on topic".</p></div>
      ) : (
        <ul className="evt-list">
          {data.stickies.map((s) => (
            <li key={s.id} className="card evt-item">
              <span className="evt-swatch" style={{ background: s.paused ? "var(--border)" : s.embed ? s.color : "var(--muted)" }} />
              <div className="evt-item-text">
                <strong>📌 #{channelName(s.channelId)}{s.paused ? " (paused)" : ""}</strong>
                <span className="small">{(s.title || s.text).replace(/\s+/g, " ").slice(0, 140)}{(s.title || s.text).length > 140 ? "…" : ""}</span>
                <span className="muted small">
                  {s.embed ? "Embed" : "Plain text"} · reposts after {s.afterMessages === 1 ? "every message" : plural(s.afterMessages, "message")}, at most every {plural(s.delaySeconds, "second")} · by {s.createdByTag}
                </span>
              </div>
              <div className="evt-actions">
                {s.url && <a className="btn ghost small" href={s.url} target="_blank" rel="noreferrer">Open</a>}
                <button className="btn ghost small" onClick={() => setEditing({ id: s.id, input: toInput(s) })}>Edit</button>
                <button
                  className="btn ghost small"
                  disabled={busy === s.id}
                  title={s.paused ? "Post it again and keep it at the bottom" : "Take it down for now, but keep it saved"}
                  onClick={() => void act(s, () => api.pauseSticky(guild.id, s.id, !s.paused), s.paused ? "Sticky message resumed." : "Sticky message paused.")}
                >
                  {s.paused ? "Resume" : "Pause"}
                </button>
                <button
                  className="btn danger small"
                  disabled={busy === s.id}
                  onClick={() => {
                    if (confirm(`Delete the sticky message in #${channelName(s.channelId)}? The posted copy is deleted too.`)) {
                      void act(s, () => api.deleteSticky(guild.id, s.id), "Sticky message deleted.");
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ editor */

function StickyEditor({
  guild,
  id,
  initial,
  taken,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: number | null;
  initial: StickyInput;
  taken: Set<string>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState<StickyInput>(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<StickyInput>) => setD((x) => ({ ...x, ...patch }));

  const limit = d.embed ? STICKY_LIMITS.embedText : STICKY_LIMITS.text;
  const problem =
    (!d.channelId ? "Pick a channel." : null) ??
    (d.channelId !== initial.channelId && taken.has(d.channelId) ? "That channel already has a sticky message. Edit that one instead." : null) ??
    (!d.text.trim() ? "Write the message." : null) ??
    (d.text.trim().length > limit ? `Messages can be up to ${limit} characters${d.embed ? "" : " (or 4000 as an embed)"}.` : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (id === null) await api.createSticky(guild.id, d);
      else await api.updateSticky(guild.id, id, d);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel events evt-editor">
      <div className="evt-form">
        <label className="field">
          <span>Channel</span>
          <ChannelSelect guild={guild} value={d.channelId || null} onChange={(v) => set({ channelId: v ?? "" })} />
        </label>
        <Toggle label="Post as an embed" hint="A coloured box with an optional title. Allows longer messages." checked={d.embed} onChange={(v) => set({ embed: v })} />
        {d.embed && (
          <div className="mod-row">
            <label className="field">
              <span>Title (optional)</span>
              <input value={d.title} maxLength={STICKY_LIMITS.title} placeholder="e.g. 📜 Channel rules" onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className="field evt-color">
              <span>Colour</span>
              <input type="color" value={d.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
          </div>
        )}
        <label className="field">
          <span>Message <small className="muted">({d.text.length}/{limit})</small></span>
          <textarea
            rows={6}
            maxLength={STICKY_LIMITS.embedText}
            value={d.text}
            placeholder="What should stay at the bottom of the channel? Markdown, emojis and mentions work. Mentions won't ping anyone."
            onChange={(e) => set({ text: e.target.value })}
          />
        </label>
        <div className="mod-row">
          <label className="field">
            <span>Repost after this many messages</span>
            <NumberInput value={d.afterMessages} min={1} max={STICKY_LIMITS.maxAfter} onChange={(v) => set({ afterMessages: v })} />
            <small className="muted">1 keeps it at the very bottom. Higher numbers repost less often.</small>
          </label>
          <label className="field">
            <span>Wait between reposts (seconds)</span>
            <NumberInput value={d.delaySeconds} min={5} max={STICKY_LIMITS.maxDelay} onChange={(v) => set({ delaySeconds: v })} />
            <small className="muted">Stops busy channels from filling up with reposts.</small>
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="evt-buttons">
          <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
            {saving ? "Posting…" : id === null ? "Post sticky message" : "Save and repost"}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>

      <div className="evt-preview-wrap">
        <div className="muted small">Preview</div>
        <div className="evt-preview">
          <div className="evt-preview-author">
            <span className="evt-preview-avatar">1</span>
            <strong>Number One</strong>
            <span className="evt-preview-bot">APP</span>
          </div>
          {d.embed ? (
            <div className="evt-preview-embed" style={{ borderLeftColor: d.color }}>
              {d.title.trim() && <div className="evt-preview-title">{d.title}</div>}
              <div className="evt-preview-desc"><DiscordText text={d.text || "Your message"} guild={guild} /></div>
              <div className="evt-preview-footer">📌 Sticky message</div>
            </div>
          ) : (
            <div className="evt-preview-desc"><DiscordText text={d.text || "Your message"} guild={guild} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
