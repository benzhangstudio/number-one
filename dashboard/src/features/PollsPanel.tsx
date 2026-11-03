import { useEffect, useState } from "react";
import {
  MAX_OPEN_POLLS,
  POLL_LIMITS,
  type PollCreators,
  type PollInput,
  type PollPingType,
  type PollSettings,
  type PollView,
  type PollVoterView,
  type PollsResponse,
  answerEmojis,
  pollDurationChoices,
} from "../../../src/shared/polls";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";
import { DiscordText } from "../components/DiscordText";

type Guild = GuildDetails["guild"];

const pingLabel: Record<PollPingType, string> = { none: "No ping", everyone: "@everyone", here: "@here", roles: "Roles…" };
const creatorLabel: Record<PollCreators, string> = {
  staff: "Staff only (Manage Messages)",
  everyone: "Everyone",
  roles: "Staff and the roles I pick",
};

const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const durationLabel = (hours: number) => pollDurationChoices.find((c) => c.hours === hours)?.label ?? `${hours} hours`;

const blankPoll = (channelId: string, hours: number): PollInput => ({
  channelId,
  question: "",
  description: "",
  answers: ["", ""],
  multiple: false,
  anonymous: true,
  hideResults: false,
  hours,
  voterRoleIds: [],
  color: "#ff4fa3",
  ping: { type: "none", roleIds: [] },
});

