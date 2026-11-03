import { useEffect, useState } from "react";
import type { BotUpdateSettings, BotUpdatesPanelData } from "../../../src/shared/botUpdates";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RoleSelect } from "../components/pickers";

type Guild = GuildDetails["guild"];

/** Dashboard section for Number One updates: the channel to post in and an optional role to mention. */
export function BotUpdatesPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<BotUpdatesPanelData | null>(null);
  const [draft, setDraft] = useState<BotUpdateSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = (r: BotUpdatesPanelData) => {
    setData(r);
    setDraft({ ...r.settings });
  };

  useEffect(() => {
    api.botUpdates(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(async () => load(await api.saveBotUpdates(guild.id, draft)));
  const test = () =>
    run(async () => {
      await api.testBotUpdates(guild.id);
      setNotice("Sent a test update. Check the channel.");
    });

  return (
    <div className="panel">
      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => (
            <span key={p} className="small">
              ⚠️ {p}
            </span>
          ))}
        </div>
      )}
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}

      <section className="sub">
        <div className="sub-head">
          <strong>Channel</strong>
          <small className="muted">Where news about Number One is posted. Without a channel, this server doesn't get updates.</small>
        </div>
        <div className="sub-body">
          <ChannelSelect guild={guild} value={draft.channelId} emptyLabel="Choose a channel…" onChange={(v) => setDraft({ ...draft, channelId: v })} />
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>Role to mention</strong>
          <small className="muted">Optional. Mentioned when an update is posted, so the right people see it.</small>
        </div>
        <div className="sub-body">
          <RoleSelect guild={guild} value={draft.roleId} emptyLabel="No mention" onChange={(v) => setDraft({ ...draft, roleId: v })} />
          {draft.roleId && (
            <button className="link small" onClick={() => setDraft({ ...draft, roleId: null })}>
              Don't mention a role
            </button>
          )}
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : "No changes to save."}</span>
        {!dirty && data.settings.channelId && (
          <button className="btn ghost small" disabled={busy} onClick={test}>
            Send a test
          </button>
        )}
        <button className="btn ghost small" disabled={busy || !dirty} onClick={() => setDraft({ ...data.settings })}>
          Discard
        </button>
        <button className="btn primary small" disabled={busy || !dirty} onClick={save}>
          {busy && dirty ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
