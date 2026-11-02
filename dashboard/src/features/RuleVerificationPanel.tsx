import { useEffect, useState } from "react";
import {
  type RuleVerificationResponse,
  type RuleVerificationSettings,
  type VerifyButtonStyle,
  verifyButtonStyles,
} from "../../../src/shared/ruleVerification";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RoleSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const styleNames: Record<VerifyButtonStyle, { label: string; color: string }> = {
  success: { label: "Green", color: "#248046" },
  primary: { label: "Blurple", color: "#5865f2" },
  secondary: { label: "Grey", color: "#4e5058" },
  danger: { label: "Red", color: "#da373c" },
};

/** Dashboard section for Rule verification: the rules message, its button, and the roles it gives and takes. */
export function RuleVerificationPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<RuleVerificationResponse | null>(null);
  const [draft, setDraft] = useState<RuleVerificationSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: RuleVerificationResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.ruleVerification(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading rule verification…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: RuleVerificationSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const problem =
    (!draft.channelId ? "Pick a channel for the rules." : null) ??
    (!draft.verifiedRoleId ? "Pick the role people get when they agree." : null) ??
    (draft.unverifiedRoleId && draft.unverifiedRoleId === draft.verifiedRoleId ? "The verified and unverified roles must be different." : null) ??
    (draft.giveUnverifiedOnJoin && !draft.unverifiedRoleId ? "Pick an unverified role to give new members." : null) ??
    (!draft.buttonLabel.trim() ? "The button needs a label." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveRuleVerification(guild.id, draft));
      setNotice(data.messageUrl ? "Saved. The rules message is updated." : "Saved and posted.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel rule-verification">
      <div className="stats">
        <div><strong>{data.verifiedCount ?? "–"}</strong><span className="muted small">have agreed</span></div>
        <div><strong>{data.unverifiedCount ?? "–"}</strong><span className="muted small">still unverified</span></div>
        <div>
          <strong>{data.messageUrl ? "Posted" : "Not yet"}</strong>
          <span className="muted small">
            {data.messageUrl ? <a href={data.messageUrl} target="_blank" rel="noreferrer">Open the rules message</a> : "Save to post the rules"}
          </span>
        </div>
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

      <div className="rv-editor">
        <div className="rv-form">
          <section className="sub">
            <div className="sub-head"><strong>📜 The rules</strong></div>
            <div className="sub-body rv-fields">
              <label className="field">
                <span>Post in</span>
                <ChannelSelect guild={guild} value={draft.channelId} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.channelId = v; })} />
              </label>
              <div className="mod-row">
                <label className="field">
                  <span>Title</span>
                  <input value={draft.title} maxLength={256} onChange={(e) => set((d) => { d.title = e.target.value; })} />
                </label>
                <label className="field rv-color">
                  <span>Colour</span>
                  <input type="color" value={draft.color} onChange={(e) => set((d) => { d.color = e.target.value; })} />
                </label>
              </div>
              <label className="field">
                <span>Rules <small className="muted">({draft.rules.length}/4000)</small></span>
                <textarea rows={8} maxLength={4000} value={draft.rules} onChange={(e) => set((d) => { d.rules = e.target.value; })} />
                <small className="muted">Discord formatting works: **bold**, *italic*, lists and links.</small>
              </label>
              <label className="field">
                <span>Image link (optional)</span>
                <input value={draft.image} maxLength={1000} placeholder="https://…" onChange={(e) => set((d) => { d.image = e.target.value; })} />
              </label>
            </div>
          </section>

          <section className="sub">
            <div className="sub-head"><strong>🔘 The button</strong></div>
            <div className="sub-body rv-fields">
              <div className="mod-row">
                <label className="field">
                  <span>Label</span>
                  <input value={draft.buttonLabel} maxLength={80} onChange={(e) => set((d) => { d.buttonLabel = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Emoji (optional)</span>
                  <input value={draft.buttonEmoji} maxLength={8} placeholder="✅" onChange={(e) => set((d) => { d.buttonEmoji = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Colour</span>
                  <select value={draft.buttonStyle} onChange={(e) => set((d) => { d.buttonStyle = e.target.value as VerifyButtonStyle; })}>
                    {verifyButtonStyles.map((st) => <option key={st} value={st}>{styleNames[st].label}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Reply after agreeing (only they see it)</span>
                <input value={draft.successMessage} maxLength={500} onChange={(e) => set((d) => { d.successMessage = e.target.value; })} />
              </label>
            </div>
          </section>

          <section className="sub">
            <div className="sub-head">
              <strong>🎭 Roles</strong>
              <small className="muted">To keep channels hidden until people agree, allow them only for the verified role (or deny them for the unverified role).</small>
            </div>
            <div className="sub-body rv-fields">
              <label className="field">
                <span>Give this role when they agree</span>
                <RoleSelect guild={guild} value={draft.verifiedRoleId} emptyLabel="Choose a role…" onChange={(v) => set((d) => { d.verifiedRoleId = v; })} />
              </label>
              <label className="field">
                <span>Take this role away when they agree (optional)</span>
                <RoleSelect guild={guild} value={draft.unverifiedRoleId} emptyLabel="None" onChange={(v) => set((d) => { d.unverifiedRoleId = v; })} />
                {draft.unverifiedRoleId && (
                  <button className="link small" onClick={() => set((d) => { d.unverifiedRoleId = null; d.giveUnverifiedOnJoin = false; })}>Don't take a role away</button>
                )}
              </label>
              {draft.unverifiedRoleId && (
                <Toggle
                  label="Give that role to everyone who joins"
                  hint="New members start as unverified until they agree."
                  checked={draft.giveUnverifiedOnJoin}
                  onChange={(v) => set((d) => { d.giveUnverifiedOnJoin = v; })}
                />
              )}
            </div>
          </section>
        </div>

        <div className="rv-preview-wrap">
          <div className="muted small">Preview</div>
          <div className="rv-preview">
            <div className="rv-preview-author">
              <span className="rv-preview-avatar">1</span>
              <strong>Number One</strong>
              <span className="rv-preview-bot">APP</span>
            </div>
            <div className="rv-preview-embed" style={{ borderLeftColor: draft.color }}>
              {draft.title && <div className="rv-preview-title">{draft.title}</div>}
              <div className="rv-preview-desc">{draft.rules.trim() || "Please read and accept the rules."}</div>
              {draft.image && <img className="rv-preview-image" src={draft.image} alt="" />}
            </div>
            <span className="rv-preview-button" style={{ background: styleNames[draft.buttonStyle].color }}>
              {draft.buttonEmoji} {draft.buttonLabel || "I agree"}
            </span>
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : data.messageUrl ? "No changes to save." : "The rules aren't posted yet."}</span>
        <button className="btn ghost small" disabled={saving || !dirty} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
        <button className="btn primary small" disabled={saving || Boolean(problem) || (!dirty && Boolean(data.messageUrl))} title={problem ?? undefined} onClick={save}>
          {saving ? "Saving…" : data.messageUrl ? "Save changes" : "Save and post"}
        </button>
      </div>
      {problem && <small className="muted">{problem}</small>}
    </div>
  );
}