/** Dashboard section for Polls: settings for /poll, open and past polls, and the poll maker. */
export function PollsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<PollsResponse | null>(null);
  const [draft, setDraft] = useState<PollInput | null>(null);
  const [voters, setVoters] = useState<{ poll: PollView; list: PollVoterView[] | null } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = () => api.polls(guild.id).then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading polls…</p>;

  const open = data.polls.filter((p) => p.status === "open");
  const past = data.polls.filter((p) => p.status === "ended");
  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel";
  const firstChannel = guild.channels.find((c) => c.type === 0)?.id ?? "";

  if (draft) {
    return (
      <PollEditor
        guild={guild}
        initial={draft}
        onCancel={() => setDraft(null)}
        onSaved={() => {
          setDraft(null);
          setNotice("Poll posted.");
          void reload();
        }}
      />
    );
  }

  const act = async (p: PollView, run: () => Promise<unknown>, done: string) => {
    setBusy(p.id);
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

  const showVoters = async (p: PollView) => {
    setVoters({ poll: p, list: null });
    try {
      setVoters({ poll: p, list: await api.pollVoters(guild.id, p.id) });
    } catch (err) {
      setError((err as Error).message);
      setVoters(null);
    }
  };

  const card = (p: PollView) => {
    const total = p.counts.reduce((a, b) => a + b, 0);
    return (
      <li key={p.id} className="card evt-item">
        <span className="evt-swatch" style={{ background: p.status === "ended" ? "var(--border)" : p.color }} />
        <div className="evt-item-text">
          <strong>{p.status === "ended" ? "" : "📊 "}{p.question}</strong>
          <span className="muted small">
            #{channelName(p.channelId)} · {plural(p.voters, "voter")} · by {p.createdByTag}
            {p.status === "ended" ? " · ended" : p.endsAt ? ` · ends ${when(p.endsAt)}` : " · open until ended"}
          </span>
          <ul className="poll-results">
            {p.answers.map((a, i) => {
              const share = total ? p.counts[i] / total : 0;
              return (
                <li key={i}>
                  <span className="small">{answerEmojis[i]} {a}</span>
                  <span className="poll-bar"><span style={{ width: `${share * 100}%`, background: p.color }} /></span>
                  <span className="small muted">{Math.round(share * 100)}% · {p.counts[i]}</span>
                </li>
              );
            })}
          </ul>
          {!p.anonymous && p.voters > 0 && (
            <button className="link small poll-voters-link" onClick={() => showVoters(p)}>Who voted</button>
          )}
        </div>
        <div className="evt-actions">
          {p.url && <a className="btn ghost small" href={p.url} target="_blank" rel="noreferrer">Open</a>}
          <button
            className="btn ghost small"
            title="Start a new poll with the same question and answers"
            onClick={() => setDraft({ ...structuredClone(p), ping: { type: "none", roleIds: [] } })}
          >
            Copy
          </button>
          {p.status === "open" && (
            <button
              className="btn primary small"
              disabled={busy === p.id}
              onClick={() => {
                if (confirm(`End "${p.question}" now? Voting stops and the result is posted.`)) void act(p, () => api.endPoll(guild.id, p.id), "Poll ended.");
              }}
            >
              {busy === p.id ? "Ending…" : "End now"}
            </button>
          )}
          <button
            className="btn danger small"
            disabled={busy === p.id}
            onClick={() => {
              if (confirm(`Delete "${p.question}"? The post and its votes are deleted too.`)) void act(p, () => api.deletePoll(guild.id, p.id), "Poll deleted.");
            }}
          >
            Delete
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="panel events">
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <PollSettingsBox guild={guild} settings={data.settings} onSaved={setData} />

      <div className="evt-head">
        <p className="muted small">
          Members vote with buttons and see the results update live. Make polls here or with <code>/poll create</code> in Discord.{" "}
          {open.length}/{MAX_OPEN_POLLS} open.
        </p>
        <button
          className="btn primary small"
          disabled={open.length >= MAX_OPEN_POLLS}
          onClick={() => setDraft(blankPoll(firstChannel, data.settings.defaultHours))}
        >
          New poll
        </button>
      </div>

      {voters && (
        <section className="sub">
          <div className="evt-people-head">
            <strong>Who voted: {voters.poll.question}</strong>
            <button className="link small" onClick={() => setVoters(null)}>Close</button>
          </div>
          {!voters.list ? (
            <p className="muted small">Loading…</p>
          ) : voters.list.length === 0 ? (
            <p className="muted small">Nobody has voted yet.</p>
          ) : (
            <div className="evt-people-cols">
              {voters.poll.answers.map((a, i) => {
                const list = voters.list!.filter((v) => v.answers.includes(i));
                return (
                  <div key={i}>
                    <strong className="small">{answerEmojis[i]} {a} ({list.length})</strong>
                    <ul className="small">{list.map((v) => <li key={v.userId}>{v.name}</li>)}</ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <h3 className="evt-group">Open</h3>
      {open.length === 0 ? (
        <div className="card"><p className="muted">No open polls. Ask your members what game to play next, when to meet, or anything else.</p></div>
      ) : (
        <ul className="evt-list">{open.map(card)}</ul>
      )}
      {past.length > 0 && (
        <>
          <h3 className="evt-group">Ended</h3>
          <ul className="evt-list">{past.map(card)}</ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ settings */

function PollSettingsBox({ guild, settings, onSaved }: { guild: Guild; settings: PollSettings; onSaved: (r: PollsResponse) => void }) {
  const [draft, setDraft] = useState<PollSettings>(structuredClone(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(structuredClone(settings)), [settings]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await api.savePollSettings(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sub">
      <div className="sub-head"><strong>⚙️ Settings</strong></div>
      <div className="mod-row">
        <label className="field">
          <span>Who can use /poll create</span>
          <select value={draft.creators} onChange={(e) => setDraft({ ...draft, creators: e.target.value as PollCreators })}>
            {(Object.keys(creatorLabel) as PollCreators[]).map((c) => <option key={c} value={c}>{creatorLabel[c]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>How long /poll polls stay open</span>
          <select value={draft.defaultHours} onChange={(e) => setDraft({ ...draft, defaultHours: Number(e.target.value) })}>
            {pollDurationChoices.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
          </select>
          <small className="muted">Used when nobody picks a duration.</small>
        </label>
      </div>
      {draft.creators === "roles" && (
        <div className="field">
          <span>Roles that can make polls</span>
          <RolePicker guild={guild} anyRole value={draft.creatorRoleIds} max={POLL_LIMITS.roles} onChange={(v) => setDraft({ ...draft, creatorRoleIds: v })} />
        </div>
      )}
      <Toggle
        label="Post the result when a poll ends"
        hint="Replies to the poll with the winning answer and how many people voted."
        checked={draft.announceResults}
        onChange={(v) => setDraft({ ...draft, announceResults: v })}
      />
      {error && <p className="error">{error}</p>}
      {dirty && (
        <div className="evt-buttons">
          <button className="btn ghost small" disabled={saving} onClick={() => setDraft(structuredClone(settings))}>Discard</button>
          <button className="btn primary small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ poll maker */

function PollEditor({ guild, initial, onCancel, onSaved }: { guild: Guild; initial: PollInput; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState<PollInput>(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (x: PollInput) => void) =>
    setD((x) => {
      const next = structuredClone(x);
      fn(next);
      return next;
    });

  const answers = d.answers.map((a) => a.trim());
  const filled = answers.filter(Boolean);
  const problem =
    (!d.question.trim() ? "Write the question." : null) ??
    (!d.channelId ? "Pick a channel to post it in." : null) ??
    (filled.length < POLL_LIMITS.minAnswers ? `Add at least ${POLL_LIMITS.minAnswers} answers.` : null) ??
    (new Set(filled.map((a) => a.toLowerCase())).size !== filled.length ? "Two answers are the same." : null) ??
    (d.ping.type === "roles" && !d.ping.roleIds.length ? "Pick at least one role to ping." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.createPoll(guild.id, { ...d, answers: filled });
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
          <span>Question <small className="muted">({d.question.length}/{POLL_LIMITS.question})</small></span>
          <input value={d.question} maxLength={POLL_LIMITS.question} placeholder="e.g. What should we play on Friday?" onChange={(e) => set((x) => { x.question = e.target.value; })} />
        </label>
        <label className="field">
          <span>Extra details (optional)</span>
          <textarea rows={2} maxLength={POLL_LIMITS.description} value={d.description} onChange={(e) => set((x) => { x.description = e.target.value; })} />
        </label>

        <section className="sub">
          <div className="sub-head"><strong>Answers</strong> <small className="muted">{d.answers.length}/{POLL_LIMITS.maxAnswers}</small></div>
          {d.answers.map((a, i) => (
            <div key={i} className="poll-answer-row">
              <span>{answerEmojis[i]}</span>
              <input
                value={a}
                maxLength={POLL_LIMITS.answer}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => set((x) => { x.answers[i] = e.target.value; })}
              />
              <button
                className="btn ghost small"
                disabled={d.answers.length <= POLL_LIMITS.minAnswers}
                title="Remove this answer"
                onClick={() => set((x) => { x.answers.splice(i, 1); })}
              >
                ✕
              </button>
            </div>
          ))}
          {d.answers.length < POLL_LIMITS.maxAnswers && (
            <button className="btn ghost small poll-add" onClick={() => set((x) => { x.answers.push(""); })}>+ Add answer</button>
          )}
        </section>

        <div className="mod-row">
          <label className="field">
            <span>Post in</span>
            <ChannelSelect guild={guild} value={d.channelId || null} onChange={(v) => set((x) => { x.channelId = v ?? ""; })} />
          </label>
          <label className="field">
            <span>Stays open for</span>
            <select value={d.hours} onChange={(e) => set((x) => { x.hours = Number(e.target.value); })}>
              {!pollDurationChoices.some((c) => c.hours === d.hours) && <option value={d.hours}>{durationLabel(d.hours)}</option>}
              {pollDurationChoices.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mod-row">
          <label className="field">
            <span>Ping when posted</span>
            <select value={d.ping.type} onChange={(e) => set((x) => { x.ping.type = e.target.value as PollPingType; })}>
              {(Object.keys(pingLabel) as PollPingType[]).map((p) => <option key={p} value={p}>{pingLabel[p]}</option>)}
            </select>
          </label>
          <label className="field evt-color">
            <span>Colour</span>
            <input type="color" value={d.color} onChange={(e) => set((x) => { x.color = e.target.value; })} />
          </label>
        </div>
        {d.ping.type === "roles" && (
          <div className="field">
            <span>Roles to ping</span>
            <RolePicker guild={guild} anyRole value={d.ping.roleIds} max={POLL_LIMITS.pingRoles} onChange={(v) => set((x) => { x.ping.roleIds = v; })} />
          </div>
        )}
        <div className="field">
          <span>Who can vote (everyone if empty)</span>
          <RolePicker guild={guild} anyRole value={d.voterRoleIds} max={POLL_LIMITS.roles} onChange={(v) => set((x) => { x.voterRoleIds = v; })} />
        </div>
        <Toggle label="Allow more than one answer" checked={d.multiple} onChange={(v) => set((x) => { x.multiple = v; })} />
        <Toggle
          label="Anonymous"
          hint="Nobody (not even staff) can see who voted for what. Turn off to list voters under each answer."
          checked={d.anonymous}
          onChange={(v) => set((x) => { x.anonymous = v; })}
        />
        <Toggle
          label="Hide results until it ends"
          hint="Stops people from just following the crowd."
          checked={d.hideResults}
          onChange={(v) => set((x) => { x.hideResults = v; })}
        />

        {error && <p className="error">{error}</p>}
        <div className="evt-buttons">
          <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
            {saving ? "Posting…" : "Post poll"}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>

      <div className="evt-preview-wrap">
        <div className="muted small">Preview</div>
        <PollPreview guild={guild} d={{ ...d, answers: answers.map((a, i) => a || `Answer ${i + 1}`) }} />
      </div>
    </div>
  );
}

function PollPreview({ guild, d }: { guild: Guild; d: PollInput }) {
  const footer = ["0 voters", d.multiple ? "Pick as many as you like" : "Pick one", d.anonymous ? "Anonymous" : "Votes are public", d.hideResults ? "Results show when the poll ends." : "Press a button to vote."];
  return (
    <div className="evt-preview">
      <div className="evt-preview-author">
        <span className="evt-preview-avatar">1</span>
        <strong>Number One</strong>
        <span className="evt-preview-bot">APP</span>
      </div>
      <div className="evt-preview-embed" style={{ borderLeftColor: d.color }}>
        <div className="evt-preview-title">📊 {d.question || "Your question"}</div>
        {d.description.trim() && <div className="evt-preview-desc"><DiscordText text={d.description} guild={guild} /></div>}
        {d.answers.map((a, i) => (
          <div key={i} className="evt-preview-field">
            <strong>{answerEmojis[i]} {a}</strong>
            {!d.hideResults && <span className="poll-preview-bar">░░░░░░░░░░░░ 0% · 0 votes</span>}
          </div>
        ))}
        {d.hours > 0 && (
          <div className="evt-preview-field">
            <strong>🕒 Ends</strong>
            <span>in {durationLabel(d.hours).toLowerCase()}</span>
          </div>
        )}
        <div className="evt-preview-footer">{footer.join(" · ")}</div>
      </div>
      <div className="evt-preview-buttons">
        {d.answers.map((a, i) => <span key={i}>{answerEmojis[i]} {a}</span>)}
      </div>
    </div>
  );
}
