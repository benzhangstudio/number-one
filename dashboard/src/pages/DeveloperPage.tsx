import { useEffect, useState } from "react";
import {
  type BotUpdateFailure,
  type BotUpdateInput,
  type DeveloperOverview,
  MAX_UPDATE_BODY,
  MAX_UPDATE_TITLE,
} from "../../../src/shared/botUpdates";
import { api } from "../api";
import { Toggle } from "../components/pickers";

const blank: BotUpdateInput = { title: "", body: "", url: "", mention: true };

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

      <div className="dev-grid">
        <div className="card dev-form">
          <h2>New update</h2>
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
          <button className="btn primary" disabled={sending || inProgress || data.receiving === 0} onClick={send}>
            {sending ? "Sending…" : inProgress ? "Wait for the last one to finish" : `Send to ${data.receiving} server${data.receiving === 1 ? "" : "s"}`}
          </button>
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
                    <div className="dc-embed-desc">{draft.body || <span className="muted">Your message</span>}</div>
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
    </section>
  );
}
