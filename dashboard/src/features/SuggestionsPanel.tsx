import { useEffect, useState } from "react";
import {
  SUGGESTION_LIMITS,
  type SuggestionSettings,
  type SuggestionStatus,
  type SuggestionView,
  type SuggestionsResponse,
  statusInfo,
  suggestionStatuses,
} from "../../../src/shared/suggestions";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const COOLDOWNS = [0, 1, 5, 15, 60, 360, 1440];
const cooldownLabel = (m: number) => (m === 0 ? "No wait" : m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : m === 60 ? "1 hour" : m === 1440 ? "1 day" : `${m / 60} hours`);
const when = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

/** Dashboard section for Suggestions: where they're posted, how they work, and reviewing them. */
export function SuggestionsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [draft, setDraft] = useState<SuggestionSettings | null>(null);
  const [filter, setFilter] = useState<SuggestionStatus | "all">("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = (r: SuggestionsResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };
  useEffect(() => {
    api.suggestions(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading suggestions…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveSuggestionSettings(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const counts = Object.fromEntries(suggestionStatuses.map((st) => [st, data.suggestions.filter((x) => x.status === st).length])) as Record<SuggestionStatus, number>;
  const shown = filter === "all" ? data.suggestions : data.suggestions.filter((x) => x.status === filter);

  return (
    <div className="panel events">
      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}

      <section className="sub">
        <div className="sub-head">
          <strong>⚙️ Settings</strong>
          <small className="muted">Members send ideas with <code>/suggest</code>. Staff review them here or with <code>/suggestion status</code>.</small>
        </div>
        <div className="mod-row">
          <label className="field">
            <span>Post suggestions in</span>
            <ChannelSelect guild={guild} value={draft.channelId} emptyLabel="Choose a channel…" onChange={(v) => setDraft({ ...draft, channelId: v })} />
          </label>
          <label className="field">
            <span>Wait between suggestions</span>
            <select value={draft.cooldownMinutes} onChange={(e) => setDraft({ ...draft, cooldownMinutes: Number(e.target.value) })}>
              {!COOLDOWNS.includes(draft.cooldownMinutes) && <option value={draft.cooldownMinutes}>{cooldownLabel(draft.cooldownMinutes)}</option>}
              {COOLDOWNS.map((m) => <option key={m} value={m}>{cooldownLabel(m)}</option>)}
            </select>
            <small className="muted">Per member. Staff don't wait.</small>
          </label>
        </div>
        <Toggle label="Discussion thread under each suggestion" hint="Closed when the suggestion is implemented or denied." checked={draft.threads} onChange={(v) => setDraft({ ...draft, threads: v })} />
        <Toggle label="Anonymous" hint="Hide who sent each suggestion on the post. Staff still see it here." checked={draft.anonymous} onChange={(v) => setDraft({ ...draft, anonymous: v })} />
        <Toggle label="DM the member when the status changes" checked={draft.dmAuthor} onChange={(v) => setDraft({ ...draft, dmAuthor: v })} />
        <div className="field">
          <span>Who can review (besides Manage Server and Manage Messages)</span>
          <RolePicker guild={guild} anyRole value={draft.reviewerRoleIds} max={SUGGESTION_LIMITS.reviewerRoles} onChange={(v) => setDraft({ ...draft, reviewerRoleIds: v })} />
        </div>
        {error && <p className="error">{error}</p>}
        {dirty && (
          <div className="evt-buttons">
            <button className="btn ghost small" disabled={saving} onClick={() => setDraft(structuredClone(data.settings))}>Discard</button>
            <button className="btn primary small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button>
          </div>
        )}
      </section>

      <div className="ann-filters" role="group" aria-label="Filter suggestions">
        <button className={`ann-filter ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All ({data.suggestions.length})</button>
        {suggestionStatuses.map((st) => (
          <button key={st} className={`ann-filter ${filter === st ? "on" : ""}`} onClick={() => setFilter(st)}>
            {statusInfo[st].emoji} {statusInfo[st].label} ({counts[st]})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card"><p className="muted">{data.suggestions.length ? "Nothing here." : "No suggestions yet. Members can send one with /suggest."}</p></div>
      ) : (
        <ul className="evt-list">
          {shown.map((x) => <SuggestionCard key={x.id} guild={guild} item={x} onChange={setData} />)}
        </ul>
      )}
      {data.suggestions.length >= 100 && <p className="muted small">Showing the newest 100.</p>}
    </div>
  );
}

function SuggestionCard({ guild, item, onChange }: { guild: Guild; item: SuggestionView; onChange: (r: SuggestionsResponse) => void }) {
  const [status, setStatus] = useState<SuggestionStatus>(item.status);
  const [reason, setReason] = useState(item.reason);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = statusInfo[item.status];
  const total = item.up + item.down;

  const run = async (job: () => Promise<SuggestionsResponse>) => {
    setBusy(true);
    setError("");
    try {
      onChange(await job());
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="card evt-item">
      <span className="evt-swatch" style={{ background: info.color }} />
      <div className="evt-item-text">
        <strong>#{item.number} · {item.title}</strong>
        <span className="muted small">
          {info.emoji} {info.label} · by {item.authorName} · {when(item.createdAt)}
          {item.reviewedByName && item.status !== "open" ? ` · reviewed by ${item.reviewedByName}` : ""}
        </span>
        {item.details && <span className="small sg-details">{item.details}</span>}
        <span className="small">
          👍 {item.up} · 👎 {item.down}
          {total > 0 && <span className="muted"> · {Math.round((item.up / total) * 100)}% for</span>}
        </span>
        {item.reason && item.status !== "open" && <span className="small muted">Response: {item.reason}</span>}
        {open && (
          <div className="sg-review">
            <div className="mod-row">
              <label className="field">
                <span>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as SuggestionStatus)}>
                  {suggestionStatuses.map((st) => <option key={st} value={st}>{statusInfo[st].emoji} {statusInfo[st].label}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Response (optional, shown on the post and in the DM)</span>
              <textarea rows={2} maxLength={SUGGESTION_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="evt-buttons">
              <button className="btn ghost small" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary small" disabled={busy} onClick={() => run(() => api.setSuggestionStatus(guild.id, item.id, { status, reason }))}>
                {busy ? "Saving…" : "Save review"}
              </button>
            </div>
          </div>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
      <div className="evt-actions">
        {item.url && <a className="btn ghost small" href={item.url} target="_blank" rel="noreferrer">Open</a>}
        {!open && <button className="btn primary small" onClick={() => setOpen(true)}>Review</button>}
        <button
          className="btn danger small"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete suggestion #${item.number}? Its post, thread and votes are deleted too.`)) void run(() => api.deleteSuggestion(guild.id, item.id));
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
