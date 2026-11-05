import { useEffect, useState } from "react";
import {
  type BotUpdateFailure,
  type BotUpdateInput,
  type BotUpdateTemplateInput,
  DEFAULT_MAINTENANCE_MESSAGE,
  type DeveloperOverview,
  MAX_MAINTENANCE_MESSAGE,
  MAX_UPDATE_BODY,
  MAX_UPDATE_TEMPLATES,
  MAX_UPDATE_TITLE,
  type MaintenanceState,
  starterTemplates,
} from "../../../src/shared/botUpdates";
import { api } from "../api";
import { CardPhotos } from "./CardPhotos";
import { Toggle } from "../components/pickers";
import { DiscordText } from "../components/DiscordText";

const blank: BotUpdateInput = { title: "", body: "", url: "", mention: true };

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const when = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Fills {end} in a template with a Discord timestamp (shown in each reader's own time zone). */
function fillTemplate(t: BotUpdateTemplateInput, end: number | null): BotUpdateInput {
  const endText = end ? `<t:${Math.floor(end / 1000)}:f> (<t:${Math.floor(end / 1000)}:R>)` : "shortly";
  return { title: t.title, body: t.body.replaceAll("{end}", endText), url: t.url, mention: t.mention };
}

/**
 * Developer console: only the bot's developer (the owner of its Discord application) can open it.
 * Sends a "Number One updates" post to every server that picked a channel, mentioning their chosen role.
 */
export function DeveloperPage() {
  const [data, setData] = useState<DeveloperOverview | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<BotUpdateInput>(blank);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [failures, setFailures] = useState<{ id: number; list: BotUpdateFailure[] } | null>(null);

  const load = () => api.developer().then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);

  // While an update is going out, refresh the counts every few seconds.
  const inProgress = data?.updates.some((u) => u.status === "sending");
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [inProgress]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const set = <K extends keyof BotUpdateInput>(k: K, v: BotUpdateInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const maintenanceEnd = data.maintenance.until;

  const applyTemplate = (t: BotUpdateTemplateInput, end = maintenanceEnd) => {
    if ((draft.title.trim() || draft.body.trim()) && !confirm(`Replace what you've written with "${t.name}"?`)) return;
    setDraft(fillTemplate(t, end));
    setFormError("");
  };

  const saveTemplate = async () => {
    setFormError("");
    if (!draft.title.trim() && !draft.body.trim()) return setFormError("Write something first, then save it as a template.");
    const name = prompt("Name this template:", draft.title.trim().slice(0, 50))?.trim();
    if (!name) return;
    const existing = data.templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing && !confirm(`Replace your template "${existing.name}"?`)) return;
    try {
      const input = { name, ...draft };
      setData(existing ? await api.updateUpdateTemplate(existing.id, input) : await api.createUpdateTemplate(input));
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const deleteTemplate = async (id: number, name: string) => {
    if (!confirm(`Delete the template "${name}"?`)) return;
    try {
      setData(await api.deleteUpdateTemplate(id));
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const send = async () => {
    setFormError("");
    if (!draft.title.trim() || !draft.body.trim()) return setFormError("Add a title and a message.");
    if (!confirm(`Post "${draft.title.trim()}" in ${data.receiving} server${data.receiving === 1 ? "" : "s"}? This can't be undone.`)) return;
    setSending(true);
    try {
      await api.sendBotUpdate(draft);
      setDraft(blank);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const showFailures = async (id: number) => {
    if (failures?.id === id) return setFailures(null);
    try {
      setFailures({ id, list: (await api.botUpdateFailures(id)).failures });
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <section className="dev-page">
      <div className="page-head">
        <div>
          <h1>Developer</h1>
          <p className="muted">
            Post news about Number One. It goes to the {data.receiving} of {data.servers} servers that picked a channel in{" "}
            <strong>Other → Number One updates</strong>, and mentions their chosen role.
          </p>
        </div>
      </div>

      <MaintenanceCard
        state={data.maintenance}
        onChange={setData}
        onAnnounce={(end) => applyTemplate(starterTemplates[data.maintenance.on ? 1 : 0], end)}
      />

      <div className="dev-grid">
        <div className="card dev-form">
          <h2>New update</h2>
          <div className="field">
            <span>
              Start from a template <em className="muted">({data.templates.length}/{MAX_UPDATE_TEMPLATES} saved)</em>
            </span>
            <div className="dev-templates">
              {starterTemplates.map((t) => (
                <button key={t.name} className="chip" onClick={() => applyTemplate(t)} title={t.title}>
                  {t.name}
                </button>
              ))}
              {data.templates.map((t) => (
                <span key={t.id} className="chip saved">
                  <button className="link" onClick={() => applyTemplate(t)} title={t.title}>
                    ⭐ {t.name}
                  </button>
                  <button className="link chip-x" aria-label={`Delete ${t.name}`} onClick={() => deleteTemplate(t.id, t.name)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Title</span>
            <input value={draft.title} maxLength={MAX_UPDATE_TITLE} placeholder="What's new" onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="field">
            <span>
              Message <em className="muted">({draft.body.length}/{MAX_UPDATE_BODY})</em>
            </span>
            <textarea value={draft.body} maxLength={MAX_UPDATE_BODY} rows={7} placeholder="Supports Discord markdown." onChange={(e) => set("body", e.target.value)} />
          </label>
          <label className="field">
            <span>
              Link <em className="muted">(optional, adds a "Learn more" button)</em>
            </span>
            <input value={draft.url} maxLength={300} placeholder="https://" onChange={(e) => set("url", e.target.value)} />
          </label>
          <Toggle checked={draft.mention} onChange={(v) => set("mention", v)} label="Mention each server's role" hint="Servers that didn't pick a role aren't mentioned." />
          {formError && <p className="error">{formError}</p>}
          <div className="dev-buttons">
            <button className="btn primary" disabled={sending || inProgress || data.receiving === 0} onClick={send}>
              {sending ? "Sending…" : inProgress ? "Wait for the last one to finish" : `Send to ${data.receiving} server${data.receiving === 1 ? "" : "s"}`}
            </button>
            <button className="btn ghost" disabled={data.templates.length >= MAX_UPDATE_TEMPLATES} onClick={saveTemplate}>
              Save as template
            </button>
          </div>
        </div>

        <div className="dev-preview">
          <div className="muted small">Preview</div>
          <div className="dc-message">
            <div className="dc-avatar">1</div>
            <div className="dc-body">
              <div className="dc-author">
                Number One <span className="dc-bot">APP</span>
              </div>
              {draft.mention && (
                <div className="dc-content">
                  <span className="dc-mention">@their-role</span>
                </div>
              )}
              <div className="dc-embed">
                <div className="dc-embed-main">
                  <div>
                    <div className="dc-embed-title">{draft.title || "Title"}</div>
                    <div className="dc-embed-desc">{draft.body ? <DiscordText text={draft.body} /> : <span className="muted">Your message</span>}</div>
                    <div className="dev-embed-footer">Number One updates</div>
                  </div>
                </div>
              </div>
              {/^https:\/\/\S+$/.test(draft.url) && (
                <div className="dc-buttons">
                  <span className="dc-button" style={{ background: "#4e5058" }}>
                    Learn more ↗
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <h2>Sent</h2>
      {data.updates.length === 0 ? (
        <p className="muted">Nothing sent yet.</p>
      ) : (
        <div className="dev-history">
          {data.updates.map((u) => (
            <div key={u.id} className="card dev-item">
              <div className="dev-item-head">
                <strong>{u.title}</strong>
                <span className="muted small">{new Date(u.createdAt).toLocaleString()}</span>
              </div>
              <div className="small">
                {u.status === "sending" && <span className="pill">Sending…</span>} ✅ {u.sent} posted
                {u.failed > 0 && (
                  <>
                    {" · "}
                    <button className="link small" onClick={() => showFailures(u.id)}>
                      ⚠️ {u.failed} failed
                    </button>
                  </>
                )}
                {!u.mention && <span className="muted"> · no mention</span>}
              </div>
              {failures?.id === u.id && (
                <ul className="dev-failures small">
                  {failures.list.map((f) => (
                    <li key={f.guildId}>
                      <strong>{f.guildName}</strong>: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <CardPhotos />
    </section>
  );
}

/** The maintenance mode switch: message, optional end time, on and off. */
function MaintenanceCard({
  state,
  onChange,
  onAnnounce,
}: {
  state: MaintenanceState;
  onChange: (d: DeveloperOverview) => void;
  /** Fills in an update about the maintenance, with the end time typed in (saved or not). */
  onAnnounce: (end: number | null) => void;
}) {
  const [message, setMessage] = useState(state.message);
  const [end, setEnd] = useState(state.until ? toLocalInput(state.until) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setMessage(state.message);
    setEnd(state.until ? toLocalInput(state.until) : "");
  }, [state.on, state.message, state.until]);

  const until = end ? new Date(end).getTime() : null;
  const badEnd = until !== null && (!Number.isFinite(until) || until <= Date.now() + 60_000);
  const changed = message !== state.message || until !== state.until;

  const save = async (on: boolean) => {
    if (on && !state.on && !confirm("Turn on maintenance? Commands and buttons stop working for everyone except you.")) return;
    setSaving(true);
    setError("");
    try {
      onChange(await api.setMaintenance({ on, message: message.trim(), until: on ? until : null }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`card dev-maintenance ${state.on ? "on" : ""}`}>
      <div className="dev-item-head">
        <h2>🛠️ Maintenance mode</h2>
        <span className={`pill ${state.on ? "pill-warn" : ""}`}>
          {state.on ? `On since ${when(state.since ?? Date.now())}${state.until ? ` · ends ${when(state.until)}` : ""}` : "Off"}
        </span>
      </div>
      <p className="muted small">
        While it's on, commands, buttons and forms reply with your message instead of running, in every server. You can still use everything, to
        test. Auto-moderation, logs, XP and timers keep working, and the dashboard shows a maintenance notice.
      </p>
      <label className="field">
        <span>
          Message <em className="muted">({message.length}/{MAX_MAINTENANCE_MESSAGE})</em>
        </span>
        <input value={message} maxLength={MAX_MAINTENANCE_MESSAGE} placeholder={DEFAULT_MAINTENANCE_MESSAGE} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Ends <em className="muted">(optional: switches off by itself, and shows "back in…")</em>
        </span>
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        {badEnd && <small className="error">Pick a time in the future, or leave it empty.</small>}
      </label>
      {error && <p className="error">{error}</p>}
      <div className="dev-buttons">
        {state.on ? (
          <>
            <button className="btn primary" disabled={saving} onClick={() => save(false)}>
              {saving ? "Saving…" : "Turn off"}
            </button>
            <button className="btn ghost" disabled={saving || !changed || badEnd} onClick={() => save(true)}>
              Save changes
            </button>
          </>
        ) : (
          <button className="btn danger" disabled={saving || badEnd} onClick={() => save(true)}>
            {saving ? "Saving…" : "Turn on maintenance"}
          </button>
        )}
        <button className="btn ghost" onClick={() => onAnnounce(badEnd ? null : until)} title="Fills in the update below. Nothing is sent until you press Send.">
          {state.on ? "Write a \"back online\" update" : "Write a maintenance update"}
        </button>
      </div>
    </div>
  );
}
