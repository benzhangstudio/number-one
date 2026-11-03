import { useEffect, useState } from "react";
import {
  EVENT_LIMITS,
  type EventInput,
  type EventPingType,
  type EventView,
  type EventsResponse,
  MAX_UPCOMING_EVENTS,
  type RsvpView,
  reminderChoices,
  rsvpChoices,
} from "../../../src/shared/events";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";
import { SearchSelect } from "../components/SearchSelect";
import { DiscordText } from "../components/DiscordText";

type Guild = GuildDetails["guild"];

const VOICE_TYPES = new Set([2, 13]); // voice and stage channels
const pingLabel: Record<EventPingType, string> = { none: "No ping", everyone: "@everyone", here: "@here", roles: "Roles…" };

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};
// Browsers reject "weekday" combined with dateStyle/timeStyle, so the parts are listed one by one.
const when = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Tomorrow at 7pm, a sensible starting time for a new event. */
function defaultStart() {
  const d = new Date(Date.now() + 86_400_000);
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}

/** Dashboard section for Events: upcoming and past events, and the event editor. */
export function EventsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; draft: EventInput } | null>(null);
  const [people, setPeople] = useState<{ event: EventView; list: RsvpView[] | null } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; warning?: string | null } | null>(null);

  const reload = () => api.events(guild.id).then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading events…</p>;

  const upcoming = data.events.filter((e) => e.status === "upcoming");
  const past = data.events.filter((e) => e.status !== "upcoming");
  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel";
  const firstChannel = guild.channels.find((c) => c.type === 0)?.id ?? "";

  if (editing) {
    return (
      <EventEditor
        guild={guild}
        id={editing.id}
        initial={editing.draft}
        onCancel={() => setEditing(null)}
        onSaved={(r, wasNew) => {
          setEditing(null);
          setNotice({ text: wasNew ? "Event posted." : "Event saved. The post is updated.", warning: r.warning });
          void reload();
        }}
      />
    );
  }

  const act = async (e: EventView, run: () => Promise<{ event: EventView; warning: string | null } | { ok: true }>, done: string) => {
    setBusy(e.id);
    setError("");
    try {
      const r = await run();
      setNotice({ text: done, warning: "warning" in r ? r.warning : null });
      void reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const showPeople = async (e: EventView) => {
    setPeople({ event: e, list: null });
    try {
      setPeople({ event: e, list: await api.eventRsvps(guild.id, e.id) });
    } catch (err) {
      setError((err as Error).message);
      setPeople(null);
    }
  };

  const card = (e: EventView) => (
    <li key={e.id} className="card evt-item">
      <span className="evt-swatch" style={{ background: e.status === "cancelled" ? "var(--border)" : e.color }} />
      <div className="evt-item-text">
        <strong>
          {e.status === "cancelled" ? "❌ " : e.status === "ended" ? "" : "📅 "}
          {e.title}
        </strong>
        <span className="muted small">
          {when(e.startAt)} · #{channelName(e.channelId)}
          {e.status === "cancelled" ? " · cancelled" : e.status === "ended" ? " · ended" : ""}
        </span>
        <span className="small">
          {rsvpChoices.map((c) => `${c.emoji} ${e.counts[c.id]}${c.id === "going" && e.maxAttendees ? `/${e.maxAttendees}` : ""}`).join("   ")}
          {"  "}
          <button className="link small" onClick={() => showPeople(e)}>Who's coming</button>
        </span>
      </div>
      <div className="evt-actions">
        {e.status === "upcoming" &&
          (e.discordEventUrl ? (
            <a className="btn ghost small" href={e.discordEventUrl} target="_blank" rel="noreferrer" title="Open it in Discord's Events tab">
              ✓ In Discord Events
            </a>
          ) : (
            <button
              className="btn primary small"
              disabled={busy === e.id}
              title="Creates a matching Discord event with the same name, time, place, description and cover image"
              onClick={() => act(e, () => api.pushEventToDiscord(guild.id, e.id), "Added to Discord's Events tab.")}
            >
              {busy === e.id ? "Adding…" : "Add to Discord Events"}
            </button>
          ))}
        {e.url && <a className="btn ghost small" href={e.url} target="_blank" rel="noreferrer">Open</a>}
        {e.status === "upcoming" && (
          <button className="btn ghost small" onClick={() => setEditing({ id: e.id, draft: toInput(e) })}>Edit</button>
        )}
        <button
          className="btn ghost small"
          onClick={() => setEditing({ id: null, draft: { ...toInput(e), startAt: defaultStart(), endAt: e.endAt ? defaultStart() + (e.endAt - e.startAt) : null, addToDiscord: Boolean(e.discordEventUrl) } })}
          title="Start a new event with the same details"
        >
          Copy
        </button>
        {e.status === "upcoming" && (
          <button
            className="btn danger small"
            disabled={busy === e.id}
            onClick={() => {
              if (confirm(`Cancel "${e.title}"? Everyone going or maybe going gets a DM, and it's removed from Discord's Events tab.`)) {
                void act(e, () => api.cancelEvent(guild.id, e.id), "Event cancelled.");
              }
            }}
          >
            Cancel event
          </button>
        )}
        <button
          className="btn danger small"
          disabled={busy === e.id}
          onClick={() => {
            if (confirm(`Delete "${e.title}"? The post is deleted from Discord too.`)) void act(e, () => api.deleteEvent(guild.id, e.id), "Event deleted.");
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );

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
          <span>{notice.text}</span>
          {notice.warning && <span className="warning">⚠️ {notice.warning}</span>}
          <button className="link small" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="evt-head">
        <p className="muted small">
          Members answer with Going, Maybe or Can't go, and get a DM reminder before it starts. "Add to Discord Events" puts it in Discord's
          Events tab too, with everything filled in. {upcoming.length}/{MAX_UPCOMING_EVENTS} upcoming.
        </p>
        <button
          className="btn primary small"
          disabled={upcoming.length >= MAX_UPCOMING_EVENTS}
          onClick={() =>
            setEditing({
              id: null,
              draft: {
                channelId: firstChannel,
                title: "",
                description: "",
                startAt: defaultStart(),
                endAt: defaultStart() + 2 * 3_600_000,
                locationType: "place",
                location: "",
                voiceChannelId: null,
                image: "",
                color: "#5865f2",
                maxAttendees: 0,
                reminderMinutes: 60,
                ping: { type: "none", roleIds: [] },
                addToDiscord: true,
              },
            })
          }
        >
          New event
        </button>
      </div>

      {people && (
        <section className="sub evt-people">
          <div className="evt-people-head">
            <strong>Who's coming: {people.event.title}</strong>
            <button className="link small" onClick={() => setPeople(null)}>Close</button>
          </div>
          {!people.list ? (
            <p className="muted small">Loading…</p>
          ) : people.list.length === 0 ? (
            <p className="muted small">Nobody has answered yet.</p>
          ) : (
            <div className="evt-people-cols">
              {rsvpChoices.map((c) => {
                const list = people.list!.filter((p) => p.choice === c.id);
                return (
                  <div key={c.id}>
                    <strong className="small">{c.emoji} {c.label} ({list.length})</strong>
                    <ul className="small">
                      {list.map((p) => <li key={p.userId}>{p.name}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <h3 className="evt-group">Upcoming</h3>
      {upcoming.length === 0 ? (
        <div className="card"><p className="muted">No upcoming events. Make one for game nights, meetings, watch parties or anything else.</p></div>
      ) : (
        <ul className="evt-list">{upcoming.map(card)}</ul>
      )}
      {past.length > 0 && (
        <>
          <h3 className="evt-group">Past</h3>
          <ul className="evt-list">{past.map(card)}</ul>
        </>
      )}
    </div>
  );
}

function toInput(e: EventView): EventInput {
  return {
    channelId: e.channelId,
    title: e.title,
    description: e.description,
    startAt: e.startAt,
    endAt: e.endAt,
    locationType: e.locationType,
    location: e.location,
    voiceChannelId: e.voiceChannelId,
    image: e.image,
    color: e.color,
    maxAttendees: e.maxAttendees,
    reminderMinutes: e.reminderMinutes,
    ping: structuredClone(e.ping),
    addToDiscord: Boolean(e.discordEventUrl) || e.addToDiscord,
  };
}

/* ------------------------------------------------------------ editor */

function EventEditor({
  guild,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: number | null;
  initial: EventInput;
  onCancel: () => void;
  onSaved: (r: { event: EventView; warning: string | null }, wasNew: boolean) => void;
}) {
  const [d, setD] = useState<EventInput>(structuredClone(initial));
  const [start, setStart] = useState(toLocalInput(initial.startAt));
  const [end, setEnd] = useState(initial.endAt ? toLocalInput(initial.endAt) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (x: EventInput) => void) =>
    setD((x) => {
      const next = structuredClone(x);
      fn(next);
      return next;
    });

  const startAt = fromLocalInput(start);
  const endAt = end ? fromLocalInput(end) : null;
  const voiceChannels = guild.channels.filter((c) => VOICE_TYPES.has(c.type)).map((c) => ({ value: c.id, label: c.name, prefix: "🔊 " }));
  const startUnchanged = id !== null && startAt === initial.startAt;
  const problem =
    (!d.title.trim() ? "Give the event a name." : null) ??
    (!d.channelId ? "Pick a channel to post it in." : null) ??
    (!Number.isFinite(startAt) ? "Pick when it starts." : null) ??
    (!startUnchanged && startAt < Date.now() + 60_000 ? "The start time has already passed." : null) ??
    (endAt !== null && (!Number.isFinite(endAt) || endAt <= startAt) ? "The event has to end after it starts." : null) ??
    (d.locationType === "voice" && !d.voiceChannelId ? "Pick the voice channel." : null) ??
    (d.ping.type === "roles" && !d.ping.roleIds.length ? "Pick at least one role to ping." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = { ...d, startAt, endAt };
      const r = id ? await api.updateEvent(guild.id, id, body) : await api.createEvent(guild.id, body);
      onSaved(r, !id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const preview = { ...d, startAt: Number.isFinite(startAt) ? startAt : Date.now(), endAt: endAt && Number.isFinite(endAt) ? endAt : null };

  return (
    <div className="panel events evt-editor">
      <div className="evt-form">
        <label className="field">
          <span>Event name <small className="muted">({d.title.length}/{EVENT_LIMITS.title})</small></span>
          <input value={d.title} maxLength={EVENT_LIMITS.title} placeholder="e.g. Friday game night" onChange={(e) => set((x) => { x.title = e.target.value; })} />
        </label>
        <label className="field">
          <span>Description <small className="muted">({d.description.length}/{EVENT_LIMITS.description})</small></span>
          <textarea rows={4} maxLength={EVENT_LIMITS.description} value={d.description} onChange={(e) => set((x) => { x.description = e.target.value; })} />
          <small className="muted">Discord formatting works. Discord's Events tab shows the first {EVENT_LIMITS.discordDescription} characters.</small>
        </label>
        <div className="mod-row">
          <label className="field">
            <span>Starts</span>
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            <span>Ends (optional)</span>
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <small className="muted">
          In your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Everyone sees the time in their own time zone.
        </small>

        <section className="sub">
          <div className="sub-head"><strong>📍 Where</strong></div>
          <div className="mod-row evt-where">
            <label className="check">
              <input type="radio" checked={d.locationType === "place"} onChange={() => set((x) => { x.locationType = "place"; })} />
              <span>A place or link</span>
            </label>
            <label className="check">
              <input type="radio" checked={d.locationType === "voice"} onChange={() => set((x) => { x.locationType = "voice"; })} />
              <span>A voice or stage channel</span>
            </label>
          </div>
          {d.locationType === "place" ? (
            <input value={d.location} maxLength={EVENT_LIMITS.location} placeholder="e.g. Minecraft server, Central Park, https://…" onChange={(e) => set((x) => { x.location = e.target.value; })} />
          ) : (
            <SearchSelect
              options={voiceChannels}
              value={d.voiceChannelId}
              onChange={(v) => set((x) => { x.voiceChannelId = v; })}
              placeholder="Choose a voice channel…"
              searchPlaceholder="Search channels…"
            />
          )}
        </section>

        <div className="mod-row">
          <label className="field">
            <span>Post in</span>
            <ChannelSelect guild={guild} value={d.channelId || null} onChange={(v) => set((x) => { x.channelId = v ?? ""; })} />
          </label>
          <label className="field">
            <span>Ping when posted</span>
            <select value={d.ping.type} disabled={id !== null} onChange={(e) => set((x) => { x.ping.type = e.target.value as EventPingType; })}>
              {(Object.keys(pingLabel) as EventPingType[]).map((p) => <option key={p} value={p}>{pingLabel[p]}</option>)}
            </select>
            {id !== null && <small className="muted">The ping went out when it was posted.</small>}
          </label>
        </div>
        {d.ping.type === "roles" && id === null && (
          <div className="field">
            <span>Roles to ping</span>
            <RolePicker guild={guild} anyRole value={d.ping.roleIds} max={EVENT_LIMITS.pingRoles} onChange={(v) => set((x) => { x.ping.roleIds = v; })} />
          </div>
        )}
        <div className="mod-row">
          <label className="field">
            <span>Most people going (0 = no limit)</span>
            <input
              type="number"
              min={0}
              max={EVENT_LIMITS.maxAttendees}
              value={d.maxAttendees}
              onChange={(e) => set((x) => { x.maxAttendees = Math.max(0, Math.min(EVENT_LIMITS.maxAttendees, Math.round(e.target.valueAsNumber) || 0)); })}
            />
          </label>
          <label className="field">
            <span>Reminder by DM</span>
            <select value={d.reminderMinutes} onChange={(e) => set((x) => { x.reminderMinutes = Number(e.target.value); })}>
              {!reminderChoices.some((c) => c.minutes === d.reminderMinutes) && <option value={d.reminderMinutes}>{d.reminderMinutes} minutes before</option>}
              {reminderChoices.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
            </select>
            <small className="muted">Sent to everyone going or maybe going.</small>
          </label>
        </div>
        <div className="mod-row">
          <label className="field">
            <span>Cover image link (optional)</span>
            <input value={d.image} maxLength={1000} placeholder="https://…" onChange={(e) => set((x) => { x.image = e.target.value; })} />
          </label>
          <label className="field evt-color">
            <span>Colour</span>
            <input type="color" value={d.color} onChange={(e) => set((x) => { x.color = e.target.value; })} />
          </label>
        </div>
        <Toggle
          label="Add to Discord's Events tab"
          hint="Creates a matching Discord event with the same name, time, place, description and cover image, and keeps it updated when you edit."
          checked={d.addToDiscord}
          onChange={(v) => set((x) => { x.addToDiscord = v; })}
        />

        {error && <p className="error">{error}</p>}
        <div className="evt-buttons">
          <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
            {saving ? "Saving…" : id ? "Save changes" : "Post event"}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>

      <div className="evt-preview-wrap">
        <div className="muted small">Preview</div>
        <EventPreview guild={guild} d={preview} />
      </div>
    </div>
  );
}

function EventPreview({ guild, d }: { guild: Guild; d: EventInput }) {
  const where = d.locationType === "voice" ? (d.voiceChannelId ? `🔊 ${guild.channels.find((c) => c.id === d.voiceChannelId)?.name ?? ""}` : "") : d.location;
  const sameDay = d.endAt && new Date(d.startAt).toDateString() === new Date(d.endAt).toDateString();
  return (
    <div className="evt-preview">
      <div className="evt-preview-author">
        <span className="evt-preview-avatar">1</span>
        <strong>Number One</strong>
        <span className="evt-preview-bot">APP</span>
      </div>
      <div className="evt-preview-embed" style={{ borderLeftColor: d.color }}>
        <div className="evt-preview-title">📅 {d.title || "Event name"}</div>
        {d.description.trim() && <div className="evt-preview-desc"><DiscordText text={d.description} guild={guild} /></div>}
        <div className="evt-preview-field">
          <strong>🕒 When</strong>
          <span>
            {when(d.startAt)}
            {d.endAt ? ` – ${sameDay ? new Date(d.endAt).toLocaleTimeString([], { timeStyle: "short" }) : when(d.endAt)}` : ""}
          </span>
        </div>
        {where && (
          <div className="evt-preview-field">
            <strong>📍 Where</strong>
            <span>{where}</span>
          </div>
        )}
        <div className="evt-preview-rsvps">
          <div><strong>✅ Going (0{d.maxAttendees ? `/${d.maxAttendees}` : ""})</strong><span>Nobody yet</span></div>
          <div><strong>❔ Maybe (0)</strong><span>Nobody yet</span></div>
          <div><strong>❌ Can't go (0)</strong><span>Nobody yet</span></div>
        </div>
        {d.image && <img className="evt-preview-image" src={d.image} alt="" />}
        <div className="evt-preview-footer">Times show in your own time zone. Press a button to answer.</div>
      </div>
      <div className="evt-preview-buttons">
        <span className="going">✅ Going</span>
        <span>❔ Maybe</span>
        <span className="no">❌ Can't go</span>
      </div>
    </div>
  );
}
