import { useEffect, useState } from "react";
import {
  EMBED_LIMITS,
  type EmbedData,
  type EmbedMessageInput,
  type EmbedMessageView,
  MAX_EMBED_MESSAGES,
  blankEmbed,
  embedLength,
  embedMessageProblem,
} from "../../../src/shared/embeds";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

/**
 * Dashboard section for Embed messages: a list of posted messages, and a builder with a live preview.
 * The builder here belongs to this feature only.
 */
export function EmbedsPanel({ guild }: { guild: Guild }) {
  const [messages, setMessages] = useState<EmbedMessageView[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: EmbedMessageInput } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = () => api.embeds(guild.id).then(setMessages).catch((err) => setError(err.message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  if (error && !messages) return <p className="error panel">{error}</p>;
  if (!messages) return <p className="muted panel">Loading embed messages…</p>;

  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel";
  const firstChannel = guild.channels.find((c) => c.type === 0)?.id ?? "";

  if (editing) {
    return (
      <EmbedMessageEditor
        guild={guild}
        id={editing.id}
        initial={editing.draft}
        onCancel={() => setEditing(null)}
        onSaved={(view, wasNew) => {
          setEditing(null);
          setNotice(wasNew ? "Posted." : "Saved. The message in Discord is updated.");
          void reload();
          void view;
        }}
      />
    );
  }

  const remove = async (m: EmbedMessageView) => {
    if (!confirm(`Delete "${label(m)}"? The message is deleted from Discord too.`)) return;
    try {
      await api.deleteEmbed(guild.id, m.messageId);
      setMessages(messages.filter((x) => x.messageId !== m.messageId));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="panel embeds">
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      <div className="emb-head">
        <p className="muted small">
          Build a message with up to {EMBED_LIMITS.embeds} embeds and Number One posts it. Edit it here anytime and the message in Discord
          changes too. {messages.length}/{MAX_EMBED_MESSAGES} used.
        </p>
        <button
          className="btn primary small"
          disabled={messages.length >= MAX_EMBED_MESSAGES}
          onClick={() => setEditing({ id: null, draft: { name: "", channelId: firstChannel, content: "", embeds: [blankEmbed()] } })}
        >
          New embed message
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {messages.length === 0 ? (
        <div className="card emb-empty">
          <p className="muted">No embed messages yet. Make one for rules, info pages, FAQs or anything else.</p>
        </div>
      ) : (
        <ul className="emb-list">
          {messages.map((m) => (
            <li key={m.messageId} className="card emb-item">
              <span className="emb-swatch" style={{ background: m.embeds[0]?.color ?? "var(--border)" }} />
              <div className="emb-item-text">
                <strong>{label(m)}</strong>
                <span className="muted small">
                  #{channelName(m.channelId)} · {m.embeds.length} embed{m.embeds.length === 1 ? "" : "s"} · edited {new Date(m.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="emb-actions">
                <a className="btn ghost small" href={m.url} target="_blank" rel="noreferrer">Open</a>
                <button className="btn ghost small" onClick={() => setEditing({ id: m.messageId, draft: { name: m.name, channelId: m.channelId, content: m.content, embeds: m.embeds } })}>
                  Edit
                </button>
                <button className="btn danger small" onClick={() => remove(m)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const label = (m: EmbedMessageInput) => m.name || m.embeds.find((e) => e.title)?.title || m.content.slice(0, 60) || "Untitled message";

/* ------------------------------------------------------------ message editor */

function EmbedMessageEditor({
  guild,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: string | null;
  initial: EmbedMessageInput;
  onCancel: () => void;
  onSaved: (view: EmbedMessageView, wasNew: boolean) => void;
}) {
  const [draft, setDraft] = useState<EmbedMessageInput>(structuredClone(initial));
  const [open, setOpen] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (fn: (d: EmbedMessageInput) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const setEmbed = (i: number, fn: (e: EmbedData) => void) => set((d) => fn(d.embeds[i]));
  const total = draft.embeds.reduce((n, e) => n + embedLength(e), 0);
  const problem = embedMessageProblem(draft);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const view = id ? await api.updateEmbed(guild.id, id, draft) : await api.createEmbed(guild.id, draft);
      onSaved(view, !id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const move = (i: number, by: number) =>
    set((d) => {
      const [e] = d.embeds.splice(i, 1);
      d.embeds.splice(i + by, 0, e);
    });

  return (
    <div className="panel embeds emb-editor">
      <div className="emb-form">
        <div className="mod-row">
          <label className="field">
            <span>Name (only shown here)</span>
            <input value={draft.name} maxLength={100} placeholder="e.g. Rules" onChange={(e) => set((d) => { d.name = e.target.value; })} />
          </label>
          <label className="field">
            <span>Channel</span>
            <ChannelSelect guild={guild} value={draft.channelId || null} onChange={(v) => set((d) => { d.channelId = v ?? ""; })} />
          </label>
        </div>
        <label className="field">
          <span>
            Text above the embeds <small className="muted">({draft.content.length}/{EMBED_LIMITS.content})</small>
          </span>
          <textarea rows={2} maxLength={EMBED_LIMITS.content} value={draft.content} onChange={(e) => set((d) => { d.content = e.target.value; })} />
          <small className="muted">Mentions show up but never ping anyone.</small>
        </label>

        {draft.embeds.map((e, i) => (
          <section key={i} className="sub emb-embed">
            <div className="emb-embed-head">
              <button className="link" onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="emb-swatch" style={{ background: e.color }} /> Embed {i + 1}
                {e.title ? `: ${e.title}` : ""} {open === i ? "▾" : "▸"}
              </button>
              <span className="emb-embed-tools">
                <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                <button className="btn ghost small" disabled={i === draft.embeds.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
                <button className="btn danger small" onClick={() => set((d) => { d.embeds.splice(i, 1); })}>Remove</button>
              </span>
            </div>
            {open === i && <EmbedFields embed={e} update={(fn) => setEmbed(i, fn)} />}
          </section>
        ))}
        <div className="emb-add">
          <button
            className="btn ghost small"
            disabled={draft.embeds.length >= EMBED_LIMITS.embeds}
            onClick={() => {
              set((d) => { d.embeds.push(blankEmbed()); });
              setOpen(draft.embeds.length);
            }}
          >
            + Add embed
          </button>
          <small className={total > EMBED_LIMITS.total ? "error" : "muted"}>
            {total.toLocaleString()}/{EMBED_LIMITS.total.toLocaleString()} characters across all embeds
          </small>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="emb-buttons">
          <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="btn primary small" disabled={saving || Boolean(problem) || !draft.channelId} title={problem ?? undefined} onClick={save}>
            {saving ? "Saving…" : id ? "Save changes" : "Post message"}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>

      <div className="emb-preview-wrap">
        <div className="muted small">Preview</div>
        <EmbedsPreview content={draft.content} embeds={draft.embeds} />
      </div>
    </div>
  );
}

/** Every field of one embed. */
function EmbedFields({ embed: e, update }: { embed: EmbedData; update: (fn: (e: EmbedData) => void) => void }) {
  const text = (label: string, value: string, max: number, apply: (e: EmbedData, v: string) => void, placeholder?: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={value} maxLength={max} placeholder={placeholder} onChange={(ev) => update((x) => apply(x, ev.target.value))} />
    </label>
  );
  return (
    <div className="sub-body emb-fields">
      <div className="mod-row">
        <label className="field emb-color">
          <span>Colour</span>
          <input type="color" value={e.color} onChange={(ev) => update((x) => { x.color = ev.target.value; })} />
        </label>
        {text("Title", e.title, EMBED_LIMITS.title, (x, v) => { x.title = v; })}
        {text("Title link", e.url, 1000, (x, v) => { x.url = v; }, "https://…")}
      </div>
      <label className="field">
        <span>
          Description <small className="muted">({e.description.length}/{EMBED_LIMITS.description})</small>
        </span>
        <textarea rows={5} maxLength={EMBED_LIMITS.description} value={e.description} onChange={(ev) => update((x) => { x.description = ev.target.value; })} />
        <small className="muted">Discord formatting works: **bold**, *italic*, [links](https://…), lists and more.</small>
      </label>

      <div className="emb-fieldlist">
        <span className="small"><strong>Fields</strong> <span className="muted">({e.fields.length}/{EMBED_LIMITS.fields})</span></span>
        {e.fields.map((f, i) => (
          <div key={i} className="emb-fieldrow">
            <input value={f.name} maxLength={EMBED_LIMITS.fieldName} placeholder="Name" onChange={(ev) => update((x) => { x.fields[i].name = ev.target.value; })} />
            <textarea rows={2} value={f.value} maxLength={EMBED_LIMITS.fieldValue} placeholder="Value" onChange={(ev) => update((x) => { x.fields[i].value = ev.target.value; })} />
            <label className="check small">
              <input type="checkbox" checked={f.inline} onChange={(ev) => update((x) => { x.fields[i].inline = ev.target.checked; })} />
              <span>Side by side</span>
            </label>
            <button className="btn danger small" onClick={() => update((x) => { x.fields.splice(i, 1); })}>Remove</button>
          </div>
        ))}
        <button
          className="btn ghost small"
          disabled={e.fields.length >= EMBED_LIMITS.fields}
          onClick={() => update((x) => { x.fields.push({ name: "", value: "", inline: false }); })}
        >
          + Add field
        </button>
      </div>

      <div className="mod-row">
        {text("Author", e.authorName, EMBED_LIMITS.author, (x, v) => { x.authorName = v; })}
        {text("Author icon", e.authorIcon, 1000, (x, v) => { x.authorIcon = v; }, "https://…")}
        {text("Author link", e.authorUrl, 1000, (x, v) => { x.authorUrl = v; }, "https://…")}
      </div>
      <div className="mod-row">
        {text("Big image", e.image, 1000, (x, v) => { x.image = v; }, "https://…")}
        {text("Small image (top right)", e.thumbnail, 1000, (x, v) => { x.thumbnail = v; }, "https://…")}
      </div>
      <div className="mod-row">
        {text("Footer", e.footerText, EMBED_LIMITS.footer, (x, v) => { x.footerText = v; })}
        {text("Footer icon", e.footerIcon, 1000, (x, v) => { x.footerIcon = v; }, "https://…")}
      </div>
      <Toggle label="Show the time" hint="Adds the time it was posted (or last edited) next to the footer." checked={e.timestamp} onChange={(v) => update((x) => { x.timestamp = v; })} />
    </div>
  );
}

/** A Discord-style preview of the message. */
function EmbedsPreview({ content, embeds }: { content: string; embeds: EmbedData[] }) {
  return (
    <div className="emb-preview">
      <div className="emb-preview-author">
        <span className="emb-preview-avatar">1</span>
        <strong>Number One</strong>
        <span className="emb-preview-bot">APP</span>
      </div>
      {content.trim() && <div className="emb-preview-content">{content}</div>}
      {embeds.map((e, i) => (
        <div key={i} className="emb-preview-embed" style={{ borderLeftColor: e.color }}>
          <div className="emb-preview-main">
            {e.authorName && (
              <div className="emb-preview-embauthor">
                {e.authorIcon && <img src={e.authorIcon} alt="" />}
                {e.authorName}
              </div>
            )}
            {e.title && <div className={`emb-preview-title ${e.url ? "linked" : ""}`}>{e.title}</div>}
            {e.description.trim() && <div className="emb-preview-desc">{e.description}</div>}
            {e.fields.length > 0 && (
              <div className="emb-preview-fields">
                {e.fields.map((f, j) => (
                  <div key={j} className={f.inline ? "inline" : ""}>
                    <strong>{f.name || "Name"}</strong>
                    <span>{f.value || "Value"}</span>
                  </div>
                ))}
              </div>
            )}
            {e.image && <img className="emb-preview-image" src={e.image} alt="" />}
            {(e.footerText || e.timestamp) && (
              <div className="emb-preview-footer">
                {e.footerIcon && <img src={e.footerIcon} alt="" />}
                {[e.footerText, e.timestamp ? "Today" : ""].filter(Boolean).join(" • ")}
              </div>
            )}
          </div>
          {e.thumbnail && <img className="emb-preview-thumb" src={e.thumbnail} alt="" />}
        </div>
      ))}
    </div>
  );
}
