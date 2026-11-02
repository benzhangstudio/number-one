import { useEffect, useState } from "react";
import {
  ANNOUNCEMENT_LIMITS,
  type AnnouncementEmbed,
  type AnnouncementMessage,
  type AnnouncementPing,
  type AnnouncementView,
  type AnnouncementsResponse,
  MAX_SCHEDULE_DAYS,
  MAX_TEMPLATES,
  type PingType,
  type TemplateInput,
  type TemplateView,
  messageProblem,
} from "../../../src/shared/announcements";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

/** What's being written: a new announcement, a scheduled one being changed, or a sent one being corrected. */
interface Compose {
  /** Saved announcement being changed, if any. */
  id: number | null;
  /** A sent announcement: only its text and embed can change. */
  sent: boolean;
  channelId: string;
  message: AnnouncementMessage;
  ping: AnnouncementPing;
  publish: boolean;
  later: boolean;
  /** datetime-local value, in the viewer's time zone. */
  at: string;
}

const blankEmbed = (): AnnouncementEmbed => ({
  color: "#ff4fa3",
  authorName: "",
  authorIcon: "",
  title: "",
  url: "",
  description: "",
  fields: [],
  image: "",
  thumbnail: "",
  footerText: "",
  timestamp: true,
});
const blankMessage = (): AnnouncementMessage => ({ content: "", useEmbed: true, embed: blankEmbed() });
const noPing = (): AnnouncementPing => ({ type: "none", roleIds: [] });

/** Ready-made starting points, offered alongside the server's own templates. */
const STARTERS: { name: string; emoji: string; message: () => AnnouncementMessage; ping: PingType }[] = [
  {
    name: "Server update",
    emoji: "🆕",
    ping: "none",
    message: () => ({
      ...blankMessage(),
      embed: { ...blankEmbed(), title: "🆕 Server update", description: "Here's what's new:\n\n• \n• \n• ", footerText: "Thanks for being here!" },
    }),
  },
  {
    name: "Event",
    emoji: "🎉",
    ping: "everyone",
    message: () => ({
      ...blankMessage(),
      embed: {
        ...blankEmbed(),
        color: "#5865f2",
        title: "🎉 Event: ",
        description: "Join us for …",
        fields: [
          { name: "📅 When", value: "", inline: true },
          { name: "📍 Where", value: "", inline: true },
        ],
      },
    }),
  },
  {
    name: "Maintenance",
    emoji: "🛠️",
    ping: "here",
    message: () => ({
      ...blankMessage(),
      embed: {
        ...blankEmbed(),
        color: "#ffc46b",
        title: "🛠️ Planned maintenance",
        description: "Some things may not work for a while.",
        fields: [
          { name: "Starts", value: "", inline: true },
          { name: "Expected to last", value: "", inline: true },
        ],
      },
    }),
  },
  {
    name: "Rules update",
    emoji: "📜",
    ping: "everyone",
    message: () => ({
      ...blankMessage(),
      embed: { ...blankEmbed(), color: "#ff6b6b", title: "📜 Rules update", description: "We've changed the rules. Please read them again.\n\n**What changed:**\n• " },
    }),
  },
];

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const inAnHour = () => toLocalInput(Math.ceil((Date.now() + 3_600_000) / 900_000) * 900_000);
const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const pingLabel: Record<PingType, string> = { none: "No ping", everyone: "@everyone", here: "@here", roles: "Roles…" };

