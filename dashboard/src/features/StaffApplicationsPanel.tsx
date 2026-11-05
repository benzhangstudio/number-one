import { useEffect, useState } from "react";
import {
  APP_PLACEHOLDERS,
  type AppButtonStyle,
  type AppPanelInput,
  type AppPosition,
  type AppQuestion,
  type ApplicationView,
  MAX_APP_QUESTIONS,
  MAX_POSITIONS,
  MAX_POSITION_ROLES,
  MAX_REVIEWER_ROLES,
  QUESTIONS_PER_PAGE,
  type StaffApplicationSettings,
  type StaffApplicationsResponse,
  appButtonStyles,
} from "../../../src/shared/staffApplications";
import { type GuildDetails, api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { DiscordText } from "../components/DiscordText";
import { EmojiInput, EmojiView } from "../components/emoji";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const styleNames: Record<AppButtonStyle, { label: string; color: string }> = {
  primary: { label: "Blurple", color: "#5865f2" },
  secondary: { label: "Grey", color: "#4e5058" },
  success: { label: "Green", color: "#248046" },
  danger: { label: "Red", color: "#da373c" },
};

const newId = () => Math.random().toString(36).slice(2, 10);
const blankQuestion = (label: string, style: AppQuestion["style"] = "long"): AppQuestion => ({ id: newId(), label, style, placeholder: "", required: true });

const blankPosition = (name = "Moderator"): AppPosition => ({
  id: newId(),
  name,
  emoji: "🛡️",
  description: "",
  buttonStyle: "primary",
  open: true,
  questions: [
    blankQuestion("How old are you?", "short"),
    blankQuestion("What timezone are you in?", "short"),
    blankQuestion("Why do you want this position?"),
    blankQuestion("Any past experience as staff?"),
    blankQuestion("How active can you be each week?", "short"),
  ],
  roleIds: [],
  requiredRoleIds: [],
});

const blankPanel = (): AppPanelInput => ({
  channelId: "",
  title: "📝 Join the staff team",
  description: "Want to help run the server? Pick a position below and answer a few questions.",
  color: "#ff4fa3",
  image: "",
  style: "buttons",
  menuPlaceholder: "Pick a position…",
  positions: [blankPosition()],
});

const STATUS_ICON: Record<ApplicationView["status"], string> = { pending: "🟡", accepted: "✅", denied: "❌" };
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Dashboard section for Staff applications: incoming applications, the apply panel and its positions, and settings. */
export function StaffApplicationsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<StaffApplicationsResponse | null>(null);
  const [tab, setTab] = useState<"applications" | "panel" | "settings">("applications");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);

  useEffect(() => {
    api
      .staffApplications(guild.id)
      .then((r) => {
        setData(r);
        // A fresh setup starts on the panel tab, since there's nothing to review yet.
        if (!r.panel && r.applications.length === 0) setTab("panel");
      })
      .catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading staff applications…</p>;

  const done = (r: StaffApplicationsResponse, text: string, warnings: string[] = []) => {
    setData(r);
    setNotice({ text, warnings });
    setError("");
  };

  return (
    <div className="panel tickets">
      <div className="stats">
        <div><strong>{data.pendingCount}</strong><span className="muted small">waiting for review</span></div>
        <div><strong>{data.applications.length}</strong><span className="muted small">recent applications</span></div>
        <div><strong>{data.panel?.positions.filter((p) => p.open).length ?? 0}</strong><span className="muted small">open positions</span></div>
      </div>

      <div className="cc-tabs">
        <button className={`cc-tab ${tab === "applications" ? "on" : ""}`} onClick={() => setTab("applications")}>
          Applications ({data.pendingCount} waiting)
        </button>
        <button className={`cc-tab ${tab === "panel" ? "on" : ""}`} onClick={() => setTab("panel")}>Positions & panel</button>
        <button className={`cc-tab ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")}>Settings</button>
      </div>

      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {notice && (
        <div className={`notice ${notice.warnings.length ? "warning-box" : ""}`}>
          <span>{notice.text}</span>
          {notice.warnings.map((w) => <span key={w} className="small">⚠️ {w}</span>)}
          <button className="link small" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {tab === "applications" && <ApplicationList guild={guild} data={data} onDone={done} onError={setError} />}
      {tab === "panel" && (
        <PanelEditor
          guild={guild}
          initial={data.panel}
          onSaved={(r) => done(r, "Saved. The apply panel is up to date in Discord.")}
          onDeleted={(r) => done(r, "Removed the apply panel. Applications already sent are kept.")}
        />
      )}
      {tab === "settings" && <SettingsEditor guild={guild} initial={data.settings} onSaved={(r) => done(r, "Settings saved.")} />}
    </div>
  );
}

/* ------------------------------------------------------------ applications */

function ApplicationList({
  guild,
  data,
  onDone,
  onError,
}: {
  guild: Guild;
  data: StaffApplicationsResponse;
  onDone: (r: StaffApplicationsResponse, text: string, warnings?: string[]) => void;
  onError: (e: string) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "accepted" | "denied" | "all">(data.pendingCount ? "pending" : "all");
  const [deciding, setDeciding] = useState<{ id: number; decision: "accepted" | "denied"; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = data.applications.filter((a) => filter === "all" || a.status === filter);

  const decide = async () => {
    if (!deciding) return;
    setBusy(true);
    try {
      const r = await api.decideApplication(guild.id, deciding.id, { decision: deciding.decision, reason: deciding.reason });
      const app = data.applications.find((a) => a.id === deciding.id);
      onDone(r, `${deciding.decision === "accepted" ? "Accepted" : "Denied"} application #${app?.number} from ${app?.applicantTag}.`, r.warnings);
      setDeciding(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="cc-head">
        <p className="muted small">
          The 100 most recent applications. Accepting gives the position's roles and messages the applicant, the same as the buttons in your
          review channel.
        </p>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="pending">Waiting</option>
          <option value="accepted">Accepted</option>
          <option value="denied">Denied</option>
          <option value="all">All</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="card">
          <p className="muted">{filter === "pending" ? "Nothing waiting for review." : "No applications here yet."}</p>
        </div>
      ) : (
        <ul className="cc-list">
          {shown.map((a) => (
            <li key={a.id} className="card cc-item sa-item">
              <div className="cc-item-text">
                <strong>
                  {STATUS_ICON[a.status]} #{a.number} · {a.positionName} · {a.applicantTag}
                </strong>
                <span className="muted small">
                  Sent {when(a.createdAt)}
                  {a.status === "pending" && a.claimedByTag ? ` · claimed by ${a.claimedByTag}` : ""}
                  {a.decidedAt ? ` · ${a.status} ${when(a.decidedAt)}${a.decidedByTag ? ` by ${a.decidedByTag}` : ""}` : ""}
                </span>
                {a.decisionReason && <span className="small tk-reason">Note: “{a.decisionReason}”</span>}
                <details className="tk-answers" open={a.status === "pending" && shown.length <= 3}>
                  <summary className="small">📝 Answers ({a.answers.length})</summary>
                  <dl>
                    {a.answers.map((x, i) => (
                      <div key={i}>
                        <dt className="small muted">{x.question}</dt>
                        <dd className="small sa-answer">{x.answer || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                {deciding?.id === a.id && (
                  <div className="sa-decide">
                    <label className="field">
                      <span>
                        Note to the applicant <em className="muted">(optional, added to their DM)</em>
                      </span>
                      <textarea
                        rows={2}
                        maxLength={1000}
                        value={deciding.reason}
                        onChange={(e) => setDeciding({ ...deciding, reason: e.target.value })}
                      />
                    </label>
                    <div className="cc-actions">
                      <button className="btn ghost small" disabled={busy} onClick={() => setDeciding(null)}>Cancel</button>
                      <button className={`btn small ${deciding.decision === "accepted" ? "primary" : "danger"}`} disabled={busy} onClick={decide}>
                        {busy ? "Saving…" : deciding.decision === "accepted" ? "✅ Accept" : "❌ Deny"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="cc-actions">
                {a.status === "pending" && deciding?.id !== a.id && (
                  <>
                    <button className="btn primary small" onClick={() => setDeciding({ id: a.id, decision: "accepted", reason: "" })}>Accept</button>
                    <button className="btn danger small" onClick={() => setDeciding({ id: a.id, decision: "denied", reason: "" })}>Deny</button>
                  </>
                )}
                {a.messageUrl && (
                  <a className="btn ghost small" href={a.messageUrl} target="_blank" rel="noreferrer">Open</a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ------------------------------------------------------------ settings */

function SettingsEditor({ guild, initial, onSaved }: { guild: Guild; initial: StaffApplicationSettings; onSaved: (r: StaffApplicationsResponse) => void }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (fn: (d: StaffApplicationSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.saveStaffApplicationSettings(guild.id, draft);
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
          <strong>📥 Review channel</strong>
          <small className="muted">New applications are posted here with Claim, Accept and Deny buttons. Keep it staff-only.</small>
        </div>
        <div className="sub-body rv-fields">
          <ChannelSelect guild={guild} value={draft.reviewChannelId} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.reviewChannelId = v; })} />
          <Toggle
            label="Open a discussion thread on each application"
            hint="So the staff can talk about it without cluttering the channel. Closed when it's decided."
            checked={draft.discussionThreads}
            onChange={(v) => set((d) => { d.discussionThreads = v; })}
          />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>🛡️ Reviewers</strong>
          <small className="muted">These roles can claim, accept and deny. People with Manage Server always can.</small>
        </div>
        <div className="sub-body rv-fields">
          <RolePicker guild={guild} value={draft.reviewerRoleIds} max={MAX_REVIEWER_ROLES} anyRole placeholder="Add a reviewer role…" onChange={(v) => set((d) => { d.reviewerRoleIds = v; })} />
          <Toggle label="Ping reviewers on new applications" checked={draft.pingReviewers} onChange={(v) => set((d) => { d.pingReviewers = v; })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>🚦 Who can apply</strong>
          <small className="muted">Per-position role requirements are set on each position.</small>
        </div>
        <div className="sub-body rv-fields">
          <div className="mod-row">
            <label className="field">
              <span>Discord account at least (days old)</span>
              <NumberInput min={0} max={3650} value={draft.minAccountAgeDays} onChange={(v) => set((d) => { d.minAccountAgeDays = v; })} />
            </label>
            <label className="field">
              <span>In the server at least (days)</span>
              <NumberInput min={0} max={3650} value={draft.minMemberDays} onChange={(v) => set((d) => { d.minMemberDays = v; })} />
            </label>
            <label className="field">
              <span>Wait after a denial (days)</span>
              <NumberInput min={0} max={365} value={draft.cooldownDays} onChange={(v) => set((d) => { d.cooldownDays = v; })} />
            </label>
          </div>
          <small className="muted">0 means no limit. Members can only have one application per position waiting at a time.</small>
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>💌 Telling the applicant</strong>
        </div>
        <div className="sub-body rv-fields">
          <Toggle
            label="DM the applicant when it's decided"
            hint="Any note the reviewer writes is added at the end. Skipped if their DMs are closed."
            checked={draft.dmResults}
            onChange={(v) => set((d) => { d.dmResults = v; })}
          />
          {draft.dmResults && (
            <>
              <label className="field">
                <span>When accepted</span>
                <textarea rows={2} maxLength={1500} value={draft.acceptMessage} onChange={(e) => set((d) => { d.acceptMessage = e.target.value; })} />
              </label>
              <label className="field">
                <span>When denied</span>
                <textarea rows={2} maxLength={1500} value={draft.denyMessage} onChange={(e) => set((d) => { d.denyMessage = e.target.value; })} />
              </label>
              <small className="muted">{APP_PLACEHOLDERS.map((ph) => `${ph.key} ${ph.means}`).join(" · ")}</small>
            </>
          )}
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

/* ------------------------------------------------------------ panel and positions */

function PanelEditor({
  guild,
  initial,
  onSaved,
  onDeleted,
}: {
  guild: Guild;
  initial: (AppPanelInput & { messageUrl: string | null }) | null;
  onSaved: (r: StaffApplicationsResponse) => void;
  onDeleted: (r: StaffApplicationsResponse) => void;
}) {
  const start = () => {
    if (!initial) return blankPanel();
    const { messageUrl: _url, ...rest } = initial;
    return structuredClone(rest);
  };
  const [saved, setSaved] = useState<AppPanelInput>(start);
  const [p, setP] = useState<AppPanelInput>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = !initial || JSON.stringify(p) !== JSON.stringify(saved);
  const set = (fn: (d: AppPanelInput) => void) =>
    setP((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const setPos = (i: number, fn: (x: AppPosition) => void) => set((d) => fn(d.positions[i]));
  const move = (i: number, by: number) =>
    set((d) => {
      const [x] = d.positions.splice(i, 1);
      d.positions.splice(i + by, 0, x);
    });

  const problem =
    (!p.channelId ? "Pick a channel for the panel." : null) ??
    (p.positions.some((x) => !x.name.trim()) ? "Every position needs a name." : null) ??
    (p.positions.some((x) => x.questions.some((q) => !q.label.trim())) ? "Every question needs a label." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.saveApplicationPanel(guild.id, p);
      if (r.panel) {
        const { messageUrl: _url, ...rest } = r.panel;
        setSaved(rest);
        setP(structuredClone(rest));
      }
      onSaved(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove the apply panel? Its message is taken down from Discord. Applications already sent are kept.")) return;
    try {
      const r = await api.deleteApplicationPanel(guild.id);
      setSaved(blankPanel());
      setP(blankPanel());
      onDeleted(r);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="rv-editor">
        <div className="rv-form">
          <section className="sub">
            <div className="sub-head">
              <strong>🪧 The apply panel</strong>
              <small className="muted">
                {initial?.messageUrl ? (
                  <a href={initial.messageUrl} target="_blank" rel="noreferrer">Open in Discord</a>
                ) : (
                  "Members press a button on it to apply."
                )}
              </small>
            </div>
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
                  <select value={p.style} onChange={(e) => set((d) => { d.style = e.target.value as AppPanelInput["style"]; })}>
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

          {p.positions.map((pos, i) => (
            <section key={pos.id} className="sub">
              <div className="sub-head tk-type-head">
                <strong>{pos.open ? "🟢" : "⏸️"} Position {i + 1}</strong>
                <span className="cc-actions">
                  <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="btn ghost small" disabled={i === p.positions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn danger small" disabled={p.positions.length === 1} onClick={() => set((d) => { d.positions.splice(i, 1); })}>Remove</button>
                </span>
              </div>
              <div className="sub-body rv-fields">
                <Toggle
                  label="Taking applications"
                  hint="When off, the button stays on the panel but is greyed out."
                  checked={pos.open}
                  onChange={(v) => setPos(i, (x) => { x.open = v; })}
                />
                <div className="mod-row">
                  <label className="field">
                    <span>Name</span>
                    <input value={pos.name} maxLength={80} placeholder="Moderator" onChange={(e) => setPos(i, (x) => { x.name = e.target.value; })} />
                  </label>
                  <label className="field">
                    <span>Emoji</span>
                    <EmojiInput guild={guild} value={pos.emoji} onChange={(v) => setPos(i, (x) => { x.emoji = v; })} />
                    {pos.emoji && <button className="link small" onClick={() => setPos(i, (x) => { x.emoji = ""; })}>No emoji</button>}
                  </label>
                  {p.style === "buttons" && (
                    <label className="field">
                      <span>Button colour</span>
                      <select value={pos.buttonStyle} onChange={(e) => setPos(i, (x) => { x.buttonStyle = e.target.value as AppButtonStyle; })}>
                        {appButtonStyles.map((st) => <option key={st} value={st}>{styleNames[st].label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <label className="field">
                  <span>Short description <small className="muted">(shown in the dropdown and to reviewers)</small></span>
                  <input value={pos.description} maxLength={100} onChange={(e) => setPos(i, (x) => { x.description = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Roles to give when accepted</span>
                  <RolePicker guild={guild} value={pos.roleIds} max={MAX_POSITION_ROLES} placeholder="Add a role…" onChange={(v) => setPos(i, (x) => { x.roleIds = v; })} />
                </label>
                <QuestionsEditor questions={pos.questions} onChange={(fn) => setPos(i, (x) => fn(x.questions))} />
                <details className="tk-more">
                  <summary className="small">More options</summary>
                  <div className="rv-fields">
                    <label className="field">
                      <span>Only members with one of these roles can apply</span>
                      <RolePicker
                        guild={guild}
                        value={pos.requiredRoleIds}
                        max={MAX_POSITION_ROLES}
                        anyRole
                        placeholder="Anyone can apply"
                        onChange={(v) => setPos(i, (x) => { x.requiredRoleIds = v; })}
                      />
                    </label>
                  </div>
                </details>
              </div>
            </section>
          ))}
          <button
            className="btn ghost small"
            disabled={p.positions.length >= MAX_POSITIONS}
            onClick={() => set((d) => { d.positions.push(blankPosition(`Position ${d.positions.length + 1}`)); })}
          >
            + Add a position ({p.positions.length}/{MAX_POSITIONS})
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
              <div className="rv-preview-desc"><DiscordText text={p.description.trim() || "Pick a position below to apply."} guild={guild} /></div>
              {p.image && <img className="rv-preview-image" src={p.image} alt="" />}
            </div>
            {p.style === "buttons" ? (
              <div className="tk-preview-buttons">
                {p.positions.map((x) => (
                  <span
                    key={x.id}
                    className={`rv-preview-button ${x.open ? "" : "sa-closed"}`}
                    style={{ background: x.open ? styleNames[x.buttonStyle].color : "#4e5058" }}
                  >
                    {x.emoji && <EmojiView display={x.emoji} />} {x.name || "Untitled"}{x.open ? "" : " (closed)"}
                  </span>
                ))}
              </div>
            ) : (
              <div className="tk-preview-menu">
                <span>{p.menuPlaceholder || "Pick a position…"}</span>
                <span>▾</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{initial ? (dirty ? "Saving updates the panel in Discord." : "No changes to save.") : "Saving posts the panel (when Staff applications is on)."}</span>
        {initial && <button className="btn danger small" disabled={saving} onClick={remove}>Remove panel</button>}
        <button className="btn ghost small" disabled={saving || !dirty || !initial} onClick={() => { setP(structuredClone(saved)); setError(""); }}>Discard</button>
        <button className="btn primary small" disabled={saving || !dirty || Boolean(problem)} title={problem ?? undefined} onClick={save}>
          {saving ? "Saving…" : initial ? "Save changes" : "Save and post"}
        </button>
      </div>
      {problem && <small className="muted">{problem}</small>}
    </>
  );
}

/** A position's questions. Shown to applicants 5 at a time, in up to 3 pop-up forms. */
function QuestionsEditor({ questions, onChange }: { questions: AppQuestion[]; onChange: (fn: (q: AppQuestion[]) => void) => void }) {
  const setQ = (i: number, fn: (q: AppQuestion) => void) => onChange((qs) => fn(qs[i]));
  const forms = Math.ceil(questions.length / QUESTIONS_PER_PAGE);
  return (
    <div className="tk-form">
      <div className="sub-head">
        <strong className="small">Questions</strong>
        <small className="muted">
          Applicants answer them in {forms === 1 ? "one pop-up form" : `${forms} pop-up forms, ${QUESTIONS_PER_PAGE} questions each`}. Labels can be up to 45 characters.
        </small>
      </div>
      <div className="rv-fields tk-form-body">
        {questions.map((q, i) => (
          <div key={q.id} className="tk-question">
            {i > 0 && i % QUESTIONS_PER_PAGE === 0 && <div className="sa-page-break small muted">Form {i / QUESTIONS_PER_PAGE + 1}</div>}
            <div className="mod-row">
              <label className="field">
                <span>Question {i + 1}</span>
                <input value={q.label} maxLength={45} onChange={(e) => setQ(i, (x) => { x.label = e.target.value; })} />
              </label>
              <label className="field">
                <span>Answer</span>
                <select value={q.style} onChange={(e) => setQ(i, (x) => { x.style = e.target.value as AppQuestion["style"]; })}>
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
              <button className="btn ghost small" disabled={i === 0} onClick={() => onChange((qs) => { qs.splice(i - 1, 0, ...qs.splice(i, 1)); })}>↑</button>
              <button className="btn ghost small" disabled={i === questions.length - 1} onClick={() => onChange((qs) => { qs.splice(i + 1, 0, ...qs.splice(i, 1)); })}>↓</button>
              <button className="btn danger small" disabled={questions.length === 1} onClick={() => onChange((qs) => { qs.splice(i, 1); })}>Remove</button>
            </div>
          </div>
        ))}
        <button
          className="btn ghost small"
          disabled={questions.length >= MAX_APP_QUESTIONS}
          onClick={() => onChange((qs) => { qs.push(blankQuestion(`Question ${qs.length + 1}`)); })}
        >
          + Add a question ({questions.length}/{MAX_APP_QUESTIONS})
        </button>
      </div>
    </div>
  );
}
