import { useEffect, useState } from "react";
import {
  DEFAULT_FORUM_WELCOME,
  FORUM_LIMITS,
  type ForumInput,
  type ForumPostView,
  type ForumView,
  type ForumsResponse,
  type PostAction,
  autoArchiveChoices,
  slowmodeChoices,
} from "../../../src/shared/forums";
import { type GuildDetails, api } from "../api";
import { EmojiInput, EmojiView } from "../components/emoji";
import { CategorySelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];
type Tab = "posts" | "settings" | "helpers";

const AUTO_CLOSE = [0, 1, 3, 7, 14, 30];
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

const blankForum = (): ForumInput => ({
  name: "",
  parentId: null,
  guidelines: "",
  tags: [
    { id: null, name: "Question", emoji: "❓", moderated: false },
    { id: null, name: "Idea", emoji: "💡", moderated: false },
    { id: null, name: "Solved", emoji: "✅", moderated: false },
  ],
  defaultReaction: "👍",
  sortOrder: "activity",
  layout: "list",
  requireTag: false,
  postSlowmode: 0,
  autoArchiveMinutes: 10080,
});

/** Dashboard section for Forums: every forum channel, its posts, its Discord settings and Number One's helpers. */
export function ForumsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<ForumsResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = () => api.forums(guild.id).then(setData).catch((err) => setError(err.message));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading forums…</p>;

  if (creating) {
    return (
      <div className="panel events">
        <h3 className="evt-group">New forum</h3>
        <ForumEditor
          guild={guild}
          initial={blankForum()}
          saveLabel="Create forum"
          onCancel={() => setCreating(false)}
          onSave={async (input) => {
            const r = await api.createForum(guild.id, input);
            setData(r);
            setCreating(false);
            setNotice(`#${input.name} was created. Open it below to set up its helpers.`);
          }}
        />
      </div>
    );
  }

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
      <div className="evt-head">
        <p className="muted small">
          Manage your forum channels without leaving the dashboard. Number One can also welcome new posts, let people mark them solved with{" "}
          <code>/post solved</code>, and close posts that have gone quiet.
        </p>
        <button className="btn primary small" onClick={() => setCreating(true)}>New forum</button>
      </div>

      {data.forums.length === 0 ? (
        <div className="card"><p className="muted">This server has no forum channels yet. Make one for questions, ideas, showcases or help.</p></div>
      ) : (
        <ul className="evt-list">
          {data.forums.map((f) => (
            <ForumCard key={f.id} guild={guild} forum={f} open={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)} onChange={setData} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ForumCard({ guild, forum, open, onToggle, onChange }: { guild: Guild; forum: ForumView; open: boolean; onToggle: () => void; onChange: (r: ForumsResponse) => void }) {
  const [tab, setTab] = useState<Tab>("posts");
  const helpers = [forum.automation.welcome.enabled && "welcome", forum.automation.solved.enabled && "/post solved", forum.automation.autoCloseDays > 0 && `closes after ${forum.automation.autoCloseDays}d`].filter(Boolean);
  return (
    <li className="card fr-card">
      <div className="evt-item">
        <span className="evt-swatch fr-swatch">🧵</span>
        <div className="evt-item-text">
          <strong>#{forum.name}</strong>
          <span className="muted small">
            {forum.openCount} open post{forum.openCount === 1 ? "" : "s"} · {forum.tags.length} tag{forum.tags.length === 1 ? "" : "s"}
            {helpers.length ? ` · ${helpers.join(", ")}` : ""}
          </span>
        </div>
        <div className="evt-actions">
          <a className="btn ghost small" href={forum.url} target="_blank" rel="noreferrer">Open</a>
          <button className={`btn small ${open ? "ghost" : "primary"}`} onClick={onToggle}>{open ? "Close" : "Manage"}</button>
        </div>
      </div>
      {open && (
        <div className="fr-body">
          <div className="cc-tabs">
            {(
              [
                ["posts", "📝 Posts"],
                ["settings", "⚙️ Forum settings"],
                ["helpers", "✨ Number One helpers"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={`cc-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === "posts" && <PostList guild={guild} forum={forum} onChange={onChange} />}
          {tab === "settings" && (
            <ForumEditor
              guild={guild}
              initial={toInput(forum)}
              saveLabel="Save forum settings"
              onSave={async (input) => onChange(await api.updateForum(guild.id, forum.id, input))}
            />
          )}
          {tab === "helpers" && <Helpers guild={guild} forum={forum} onChange={onChange} />}
        </div>
      )}
    </li>
  );
}

function toInput(f: ForumView): ForumInput {
  return {
    name: f.name,
    parentId: f.parentId,
    guidelines: f.guidelines,
    tags: structuredClone(f.tags),
    defaultReaction: f.defaultReaction,
    sortOrder: f.sortOrder,
    layout: f.layout,
    requireTag: f.requireTag,
    postSlowmode: f.postSlowmode,
    autoArchiveMinutes: f.autoArchiveMinutes,
  };
}

/* ------------------------------------------------------------ posts */

function PostList({ guild, forum, onChange }: { guild: Guild; forum: ForumView; onChange: (r: ForumsResponse) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tagOf = (id: string) => forum.tags.find((t) => t.id === id);

  const act = async (p: ForumPostView, job: () => Promise<ForumsResponse>) => {
    setBusy(p.id);
    setError("");
    try {
      onChange(await job());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const action = (p: ForumPostView, a: PostAction) => act(p, () => api.forumPostAction(guild.id, forum.id, p.id, a));

  if (forum.posts.length === 0) return <p className="muted small">No posts yet.</p>;
  return (
    <>
      {error && <p className="error small">{error}</p>}
      <ul className="fr-posts">
        {forum.posts.map((p) => (
          <li key={p.id} className={p.closed ? "closed" : undefined}>
            <div className="fr-post-text">
              <strong>
                {p.pinned && "📌 "}
                {p.locked && "🔐 "}
                {p.name}
              </strong>
              <span className="muted small">
                by {p.ownerName} · {p.messages} message{p.messages === 1 ? "" : "s"} · {p.closed ? "closed" : `active ${ago(p.lastActive)}`}
              </span>
              {p.tags.length > 0 && (
                <span className="fr-tags">
                  {p.tags.map((id) => {
                    const t = tagOf(id);
                    return t ? <span key={id} className="fr-tag">{t.emoji && <EmojiView display={t.emoji} />}{t.name}</span> : null;
                  })}
                </span>
              )}
            </div>
            <div className="evt-actions">
              <a className="btn ghost small" href={p.url} target="_blank" rel="noreferrer">Open</a>
              {p.closed ? (
                <button className="btn ghost small" disabled={busy === p.id} onClick={() => action(p, "reopen")}>Reopen</button>
              ) : (
                <>
                  <button className="btn ghost small" disabled={busy === p.id} onClick={() => action(p, p.pinned ? "unpin" : "pin")}>{p.pinned ? "Unpin" : "Pin"}</button>
                  <button className="btn ghost small" disabled={busy === p.id} onClick={() => action(p, p.locked ? "unlock" : "lock")}>{p.locked ? "Unlock" : "Lock"}</button>
                  <button className="btn ghost small" disabled={busy === p.id} onClick={() => action(p, "close")}>Close</button>
                </>
              )}
              <button
                className="btn danger small"
                disabled={busy === p.id}
                onClick={() => {
                  if (confirm(`Delete the post "${p.name}" and all its messages? This can't be undone.`)) void act(p, () => api.deleteForumPost(guild.id, forum.id, p.id));
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">Shows open posts and the 10 most recently closed ones.</p>
    </>
  );
}

/* ------------------------------------------------------------ forum settings */

function ForumEditor({
  guild,
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  guild: Guild;
  initial: ForumInput;
  saveLabel: string;
  onSave: (input: ForumInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [d, setD] = useState<ForumInput>(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (x: ForumInput) => void) =>
    setD((x) => {
      const next = structuredClone(x);
      fn(next);
      return next;
    });
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const names = d.tags.map((t) => t.name.trim().toLowerCase());
  const problem =
    (!d.name.trim() ? "Give the forum a name." : null) ??
    (d.tags.some((t) => !t.name.trim()) ? "Every tag needs a name." : null) ??
    (new Set(names).size !== names.length ? "Two tags have the same name." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(d);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fr-editor">
      <div className="mod-row">
        <label className="field">
          <span>Name</span>
          <input value={d.name} maxLength={FORUM_LIMITS.name} placeholder="e.g. help" onChange={(e) => set((x) => { x.name = e.target.value; })} />
        </label>
        <label className="field">
          <span>Category</span>
          <CategorySelect guild={guild} value={d.parentId} onChange={(v) => set((x) => { x.parentId = v; })} />
        </label>
      </div>
      <label className="field">
        <span>Post guidelines <small className="muted">({d.guidelines.length}/{FORUM_LIMITS.guidelines})</small></span>
        <textarea rows={3} maxLength={FORUM_LIMITS.guidelines} value={d.guidelines} placeholder="Shown at the top of the forum. Tell people what to post here." onChange={(e) => set((x) => { x.guidelines = e.target.value; })} />
      </label>

      <div className="field">
        <span>Tags <small className="muted">({d.tags.length}/{FORUM_LIMITS.tags})</small></span>
        <div className="fr-tag-rows">
          {d.tags.map((t, i) => (
            <div key={t.id ?? `new-${i}`} className="fr-tag-row">
              <EmojiInput guild={guild} value={t.emoji} onChange={(v) => set((x) => { x.tags[i].emoji = v; })} />
              <input value={t.name} maxLength={FORUM_LIMITS.tagName} placeholder="Tag name" onChange={(e) => set((x) => { x.tags[i].name = e.target.value; })} />
              <label className="check small" title="Only staff can add this tag to posts">
                <input type="checkbox" checked={t.moderated} onChange={(e) => set((x) => { x.tags[i].moderated = e.target.checked; })} />
                <span>Staff only</span>
              </label>
              <button className="btn ghost small" title="Remove this tag" onClick={() => set((x) => { x.tags.splice(i, 1); })}>✕</button>
            </div>
          ))}
          {d.tags.length < FORUM_LIMITS.tags && (
            <button className="btn ghost small fr-add" onClick={() => set((x) => { x.tags.push({ id: null, name: "", emoji: "", moderated: false }); })}>+ Add tag</button>
          )}
        </div>
      </div>
      <Toggle label="People must pick a tag when posting" checked={d.requireTag} onChange={(v) => set((x) => { x.requireTag = v; })} />

      <div className="mod-row">
        <label className="field">
          <span>Default reaction</span>
          <EmojiInput guild={guild} value={d.defaultReaction} onChange={(v) => set((x) => { x.defaultReaction = v; })} />
          {d.defaultReaction && <button className="link small" onClick={() => set((x) => { x.defaultReaction = ""; })}>No reaction</button>}
        </label>
        <label className="field">
          <span>Sort posts by</span>
          <select value={d.sortOrder} onChange={(e) => set((x) => { x.sortOrder = e.target.value as ForumInput["sortOrder"]; })}>
            <option value="activity">Recent activity</option>
            <option value="created">Newest first</option>
          </select>
        </label>
        <label className="field">
          <span>Layout</span>
          <select value={d.layout} onChange={(e) => set((x) => { x.layout = e.target.value as ForumInput["layout"]; })}>
            <option value="list">List</option>
            <option value="gallery">Gallery (big pictures)</option>
          </select>
        </label>
      </div>
      <div className="mod-row">
        <label className="field">
          <span>Wait between new posts</span>
          <select value={d.postSlowmode} onChange={(e) => set((x) => { x.postSlowmode = Number(e.target.value); })}>
            {!slowmodeChoices.some((c) => c.seconds === d.postSlowmode) && <option value={d.postSlowmode}>{d.postSlowmode} seconds</option>}
            {slowmodeChoices.map((c) => <option key={c.seconds} value={c.seconds}>{c.label}</option>)}
          </select>
          <small className="muted">Per member.</small>
        </label>
        <label className="field">
          <span>Hide quiet posts after</span>
          <select value={d.autoArchiveMinutes} onChange={(e) => set((x) => { x.autoArchiveMinutes = Number(e.target.value) as ForumInput["autoArchiveMinutes"]; })}>
            {autoArchiveChoices.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
          </select>
          <small className="muted">Discord tucks them away. A new message brings them back.</small>
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="evt-buttons">
        {onCancel && <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>}
        {!onCancel && dirty && <button className="btn ghost small" disabled={saving} onClick={() => setD(structuredClone(initial))}>Discard</button>}
        <button className="btn primary small" disabled={saving || Boolean(problem) || (!onCancel && !dirty)} title={problem ?? undefined} onClick={save}>
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
      {problem && <small className="muted">{problem}</small>}
    </div>
  );
}

/* ------------------------------------------------------------ helpers */

function Helpers({ guild, forum, onChange }: { guild: Guild; forum: ForumView; onChange: (r: ForumsResponse) => void }) {
  const initial = forum.automation;
  const [welcome, setWelcome] = useState(structuredClone(initial.welcome));
  const [solved, setSolved] = useState(structuredClone(initial.solved));
  const [autoCloseDays, setAutoCloseDays] = useState(initial.autoCloseDays);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify({ welcome, solved, autoCloseDays }) !== JSON.stringify({ welcome: initial.welcome, solved: initial.solved, autoCloseDays: initial.autoCloseDays });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onChange(await api.saveForumHelpers(guild.id, forum.id, { welcome, solved, autoCloseDays }));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fr-editor">
      <Toggle label="👋 Welcome new posts" hint="Number One replies in every new post." checked={welcome.enabled} onChange={(v) => setWelcome({ ...welcome, enabled: v })} />
      {welcome.enabled && (
        <label className="field">
          <span>Message <small className="muted">({welcome.message.length}/{FORUM_LIMITS.welcome})</small></span>
          <textarea rows={2} maxLength={FORUM_LIMITS.welcome} value={welcome.message} placeholder={DEFAULT_FORUM_WELCOME} onChange={(e) => setWelcome({ ...welcome, message: e.target.value })} />
          <small className="muted">{"{user}"} mentions whoever made the post.</small>
        </label>
      )}
      <Toggle
        label="✅ /post solved"
        hint="The person who posted, or staff, can mark the post solved. It gets a Solved tag (made for you if the forum doesn't have one)."
        checked={solved.enabled}
        onChange={(v) => setSolved({ ...solved, enabled: v })}
      />
      {solved.enabled && <Toggle label="Close the post once it's solved" checked={solved.closeOnSolve} onChange={(v) => setSolved({ ...solved, closeOnSolve: v })} />}
      <label className="field">
        <span>💤 Close posts that go quiet</span>
        <select value={autoCloseDays} onChange={(e) => setAutoCloseDays(Number(e.target.value))}>
          {AUTO_CLOSE.map((d) => <option key={d} value={d}>{d === 0 ? "Never" : `After ${d} day${d === 1 ? "" : "s"} with no messages`}</option>)}
        </select>
        <small className="muted">Pinned posts stay open. Anyone can reopen a closed post by sending a message.</small>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="evt-buttons">
        {saved && !dirty && <span className="muted small">Saved.</span>}
        <button className="btn primary small" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save helpers"}</button>
      </div>
    </div>
  );
}