/** Dashboard section for Announcements: write and send, templates, and history. */
export function AnnouncementsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<AnnouncementsResponse | null>(null);
  const [tab, setTab] = useState<"write" | "templates" | "history">("write");
  const [compose, setCompose] = useState<Compose | null>(null);
  const [template, setTemplate] = useState<{ id: number | null; draft: TemplateInput } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = () => api.announcements(guild.id).then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading announcements…</p>;

  const firstChannel =
    guild.channels.find((c) => c.type === 5)?.id ?? guild.channels.find((c) => c.type === 0)?.id ?? "";
  const startFrom = (message: AnnouncementMessage, ping: AnnouncementPing, channelId: string | null) =>
    setCompose({ id: null, sent: false, channelId: channelId ?? firstChannel, message, ping, publish: false, later: false, at: inAnHour() });
  const channelName = (id: string | null) => (id ? `#${guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel"}` : "Choose each time");
  const scheduled = data.announcements.filter((a) => a.status === "scheduled");
  const done = data.announcements.filter((a) => a.status !== "scheduled");

  const tabs = (
    <div className="ann-tabs">
      {(
        [
          ["write", "Write"],
          ["templates", `Templates (${data.templates.length})`],
          ["history", scheduled.length ? `Scheduled & sent (${scheduled.length} waiting)` : "Sent"],
        ] as const
      ).map(([id, name]) => (
        <button key={id} className={`ann-tab ${tab === id ? "on" : ""}`} onClick={() => { setTab(id); setCompose(null); setTemplate(null); }}>
          {name}
        </button>
      ))}
    </div>
  );

  const banner = (
    <>
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );

  if (compose) {
    return (
      <div className="panel announcements">
        {tabs}
        <Composer
          guild={guild}
          initial={compose}
          onCancel={() => setCompose(null)}
          onSaveTemplate={(draft) => {
            setCompose(null);
            setTab("templates");
            setTemplate({ id: null, draft });
          }}
          onDone={(view) => {
            setCompose(null);
            setNotice(view.status === "scheduled" ? `Scheduled for ${when(view.scheduledAt!)}.` : compose.id ? "Saved." : "Sent.");
            setTab("history");
            void reload();
          }}
        />
      </div>
    );
  }

  if (template) {
    return (
      <div className="panel announcements">
        {tabs}
        <TemplateEditor
          guild={guild}
          id={template.id}
          initial={template.draft}
          onCancel={() => setTemplate(null)}
          onSaved={() => {
            setTemplate(null);
            setNotice("Template saved.");
            void reload();
          }}
        />
      </div>
    );
  }

  const removeAnnouncement = async (a: AnnouncementView) => {
    const what = a.status === "scheduled" ? "Cancel this scheduled announcement?" : a.url ? "Delete this announcement? It's deleted from Discord too." : "Remove this from the list?";
    if (!confirm(what)) return;
    try {
      await api.deleteAnnouncement(guild.id, a.id);
      void reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeTemplate = async (t: TemplateView) => {
    if (!confirm(`Delete the template "${t.name}"?`)) return;
    try {
      await api.deleteAnnouncementTemplate(guild.id, t.id);
      void reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="panel announcements">
      {tabs}
      {banner}

      {tab === "write" && (
        <>
          <p className="muted small">Pick a starting point. You can change everything before sending.</p>
          <div className="ann-starters">
            <button className="card ann-starter" onClick={() => startFrom(blankMessage(), noPing(), null)}>
              <span className="ann-starter-emoji">✏️</span>
              <strong>Blank</strong>
              <span className="muted small">Start from scratch</span>
            </button>
            {data.templates.map((t) => (
              <button key={t.id} className="card ann-starter" onClick={() => startFrom(structuredClone(t.message), structuredClone(t.ping), t.channelId)}>
                <span className="ann-starter-emoji" style={{ color: t.message.embed.color }}>●</span>
                <strong>{t.name}</strong>
                <span className="muted small">Your template</span>
              </button>
            ))}
            {STARTERS.map((s) => (
              <button key={s.name} className="card ann-starter" onClick={() => startFrom(s.message(), { type: s.ping, roleIds: [] }, null)}>
                <span className="ann-starter-emoji">{s.emoji}</span>
                <strong>{s.name}</strong>
                <span className="muted small">Starter</span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === "templates" && (
        <>
          <div className="ann-head">
            <p className="muted small">Save announcements you post often, with their channel and ping. {data.templates.length}/{MAX_TEMPLATES} used.</p>
            <button
              className="btn primary small"
              disabled={data.templates.length >= MAX_TEMPLATES}
              onClick={() => setTemplate({ id: null, draft: { name: "", channelId: null, message: blankMessage(), ping: noPing() } })}
            >
              New template
            </button>
          </div>
          {data.templates.length === 0 ? (
            <div className="card"><p className="muted">No templates yet. Make one here, or use "Save as template" while writing.</p></div>
          ) : (
            <ul className="ann-list">
              {data.templates.map((t) => (
                <li key={t.id} className="card ann-item">
                  <span className="ann-swatch" style={{ background: t.message.useEmbed ? t.message.embed.color : "var(--border)" }} />
                  <div className="ann-item-text">
                    <strong>{t.name}</strong>
                    <span className="muted small">{channelName(t.channelId)} · {pingLabel[t.ping.type]}</span>
                  </div>
                  <div className="ann-actions">
                    <button className="btn primary small" onClick={() => { setTab("write"); startFrom(structuredClone(t.message), structuredClone(t.ping), t.channelId); }}>Use</button>
                    <button className="btn ghost small" onClick={() => setTemplate({ id: t.id, draft: { name: t.name, channelId: t.channelId, message: t.message, ping: t.ping } })}>Edit</button>
                    <button className="btn danger small" onClick={() => removeTemplate(t)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          {scheduled.length > 0 && <h3 className="ann-group">Waiting to be sent</h3>}
          <ul className="ann-list">
            {scheduled.map((a) => (
              <li key={a.id} className="card ann-item">
                <span className="ann-swatch" style={{ background: a.message.useEmbed ? a.message.embed.color : "var(--border)" }} />
                <div className="ann-item-text">
                  <strong>{titleOf(a.message)}</strong>
                  <span className="muted small">⏰ {when(a.scheduledAt!)} · {channelName(a.channelId)} · {pingLabel[a.ping.type]} · by {a.createdByTag}</span>
                </div>
                <div className="ann-actions">
                  <button className="btn ghost small" onClick={() => setCompose(fromView(a))}>Edit</button>
                  <button className="btn danger small" onClick={() => removeAnnouncement(a)}>Cancel</button>
                </div>
              </li>
            ))}
          </ul>
          <h3 className="ann-group">Sent</h3>
          {done.length === 0 ? (
            <div className="card"><p className="muted">Nothing sent yet.</p></div>
          ) : (
            <ul className="ann-list">
              {done.map((a) => (
                <li key={a.id} className="card ann-item">
                  <span className="ann-swatch" style={{ background: a.message.useEmbed ? a.message.embed.color : "var(--border)" }} />
                  <div className="ann-item-text">
                    <strong>{titleOf(a.message)}</strong>
                    <span className="muted small">
                      {a.status === "failed" ? "❌ Not sent" : `✅ ${when(a.sentAt!)}`} · {channelName(a.channelId)} · {pingLabel[a.ping.type]} · by {a.createdByTag}
                    </span>
                    {a.error && <span className="error small">{a.error}</span>}
                  </div>
                  <div className="ann-actions">
                    {a.url && <a className="btn ghost small" href={a.url} target="_blank" rel="noreferrer">Open</a>}
                    {a.status === "sent" && <button className="btn ghost small" onClick={() => setCompose(fromView(a))}>Edit</button>}
                    {a.status === "failed" && <button className="btn ghost small" onClick={() => setCompose({ ...fromView(a), later: false })}>Try again</button>}
                    <button className="btn danger small" onClick={() => removeAnnouncement(a)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const titleOf = (m: AnnouncementMessage) => (m.useEmbed && m.embed.title) || m.content.slice(0, 80) || "Announcement";

function fromView(a: AnnouncementView): Compose {
  return {
    id: a.id,
    sent: a.status === "sent",
    channelId: a.channelId,
    message: structuredClone(a.message),
    ping: structuredClone(a.ping),
    publish: a.publish,
    later: a.status === "scheduled",
    at: a.scheduledAt ? toLocalInput(a.scheduledAt) : inAnHour(),
  };
}

/* ------------------------------------------------------------ composer */

function Composer({
  guild,
  initial,
  onCancel,
  onSaveTemplate,
  onDone,
}: {
  guild: Guild;
  initial: Compose;
  onCancel: () => void;
  onSaveTemplate: (draft: TemplateInput) => void;
  onDone: (view: AnnouncementView) => void;
}) {
  const [c, setC] = useState<Compose>(structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (d: Compose) => void) =>
    setC((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const isAnnouncementChannel = guild.channels.find((ch) => ch.id === c.channelId)?.type === 5;
  const scheduledAt = c.later ? new Date(c.at).getTime() : null;
  const timeProblem =
    c.later && !c.sent
      ? !Number.isFinite(scheduledAt)
        ? "Pick a date and time."
        : scheduledAt! < Date.now()
          ? "That time has already passed."
          : scheduledAt! > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000
            ? `Pick a time within ${MAX_SCHEDULE_DAYS} days.`
            : null
      : null;
  const problem =
    messageProblem(c.message) ??
    (!c.channelId ? "Pick a channel." : null) ??
    (c.ping.type === "roles" && !c.ping.roleIds.length ? "Pick at least one role to ping." : null) ??
    timeProblem;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body = { channelId: c.channelId, message: c.message, ping: c.ping, publish: c.publish && isAnnouncementChannel, scheduledAt };
      const view = c.sent
        ? await api.updateAnnouncement(guild.id, c.id!, { message: c.message })
        : c.id
          ? await api.updateAnnouncement(guild.id, c.id, body)
          : await api.createAnnouncement(guild.id, body);
      onDone(view);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const action = c.sent ? "Save changes" : c.later ? (c.id ? "Save schedule" : "Schedule") : "Send now";

  return (
    <div className="ann-editor">
      <div className="ann-form">
        {c.sent ? (
          <div className="notice"><span className="small">This was already sent. You can change the text and embed; the ping isn't sent again.</span></div>
        ) : (
          <>
            <div className="mod-row">
              <label className="field">
                <span>Channel</span>
                <ChannelSelect guild={guild} value={c.channelId || null} onChange={(v) => set((d) => { d.channelId = v ?? ""; })} />
              </label>
              <label className="field">
                <span>Ping</span>
                <select value={c.ping.type} onChange={(e) => set((d) => { d.ping.type = e.target.value as PingType; })}>
                  {(Object.keys(pingLabel) as PingType[]).map((p) => <option key={p} value={p}>{pingLabel[p]}</option>)}
                </select>
              </label>
            </div>
            {c.ping.type === "roles" && (
              <div className="field">
                <span>Roles to ping</span>
                <RolePicker guild={guild} anyRole value={c.ping.roleIds} max={ANNOUNCEMENT_LIMITS.pingRoles} onChange={(v) => set((d) => { d.ping.roleIds = v; })} />
              </div>
            )}
            {isAnnouncementChannel && (
              <Toggle
                label="Publish to following servers"
                hint="This is an announcement channel. Publishing also posts it in servers that follow the channel."
                checked={c.publish}
                onChange={(v) => set((d) => { d.publish = v; })}
              />
            )}
          </>
        )}

        <MessageFields message={c.message} update={(fn) => set((d) => fn(d.message))} />

        {!c.sent && (
          <section className="sub">
            <div className="mod-row ann-when">
              <label className="check">
                <input type="radio" checked={!c.later} onChange={() => set((d) => { d.later = false; })} />
                <span>Send now</span>
              </label>
              <label className="check">
                <input type="radio" checked={c.later} onChange={() => set((d) => { d.later = true; })} />
                <span>Send later</span>
              </label>
              {c.later && <input type="datetime-local" value={c.at} onChange={(e) => set((d) => { d.at = e.target.value; })} />}
            </div>
            {c.later && <small className="muted">Your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</small>}
          </section>
        )}

        {error && <p className="error">{error}</p>}
        <div className="ann-buttons">
          <button className="btn ghost small" disabled={busy} onClick={onCancel}>Cancel</button>
          {!c.sent && (
            <button
              className="btn ghost small"
              disabled={busy}
              onClick={() => onSaveTemplate({ name: titleOf(c.message).slice(0, 60), channelId: c.channelId || null, message: c.message, ping: c.ping })}
            >
              Save as template
            </button>
          )}
          <button className="btn primary small" disabled={busy || Boolean(problem)} title={problem ?? undefined} onClick={submit}>
            {busy ? "Working…" : action}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>
      <div className="ann-preview-wrap">
        <div className="muted small">Preview</div>
        <AnnouncementPreview guild={guild} message={c.message} ping={c.ping} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ template editor */

function TemplateEditor({
  guild,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: number | null;
  initial: TemplateInput;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [t, setT] = useState<TemplateInput>(structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (d: TemplateInput) => void) =>
    setT((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const problem = (!t.name.trim() ? "Give the template a name." : null) ?? messageProblem(t.message) ?? (t.ping.type === "roles" && !t.ping.roleIds.length ? "Pick at least one role to ping." : null);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (id) await api.updateAnnouncementTemplate(guild.id, id, t);
      else await api.createAnnouncementTemplate(guild.id, t);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ann-editor">
      <div className="ann-form">
        <div className="mod-row">
          <label className="field">
            <span>Template name</span>
            <input value={t.name} maxLength={60} placeholder="e.g. Weekly update" onChange={(e) => set((d) => { d.name = e.target.value; })} />
          </label>
          <label className="field">
            <span>Channel</span>
            <ChannelSelect guild={guild} value={t.channelId} emptyLabel="Choose each time" onChange={(v) => set((d) => { d.channelId = v; })} />
          </label>
          <label className="field">
            <span>Ping</span>
            <select value={t.ping.type} onChange={(e) => set((d) => { d.ping.type = e.target.value as PingType; })}>
              {(Object.keys(pingLabel) as PingType[]).map((p) => <option key={p} value={p}>{pingLabel[p]}</option>)}
            </select>
          </label>
        </div>
        {t.ping.type === "roles" && (
          <div className="field">
            <span>Roles to ping</span>
            <RolePicker guild={guild} anyRole value={t.ping.roleIds} max={ANNOUNCEMENT_LIMITS.pingRoles} onChange={(v) => set((d) => { d.ping.roleIds = v; })} />
          </div>
        )}
        <MessageFields message={t.message} update={(fn) => set((d) => fn(d.message))} />
        {error && <p className="error">{error}</p>}
        <div className="ann-buttons">
          <button className="btn ghost small" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn primary small" disabled={busy || Boolean(problem)} title={problem ?? undefined} onClick={save}>
            {busy ? "Saving…" : "Save template"}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>
      <div className="ann-preview-wrap">
        <div className="muted small">Preview</div>
        <AnnouncementPreview guild={guild} message={t.message} ping={t.ping} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ embed builder (Announcements only) */

function MessageFields({ message: m, update }: { message: AnnouncementMessage; update: (fn: (m: AnnouncementMessage) => void) => void }) {
  const e = m.embed;
  const text = (label: string, value: string, max: number, apply: (e: AnnouncementEmbed, v: string) => void, placeholder?: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={value} maxLength={max} placeholder={placeholder} onChange={(ev) => update((x) => apply(x.embed, ev.target.value))} />
    </label>
  );
  return (
    <>
      <label className="field">
        <span>
          Text <small className="muted">({m.content.length}/{ANNOUNCEMENT_LIMITS.content})</small>
        </span>
        <textarea rows={3} maxLength={ANNOUNCEMENT_LIMITS.content} value={m.content} onChange={(ev) => update((x) => { x.content = ev.target.value; })} />
        <small className="muted">Shown above the embed, after the ping. Only the ping you choose goes off; other mentions don't.</small>
      </label>
      <section className="sub">
        <Toggle label="Embed" hint="A coloured card with a title, text, fields and images." checked={m.useEmbed} onChange={(v) => update((x) => { x.useEmbed = v; })} />
        {m.useEmbed && (
          <div className="sub-body">
            <div className="mod-row">
              <label className="field ann-color">
                <span>Colour</span>
                <input type="color" value={e.color} onChange={(ev) => update((x) => { x.embed.color = ev.target.value; })} />
              </label>
              {text("Title", e.title, ANNOUNCEMENT_LIMITS.title, (x, v) => { x.title = v; })}
              {text("Title link", e.url, 1000, (x, v) => { x.url = v; }, "https://…")}
            </div>
            <label className="field">
              <span>
                Description <small className="muted">({e.description.length}/{ANNOUNCEMENT_LIMITS.description})</small>
              </span>
              <textarea rows={6} maxLength={ANNOUNCEMENT_LIMITS.description} value={e.description} onChange={(ev) => update((x) => { x.embed.description = ev.target.value; })} />
              <small className="muted">Discord formatting works: **bold**, *italic*, [links](https://…), lists and more.</small>
            </label>
            <div className="ann-fieldlist">
              <span className="small"><strong>Fields</strong> <span className="muted">({e.fields.length}/{ANNOUNCEMENT_LIMITS.fields})</span></span>
              {e.fields.map((f, i) => (
                <div key={i} className="ann-fieldrow">
                  <input value={f.name} maxLength={ANNOUNCEMENT_LIMITS.fieldName} placeholder="Name" onChange={(ev) => update((x) => { x.embed.fields[i].name = ev.target.value; })} />
                  <textarea rows={2} value={f.value} maxLength={ANNOUNCEMENT_LIMITS.fieldValue} placeholder="Value" onChange={(ev) => update((x) => { x.embed.fields[i].value = ev.target.value; })} />
                  <label className="check small">
                    <input type="checkbox" checked={f.inline} onChange={(ev) => update((x) => { x.embed.fields[i].inline = ev.target.checked; })} />
                    <span>Side by side</span>
                  </label>
                  <button className="btn danger small" onClick={() => update((x) => { x.embed.fields.splice(i, 1); })}>Remove</button>
                </div>
              ))}
              <button
                className="btn ghost small"
                disabled={e.fields.length >= ANNOUNCEMENT_LIMITS.fields}
                onClick={() => update((x) => { x.embed.fields.push({ name: "", value: "", inline: false }); })}
              >
                + Add field
              </button>
            </div>
            <div className="mod-row">
              {text("Author", e.authorName, ANNOUNCEMENT_LIMITS.author, (x, v) => { x.authorName = v; })}
              {text("Author icon", e.authorIcon, 1000, (x, v) => { x.authorIcon = v; }, "https://…")}
            </div>
            <div className="mod-row">
              {text("Big image", e.image, 1000, (x, v) => { x.image = v; }, "https://…")}
              {text("Small image (top right)", e.thumbnail, 1000, (x, v) => { x.thumbnail = v; }, "https://…")}
            </div>
            <div className="mod-row">
              {text("Footer", e.footerText, ANNOUNCEMENT_LIMITS.footer, (x, v) => { x.footerText = v; })}
            </div>
            <Toggle label="Show the time" hint="Adds when it was posted next to the footer." checked={e.timestamp} onChange={(v) => update((x) => { x.embed.timestamp = v; })} />
          </div>
        )}
      </section>
    </>
  );
}

function AnnouncementPreview({ guild, message: m, ping }: { guild: Guild; message: AnnouncementMessage; ping: AnnouncementPing }) {
  const e = m.embed;
  const pingText =
    ping.type === "everyone"
      ? "@everyone"
      : ping.type === "here"
        ? "@here"
        : ping.type === "roles"
          ? ping.roleIds.map((id) => `@${guild.roles.find((r) => r.id === id)?.name ?? "role"}`).join(" ")
          : "";
  return (
    <div className="ann-preview">
      <div className="ann-preview-author">
        <span className="ann-preview-avatar">1</span>
        <strong>Number One</strong>
        <span className="ann-preview-bot">APP</span>
      </div>
      {pingText && <div className="ann-preview-content"><span className="ann-preview-ping">{pingText}</span></div>}
      {m.content.trim() && <div className="ann-preview-content">{m.content}</div>}
      {m.useEmbed && (
        <div className="ann-preview-embed" style={{ borderLeftColor: e.color }}>
          <div className="ann-preview-main">
            {e.authorName && (
              <div className="ann-preview-embauthor">
                {e.authorIcon && <img src={e.authorIcon} alt="" />}
                {e.authorName}
              </div>
            )}
            {e.title && <div className={`ann-preview-title ${e.url ? "linked" : ""}`}>{e.title}</div>}
            {e.description.trim() && <div className="ann-preview-desc">{e.description}</div>}
            {e.fields.length > 0 && (
              <div className="ann-preview-fields">
                {e.fields.map((f, j) => (
                  <div key={j} className={f.inline ? "inline" : ""}>
                    <strong>{f.name || "Name"}</strong>
                    <span>{f.value || "Value"}</span>
                  </div>
                ))}
              </div>
            )}
            {e.image && <img className="ann-preview-image" src={e.image} alt="" />}
            {(e.footerText || e.timestamp) && (
              <div className="ann-preview-footer">{[e.footerText, e.timestamp ? "Today" : ""].filter(Boolean).join(" • ")}</div>
            )}
          </div>
          {e.thumbnail && <img className="ann-preview-thumb" src={e.thumbnail} alt="" />}
        </div>
      )}
    </div>
  );
}
