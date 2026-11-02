import { useEffect, useState } from "react";
import {
  type FormQuestion,
  MAX_FORM_QUESTIONS,
  MAX_STAFF_ROLES,
  MAX_TICKET_PANELS,
  MAX_TICKET_TYPES,
  TICKET_PLACEHOLDERS,
  type TicketButtonStyle,
  type TicketForm,
  type TicketPanelInput,
  type TicketPanelView,
  type TicketSettings,
  type TicketType,
  type TicketsResponse,
  ticketButtonStyles,
} from "../../../src/shared/tickets";
import { type GuildDetails, api } from "../api";
import { EmojiInput, EmojiView } from "../components/emoji";
import { CategorySelect, ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const styleNames: Record<TicketButtonStyle, { label: string; color: string }> = {
  primary: { label: "Blurple", color: "#5865f2" },
  secondary: { label: "Grey", color: "#4e5058" },
  success: { label: "Green", color: "#248046" },
  danger: { label: "Red", color: "#da373c" },
};

const newId = () => Math.random().toString(36).slice(2, 10);

const blankQuestion = (label = "What do you need help with?"): FormQuestion => ({ id: newId(), label, style: "long", placeholder: "", required: true });

const blankForm = (): TicketForm => ({ enabled: false, title: "Tell us about your ticket", questions: [blankQuestion()], lockUntilSubmitted: false });

const blankType = (label = "Support"): TicketType => ({
  id: newId(),
  label,
  emoji: "🎫",
  description: "",
  buttonStyle: "primary",
  namePrefix: "ticket",
  categoryId: null,
  staffRoleIds: [],
  welcomeMessage: "Thanks for reaching out, {user}! Tell us what you need and a staff member will be with you soon.",
  form: blankForm(),
});

const blankPanel = (): TicketPanelInput & { channelId: string } => ({
  channelId: "",
  title: "🎫 Need help?",
  description: "Press a button below to open a private ticket with the staff team.",
  color: "#ff4fa3",
  image: "",
  style: "buttons",
  menuPlaceholder: "Pick a ticket type…",
  types: [blankType()],
});

/** Dashboard section for Tickets: panels, recent tickets and settings. */
export function TicketsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<TicketsResponse | null>(null);
  const [tab, setTab] = useState<"panels" | "tickets" | "settings">("panels");
  const [editing, setEditing] = useState<{ id: number | null; draft: TicketPanelInput } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.tickets(guild.id).then(setData).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading tickets…</p>;

  if (editing) {
    return (
      <PanelEditor
        guild={guild}
        id={editing.id}
        initial={editing.draft}
        posted={Boolean(data.panels.find((p) => p.id === editing.id)?.messageUrl)}
        onCancel={() => setEditing(null)}
        onSaved={(r) => {
          setData(r);
          setEditing(null);
          setNotice("Saved. The panel is up to date in Discord.");
        }}
      />
    );
  }

  const remove = async (p: TicketPanelView) => {
    if (!confirm(`Delete the panel "${p.title || "Untitled"}"? Its message is removed from Discord. Open tickets stay open.`)) return;
    try {
      setData(await api.deleteTicketPanel(guild.id, p.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted channel";

  return (
    <div className="panel tickets">
      <div className="stats">
        <div><strong>{data.openCount}</strong><span className="muted small">open tickets</span></div>
        <div><strong>{data.panels.length}</strong><span className="muted small">panels</span></div>
        <div><strong>{data.settings.staffRoleIds.length || "–"}</strong><span className="muted small">staff roles</span></div>
      </div>

      <div className="cc-tabs">
        <button className={`cc-tab ${tab === "panels" ? "on" : ""}`} onClick={() => setTab("panels")}>Panels ({data.panels.length})</button>
        <button className={`cc-tab ${tab === "tickets" ? "on" : ""}`} onClick={() => setTab("tickets")}>Tickets ({data.openCount} open)</button>
        <button className={`cc-tab ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")}>Settings</button>
      </div>

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

      {tab === "panels" && (
        <>
          <div className="cc-head">
            <p className="muted small">
              A panel is a message with buttons (or a dropdown). Each button opens a private ticket channel for that member and your staff.
              {" "}{data.panels.length}/{MAX_TICKET_PANELS} used.
            </p>
            <button className="btn primary small" disabled={data.panels.length >= MAX_TICKET_PANELS} onClick={() => setEditing({ id: null, draft: blankPanel() })}>
              New panel
            </button>
          </div>
          {data.panels.length === 0 ? (
            <div className="card"><p className="muted">No panels yet. Make one to let members open tickets.</p></div>
          ) : (
            <ul className="cc-list">
              {data.panels.map((p) => (
                <li key={p.id} className="card cc-item">
                  <div className="cc-item-text">
                    <strong>{p.title || "Untitled panel"}</strong>
                    <span className="muted small">
                      #{channelName(p.channelId)} · {p.types.length} type{p.types.length === 1 ? "" : "s"} · {p.style === "menu" ? "dropdown" : "buttons"}
                      {" · "}
                      {p.messageUrl ? <a href={p.messageUrl} target="_blank" rel="noreferrer">Open in Discord</a> : "not posted"}
                    </span>
                  </div>
                  <div className="cc-actions">
                    <button className="btn ghost small" onClick={() => setEditing({ id: p.id, draft: structuredClone(p) })}>Edit</button>
                    <button className="btn danger small" onClick={() => remove(p)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "tickets" && <TicketList data={data} />}

      {tab === "settings" && (
        <SettingsEditor
          guild={guild}
          initial={data.settings}
          onSaved={(r) => {
            setData(r);
            setNotice("Ticket settings saved.");
          }}
        />
      )}
    </div>
  );
}

function TicketList({ data }: { data: TicketsResponse }) {
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const shown = data.tickets.filter((t) => filter === "all" || t.status === filter);
  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <div className="cc-head">
        <p className="muted small">The 50 most recent tickets. Transcripts are posted in your ticket log channel when a ticket closes.</p>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="card"><p className="muted">No tickets here yet.</p></div>
      ) : (
        <ul className="cc-list">
          {shown.map((t) => (
            <li key={t.id} className="card cc-item">
              <div className="cc-item-text">
                <strong>
                  {t.status === "open" ? "🟢" : "🔒"} #{t.number} · {t.type}
                </strong>
                <span className="muted small">
                  Opened by {t.openerTag} · {when(t.createdAt)}
                  {t.claimedByTag ? ` · claimed by ${t.claimedByTag}` : ""}
                  {t.closedAt ? ` · closed ${when(t.closedAt)}${t.closedByTag ? ` by ${t.closedByTag}` : ""}` : ""}
                  {t.closeReason ? ` (${t.closeReason})` : ""}
                </span>
                {t.reason && <span className="small tk-reason">“{t.reason}”</span>}
                {t.formAnswers && (
                  <details className="tk-answers">
                    <summary className="small">📝 Form answers</summary>
                    <dl>
                      {t.formAnswers.map((a) => (
                        <div key={a.question}>
                          <dt className="small muted">{a.question}</dt>
                          <dd className="small">{a.answer || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
              {t.channelUrl && (
                <div className="cc-actions">
                  <a className="btn ghost small" href={t.channelUrl} target="_blank" rel="noreferrer">Open</a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SettingsEditor({ guild, initial, onSaved }: { guild: Guild; initial: TicketSettings; onSaved: (r: TicketsResponse) => void }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (fn: (d: TicketSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.saveTicketSettings(guild.id, draft);
      setSaved(r.settings);
      setDraft(structuredClone(r.settings));
      onSaved(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rv-form">
      <section className="sub">
        <div className="sub-head">
          <strong>🛡️ Staff</strong>
          <small className="muted">These roles see every ticket and can claim, add people and close. People with Manage Channels always can.</small>
        </div>
        <div className="sub-body rv-fields">
          <RolePicker guild={guild} value={draft.staffRoleIds} max={MAX_STAFF_ROLES} anyRole placeholder="Add a staff role…" onChange={(v) => set((d) => { d.staffRoleIds = v; })} />
          <Toggle label="Ping staff in new tickets" checked={draft.pingStaff} onChange={(v) => set((d) => { d.pingStaff = v; })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head"><strong>📁 Ticket channels</strong></div>
        <div className="sub-body rv-fields">
          <div className="mod-row">
            <label className="field">
              <span>Open new tickets in</span>
              <CategorySelect guild={guild} value={draft.categoryId} emptyLabel="Top of the channel list" onChange={(v) => set((d) => { d.categoryId = v; })} />
            </label>
            <label className="field">
              <span>Channel names</span>
              <select value={draft.naming} onChange={(e) => set((d) => { d.naming = e.target.value as TicketSettings["naming"]; })}>
                <option value="number">ticket-0001</option>
                <option value="username">ticket-username</option>
              </select>
            </label>
            <label className="field">
              <span>Open tickets per member</span>
              <select value={draft.maxOpenPerUser} onChange={(e) => set((d) => { d.maxOpenPerUser = Number(e.target.value); })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <Toggle label="Members can close their own tickets" checked={draft.membersCanClose} onChange={(v) => set((d) => { d.membersCanClose = v; })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head"><strong>📋 Logs and transcripts</strong></div>
        <div className="sub-body rv-fields">
          <label className="field">
            <span>Log opened and closed tickets in</span>
            <ChannelSelect guild={guild} value={draft.logChannelId} emptyLabel="Don't log" onChange={(v) => set((d) => { d.logChannelId = v; })} />
            <small className="muted">Closed tickets are posted here with a transcript file. Keep this channel staff-only.</small>
          </label>
          <Toggle
            label="DM the transcript to the member"
            hint="Sent when their ticket closes. Skipped if their DMs are closed."
            checked={draft.dmTranscript}
            onChange={(v) => set((d) => { d.dmTranscript = v; })}
          />
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : "No changes to save."}</span>
        <button className="btn ghost small" disabled={saving || !dirty} onClick={() => { setDraft(structuredClone(saved)); setError(""); }}>Discard</button>
        <button className="btn primary small" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}

function PanelEditor({
  guild,
  id,
  initial,
  posted,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: number | null;
  initial: TicketPanelInput;
  posted: boolean;
  onCancel: () => void;
  onSaved: (r: TicketsResponse) => void;
}) {
  const [p, setP] = useState<TicketPanelInput>(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (d: TicketPanelInput) => void) =>
    setP((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const setType = (i: number, fn: (t: TicketType) => void) => set((d) => fn(d.types[i]));
  const move = (i: number, by: number) =>
    set((d) => {
      const [t] = d.types.splice(i, 1);
      d.types.splice(i + by, 0, t);
    });

  const problem =
    (!p.channelId ? "Pick a channel for the panel." : null) ??
    (p.types.length === 0 ? "Add at least one ticket type." : null) ??
    (p.types.some((t) => !t.label.trim()) ? "Every ticket type needs a name." : null) ??
    (p.types.some((t) => !/^[a-z0-9-]{1,20}$/.test(t.namePrefix)) ? "Channel name starts can only use lowercase letters, numbers and -." : null) ??
    (p.types.some((t) => t.form.enabled && !t.form.title.trim()) ? "Give each starter form a title." : null) ??
    (p.types.some((t) => t.form.enabled && t.form.questions.some((q) => !q.label.trim())) ? "Every form question needs a label." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(id ? await api.updateTicketPanel(guild.id, id, p) : await api.createTicketPanel(guild.id, p));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel tickets">
      <div className="rv-editor">
        <div className="rv-form">
          <section className="sub">
            <div className="sub-head"><strong>🪧 The panel message</strong></div>
            <div className="sub-body rv-fields">
              <label className="field">
                <span>Post in</span>
                <ChannelSelect guild={guild} value={p.channelId || null} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.channelId = v ?? ""; })} />
              </label>
              <div className="mod-row">
                <label className="field">
                  <span>Title</span>
                  <input value={p.title} maxLength={256} onChange={(e) => set((d) => { d.title = e.target.value; })} />
                </label>
                <label className="field rv-color">
                  <span>Colour</span>
                  <input type="color" value={p.color} onChange={(e) => set((d) => { d.color = e.target.value; })} />
                </label>
              </div>
              <label className="field">
                <span>Description <small className="muted">({p.description.length}/4000)</small></span>
                <textarea rows={4} maxLength={4000} value={p.description} onChange={(e) => set((d) => { d.description = e.target.value; })} />
              </label>
              <label className="field">
                <span>Image link (optional)</span>
                <input value={p.image} maxLength={1000} placeholder="https://…" onChange={(e) => set((d) => { d.image = e.target.value; })} />
              </label>
              <div className="mod-row">
                <label className="field">
                  <span>Members pick with</span>
                  <select value={p.style} onChange={(e) => set((d) => { d.style = e.target.value as TicketPanelInput["style"]; })}>
                    <option value="buttons">Buttons</option>
                    <option value="menu">A dropdown menu</option>
                  </select>
                </label>
                {p.style === "menu" && (
                  <label className="field">
                    <span>Dropdown hint</span>
                    <input value={p.menuPlaceholder} maxLength={150} onChange={(e) => set((d) => { d.menuPlaceholder = e.target.value; })} />
                  </label>
                )}
              </div>
            </div>
          </section>

          {p.types.map((t, i) => (
            <section key={t.id} className="sub">
              <div className="sub-head tk-type-head">
                <strong>🎫 Ticket type {i + 1}</strong>
                <span className="cc-actions">
                  <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="btn ghost small" disabled={i === p.types.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn danger small" disabled={p.types.length === 1} onClick={() => set((d) => { d.types.splice(i, 1); })}>Remove</button>
                </span>
              </div>
              <div className="sub-body rv-fields">
                <div className="mod-row">
                  <label className="field">
                    <span>Name</span>
                    <input value={t.label} maxLength={80} placeholder="Support" onChange={(e) => setType(i, (x) => { x.label = e.target.value; })} />
                  </label>
                  <label className="field">
                    <span>Emoji</span>
                    <EmojiInput guild={guild} value={t.emoji} onChange={(v) => setType(i, (x) => { x.emoji = v; })} />
                    {t.emoji && <button className="link small" onClick={() => setType(i, (x) => { x.emoji = ""; })}>No emoji</button>}
                  </label>
                  {p.style === "buttons" ? (
                    <label className="field">
                      <span>Button colour</span>
                      <select value={t.buttonStyle} onChange={(e) => setType(i, (x) => { x.buttonStyle = e.target.value as TicketButtonStyle; })}>
                        {ticketButtonStyles.map((st) => <option key={st} value={st}>{styleNames[st].label}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="field">
                      <span>Short description</span>
                      <input value={t.description} maxLength={100} onChange={(e) => setType(i, (x) => { x.description = e.target.value; })} />
                    </label>
                  )}
                </div>
                <label className="field">
                  <span>First message in the ticket</span>
                  <textarea rows={3} maxLength={2000} value={t.welcomeMessage} onChange={(e) => setType(i, (x) => { x.welcomeMessage = e.target.value; })} />
                  <small className="muted">{TICKET_PLACEHOLDERS.map((ph) => `${ph.key} ${ph.means}`).join(" · ")}</small>
                </label>
                <FormEditor form={t.form} onChange={(fn) => setType(i, (x) => fn(x.form))} />
                <details className="tk-more">
                  <summary className="small">More options</summary>
                  <div className="rv-fields">
                    <div className="mod-row">
                      <label className="field">
                        <span>Channel name start</span>
                        <input
                          value={t.namePrefix}
                          maxLength={20}
                          onChange={(e) => setType(i, (x) => { x.namePrefix = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"); })}
                        />
                      </label>
                      <label className="field">
                        <span>Category (instead of the default)</span>
                        <CategorySelect guild={guild} value={t.categoryId} emptyLabel="Use the default" onChange={(v) => setType(i, (x) => { x.categoryId = v; })} />
                      </label>
                    </div>
                    <label className="field">
                      <span>Extra staff for this type only</span>
                      <RolePicker guild={guild} value={t.staffRoleIds} max={MAX_STAFF_ROLES} anyRole placeholder="Add a role…" onChange={(v) => setType(i, (x) => { x.staffRoleIds = v; })} />
                    </label>
                  </div>
                </details>
              </div>
            </section>
          ))}
          <button
            className="btn ghost small"
            disabled={p.types.length >= MAX_TICKET_TYPES}
            onClick={() => set((d) => { d.types.push(blankType(`Type ${d.types.length + 1}`)); })}
          >
            + Add a ticket type ({p.types.length}/{MAX_TICKET_TYPES})
          </button>
        </div>

        <div className="rv-preview-wrap">
          <div className="muted small">Preview</div>
          <div className="rv-preview">
            <div className="rv-preview-author">
              <span className="rv-preview-avatar">1</span>
              <strong>Number One</strong>
              <span className="rv-preview-bot">APP</span>
            </div>
            <div className="rv-preview-embed" style={{ borderLeftColor: p.color }}>
              {p.title && <div className="rv-preview-title">{p.title}</div>}
              <div className="rv-preview-desc">{p.description.trim() || "Open a ticket below."}</div>
              {p.image && <img className="rv-preview-image" src={p.image} alt="" />}
            </div>
            {p.style === "buttons" ? (
              <div className="tk-preview-buttons">
                {p.types.map((t) => (
                  <span key={t.id} className="rv-preview-button" style={{ background: styleNames[t.buttonStyle].color }}>
                    {t.emoji && <EmojiView display={t.emoji} />} {t.label || "Untitled"}
                  </span>
                ))}
              </div>
            ) : (
              <div className="tk-preview-menu">
                <span>{p.menuPlaceholder || "Pick a ticket type…"}</span>
                <span>▾</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{posted ? "Saving updates the panel in Discord." : "Saving posts the panel (when Tickets is on)."}</span>
        <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
        <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
          {saving ? "Saving…" : id ? "Save changes" : "Save and post"}
        </button>
      </div>
      {problem && <small className="muted">{problem}</small>}
    </div>
  );
}

/** The starter form for one ticket type: up to 5 questions the opener answers inside their ticket. */
function FormEditor({ form, onChange }: { form: TicketForm; onChange: (fn: (f: TicketForm) => void) => void }) {
  const setQ = (i: number, fn: (q: FormQuestion) => void) => onChange((f) => fn(f.questions[i]));
  return (
    <div className="tk-form">
      <Toggle
        label="Starter form"
        hint="The opener is mentioned with a Fill in the form button. Their answers are posted in the ticket."
        checked={form.enabled}
        onChange={(v) => onChange((f) => { f.enabled = v; })}
      />
      {form.enabled && (
        <div className="rv-fields tk-form-body">
          <label className="field">
            <span>Form title <small className="muted">(up to 45 characters)</small></span>
            <input value={form.title} maxLength={45} onChange={(e) => onChange((f) => { f.title = e.target.value; })} />
          </label>
          {form.questions.map((q, i) => (
            <div key={q.id} className="tk-question">
              <div className="mod-row">
                <label className="field">
                  <span>Question {i + 1} <small className="muted">(up to 45 characters)</small></span>
                  <input value={q.label} maxLength={45} onChange={(e) => setQ(i, (x) => { x.label = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Answer</span>
                  <select value={q.style} onChange={(e) => setQ(i, (x) => { x.style = e.target.value as FormQuestion["style"]; })}>
                    <option value="short">Short (one line)</option>
                    <option value="long">Long (paragraph)</option>
                  </select>
                </label>
              </div>
              <div className="mod-row">
                <label className="field">
                  <span>Hint inside the box (optional)</span>
                  <input value={q.placeholder} maxLength={100} onChange={(e) => setQ(i, (x) => { x.placeholder = e.target.value; })} />
                </label>
                <label className="field tk-required">
                  <span>&nbsp;</span>
                  <span className="tk-check">
                    <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, (x) => { x.required = e.target.checked; })} /> Required
                  </span>
                </label>
              </div>
              <div className="cc-actions">
                <button className="btn ghost small" disabled={i === 0} onClick={() => onChange((f) => { f.questions.splice(i - 1, 0, ...f.questions.splice(i, 1)); })}>↑</button>
                <button className="btn ghost small" disabled={i === form.questions.length - 1} onClick={() => onChange((f) => { f.questions.splice(i + 1, 0, ...f.questions.splice(i, 1)); })}>↓</button>
                <button className="btn danger small" disabled={form.questions.length === 1} onClick={() => onChange((f) => { f.questions.splice(i, 1); })}>Remove</button>
              </div>
            </div>
          ))}
          <button
            className="btn ghost small"
            disabled={form.questions.length >= MAX_FORM_QUESTIONS}
            onClick={() => onChange((f) => { f.questions.push(blankQuestion(`Question ${f.questions.length + 1}`)); })}
          >
            + Add a question ({form.questions.length}/{MAX_FORM_QUESTIONS})
          </button>
          <Toggle
            label="Lock the ticket until the form is sent"
            hint="The opener can read the ticket but can't type until they send the form. Staff can always type."
            checked={form.lockUntilSubmitted}
            onChange={(v) => onChange((f) => { f.lockUntilSubmitted = v; })}
          />
        </div>
      )}
    </div>
  );
}
