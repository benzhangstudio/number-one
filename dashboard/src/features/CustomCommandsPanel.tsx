import { useEffect, useState } from "react";
import {
  COMMAND_PLACEHOLDERS,
  type CustomCommandInput,
  type CustomCommandView,
  type CustomCommandsResponse,
  MAX_ALLOWED_ROLES,
  MAX_CUSTOM_COMMANDS,
  MAX_RULES,
  RESERVED_NAMES,
  type RulesSettings,
  replyProblem,
} from "../../../src/shared/customCommands";
import { type GuildDetails, api } from "../api";
import { RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const blank = (): CustomCommandInput => ({
  name: "",
  description: "",
  content: "",
  useEmbed: true,
  embed: { title: "", description: "", color: "#ff4fa3", image: "", footer: "" },
  allowedRoleIds: [],
});

/** Dashboard section for Custom commands: the server's commands, and the editor. */
export function CustomCommandsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<CustomCommandsResponse | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; draft: CustomCommandInput } | null>(null);
  const [tab, setTab] = useState<"commands" | "rules">("commands");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.customCommands(guild.id).then(setData).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading custom commands…</p>;

  if (editing) {
    return (
      <CommandEditor
        guild={guild}
        id={editing.id}
        initial={editing.draft}
        taken={data.commands.filter((c) => c.id !== editing.id).map((c) => c.name)}
        onCancel={() => setEditing(null)}
        onSaved={(r) => {
          setData(r);
          setEditing(null);
          setNotice("Saved. It can take a moment to show up in Discord's command list.");
        }}
      />
    );
  }

  const remove = async (c: CustomCommandView) => {
    if (!confirm(`Delete /${c.name}? It disappears from Discord's command list too.`)) return;
    try {
      setData(await api.deleteCustomCommand(guild.id, c.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const tabs = (
    <div className="cc-tabs">
      <button className={`cc-tab ${tab === "commands" ? "on" : ""}`} onClick={() => setTab("commands")}>Commands ({data.commands.length})</button>
      <button className={`cc-tab ${tab === "rules" ? "on" : ""}`} onClick={() => setTab("rules")}>
        Rules <code>/rule</code> {data.rules.enabled ? "· on" : ""}
      </button>
    </div>
  );

  if (tab === "rules") {
    return (
      <div className="panel custom-commands">
        {tabs}
        <RulesEditor guild={guild} initial={data.rules} onSaved={(r) => setData(r)} />
      </div>
    );
  }

  return (
    <div className="panel custom-commands">
      {tabs}
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
      <div className="cc-head">
        <p className="muted small">
          Make your own slash commands for this server, like <code>/faq</code> or <code>/ip</code>. Anyone can use them (or only roles you pick), and
          the reply is posted publicly in the channel. {data.commands.length}/{MAX_CUSTOM_COMMANDS} used.
        </p>
        <button className="btn primary small" disabled={data.commands.length >= MAX_CUSTOM_COMMANDS} onClick={() => setEditing({ id: null, draft: blank() })}>
          New command
        </button>
      </div>
      {data.commands.length === 0 ? (
        <div className="card"><p className="muted">No custom commands yet.</p></div>
      ) : (
        <ul className="cc-list">
          {data.commands.map((c) => (
            <li key={c.id} className="card cc-item">
              <div className="cc-item-text">
                <strong><code>/{c.name}</code></strong>
                <span className="muted small">
                  {c.description} · used {c.uses.toLocaleString()} time{c.uses === 1 ? "" : "s"}
                  {c.allowedRoleIds.length ? " · some roles only" : ""}
                </span>
              </div>
              <div className="cc-actions">
                <button className="btn ghost small" onClick={() => setEditing({ id: c.id, draft: structuredClone(c) })}>Edit</button>
                <button className="btn danger small" onClick={() => remove(c)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommandEditor({
  guild,
  id,
  initial,
  taken,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: number | null;
  initial: CustomCommandInput;
  taken: string[];
  onCancel: () => void;
  onSaved: (r: CustomCommandsResponse) => void;
}) {
  const [c, setC] = useState<CustomCommandInput>(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (d: CustomCommandInput) => void) =>
    setC((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const name = c.name.trim().toLowerCase();
  const problem =
    (!/^[a-z0-9_-]{1,32}$/.test(name) ? "Command names can only use lowercase letters, numbers, - and _ (up to 32)." : null) ??
    (RESERVED_NAMES.includes(name) ? `/${name} is already one of Number One's commands.` : null) ??
    (taken.includes(name) ? `There's already a /${name} command.` : null) ??
    (!c.description.trim() ? "Add a short description." : null) ??
    replyProblem(c);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = { ...c, name };
      onSaved(id ? await api.updateCustomCommand(guild.id, id, body) : await api.createCustomCommand(guild.id, body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const e = c.embed;
  return (
    <div className="panel custom-commands cc-editor">
      <div className="cc-form">
        <div className="mod-row">
          <label className="field">
            <span>Command</span>
            <div className="cc-name">
              <span>/</span>
              <input
                value={c.name}
                maxLength={32}
                placeholder="faq"
                onChange={(ev) => set((d) => { d.name = ev.target.value.toLowerCase().replace(/\s+/g, "-"); })}
              />
            </div>
          </label>
          <label className="field">
            <span>Description (shown in Discord's command list)</span>
            <input value={c.description} maxLength={100} placeholder="Answers to common questions" onChange={(ev) => set((d) => { d.description = ev.target.value; })} />
          </label>
        </div>
        <label className="field">
          <span>Reply text <small className="muted">({c.content.length}/2000)</small></span>
          <textarea rows={3} maxLength={2000} value={c.content} onChange={(ev) => set((d) => { d.content = ev.target.value; })} />
          <small className="muted">
            You can use{" "}
            {COMMAND_PLACEHOLDERS.map((p, i) => (
              <span key={p.key} title={p.means}>
                <code>{p.key}</code>
                {i < COMMAND_PLACEHOLDERS.length - 1 ? " " : ""}
              </span>
            ))}
          </small>
        </label>
        <section className="sub">
          <Toggle label="Embed" hint="A coloured card under the text." checked={c.useEmbed} onChange={(v) => set((d) => { d.useEmbed = v; })} />
          {c.useEmbed && (
            <div className="sub-body cc-embed">
              <div className="mod-row">
                <label className="field cc-color">
                  <span>Colour</span>
                  <input type="color" value={e.color} onChange={(ev) => set((d) => { d.embed.color = ev.target.value; })} />
                </label>
                <label className="field">
                  <span>Title</span>
                  <input value={e.title} maxLength={256} onChange={(ev) => set((d) => { d.embed.title = ev.target.value; })} />
                </label>
              </div>
              <label className="field">
                <span>Description</span>
                <textarea rows={5} maxLength={4000} value={e.description} onChange={(ev) => set((d) => { d.embed.description = ev.target.value; })} />
              </label>
              <div className="mod-row">
                <label className="field">
                  <span>Image link (optional)</span>
                  <input value={e.image} maxLength={1000} placeholder="https://…" onChange={(ev) => set((d) => { d.embed.image = ev.target.value; })} />
                </label>
                <label className="field">
                  <span>Footer (optional)</span>
                  <input value={e.footer} maxLength={2048} onChange={(ev) => set((d) => { d.embed.footer = ev.target.value; })} />
                </label>
              </div>
            </div>
          )}
        </section>
        <div className="field">
          <span>Who can use it (empty = everyone)</span>
          <RolePicker guild={guild} anyRole value={c.allowedRoleIds} max={MAX_ALLOWED_ROLES} onChange={(v) => set((d) => { d.allowedRoleIds = v; })} />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="cc-buttons">
          <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
            {saving ? "Saving…" : id ? "Save changes" : "Create command"}
          </button>
        </div>
        {problem && <small className="muted">{problem}</small>}
      </div>

      <div className="cc-preview-wrap">
        <div className="muted small">Preview</div>
        <div className="cc-preview">
          <div className="cc-preview-used">
            <span className="cc-preview-dot" /> You used <strong>/{name || "command"}</strong>
          </div>
          <div className="cc-preview-author">
            <span className="cc-preview-avatar">1</span>
            <strong>Number One</strong>
            <span className="cc-preview-bot">APP</span>
          </div>
          {c.content.trim() && <div className="cc-preview-content">{c.content}</div>}
          {c.useEmbed && (
            <div className="cc-preview-embed" style={{ borderLeftColor: e.color }}>
              {e.title && <div className="cc-preview-title">{e.title}</div>}
              {e.description.trim() && <div className="cc-preview-desc">{e.description}</div>}
              {e.image && <img className="cc-preview-image" src={e.image} alt="" />}
              {e.footer && <div className="cc-preview-footer">{e.footer}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Rules: /rule <number> */

function RulesEditor({ guild, initial, onSaved }: { guild: Guild; initial: RulesSettings; onSaved: (r: CustomCommandsResponse) => void }) {
  const [saved, setSaved] = useState<RulesSettings>(structuredClone(initial));
  const [r, setR] = useState<RulesSettings>(structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewNumber, setPreviewNumber] = useState(1);
  const set = (fn: (d: RulesSettings) => void) =>
    setR((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const dirty = JSON.stringify(r) !== JSON.stringify(saved);
  const problem =
    (r.rules.some((x) => !x.title.trim()) ? "Every rule needs a title." : null) ??
    (r.enabled && !r.rules.length ? "Add at least one rule, or switch /rule off." : null);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await api.saveRules(guild.id, r);
      setSaved(structuredClone(res.rules));
      setR(structuredClone(res.rules));
      onSaved(res);
      setNotice(r.enabled ? "Saved. /rule is ready in Discord (it can take a moment to show up)." : "Saved. /rule is switched off.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const move = (i: number, by: number) =>
    set((d) => {
      const [x] = d.rules.splice(i, 1);
      d.rules.splice(i + by, 0, x);
    });

  const shown = Math.min(Math.max(1, previewNumber), Math.max(1, r.rules.length));
  const rule = r.rules[shown - 1];

  return (
    <div className="cc-editor">
      <div className="cc-form">
        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
          </div>
        )}
        <section className="sub">
          <Toggle
            label="📜 /rule command"
            hint="Anyone can type /rule 1 to post that rule in the channel for everyone to see, or /rule on its own to post them all."
            checked={r.enabled}
            onChange={(v) => set((d) => { d.enabled = v; })}
          />
          <div className="sub-body cc-embed">
            <div className="mod-row">
              <label className="field">
                <span>Heading</span>
                <input value={r.heading} maxLength={100} onChange={(e) => set((d) => { d.heading = e.target.value; })} />
              </label>
              <label className="field cc-color">
                <span>Colour</span>
                <input type="color" value={r.color} onChange={(e) => set((d) => { d.color = e.target.value; })} />
              </label>
            </div>
          </div>
        </section>

        <section className="sub">
          <div className="sub-head">
            <strong>Rules</strong>
            <small className="muted">Numbered in this order. {r.rules.length}/{MAX_RULES}</small>
          </div>
          <div className="sub-body cc-rules">
            {r.rules.map((x, i) => (
              <div key={i} className="cc-rule">
                <span className="cc-rule-number">{i + 1}</span>
                <div className="cc-rule-fields">
                  <input value={x.title} maxLength={100} placeholder="Be kind" onChange={(e) => set((d) => { d.rules[i].title = e.target.value; })} />
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={x.description}
                    placeholder="What this rule means (optional)"
                    onChange={(e) => set((d) => { d.rules[i].description = e.target.value; })}
                  />
                </div>
                <div className="cc-rule-tools">
                  <button className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                  <button className="btn ghost small" disabled={i === r.rules.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
                  <button className="btn danger small" onClick={() => set((d) => { d.rules.splice(i, 1); })}>Remove</button>
                </div>
              </div>
            ))}
            <button
              className="btn ghost small"
              disabled={r.rules.length >= MAX_RULES}
              onClick={() => set((d) => { d.rules.push({ title: "", description: "" }); })}
            >
              + Add rule
            </button>
          </div>
        </section>

        {error && <p className="error">{error}</p>}
        {dirty && (
          <div className="save-bar">
            <span>You have unsaved changes.</span>
            <button className="btn ghost small" disabled={saving} onClick={() => { setR(structuredClone(saved)); setError(""); }}>Discard</button>
            <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
        {problem && dirty && <small className="muted">{problem}</small>}
      </div>

      <div className="cc-preview-wrap">
        <div className="muted small cc-preview-pick">
          Preview of <code>/rule</code>
          <input type="number" min={1} max={Math.max(1, r.rules.length)} value={shown} onChange={(e) => setPreviewNumber(e.target.valueAsNumber || 1)} />
        </div>
        <div className="cc-preview">
          <div className="cc-preview-used">
            <span className="cc-preview-dot" /> Someone used <strong>/rule {shown}</strong>
          </div>
          <div className="cc-preview-author">
            <span className="cc-preview-avatar">1</span>
            <strong>Number One</strong>
            <span className="cc-preview-bot">APP</span>
          </div>
          <div className="cc-preview-embed" style={{ borderLeftColor: r.color }}>
            <div className="cc-preview-title">📜 Rule {shown}: {rule?.title || "Be kind"}</div>
            {rule?.description.trim() && <div className="cc-preview-desc">{rule.description}</div>}
            <div className="cc-preview-footer">{r.heading} · {shown} of {Math.max(1, r.rules.length)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
