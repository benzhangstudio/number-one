import { useEffect, useState } from "react";
import {
  GUIDE_NAMES,
  type GuideKind,
  type GuideSection,
  type GuideSettings,
  type GuidesResponse,
  MAX_GUIDE_SECTIONS,
  guideDefaults,
  guideKinds,
} from "../../../src/shared/guides";
import { type GuildDetails, api } from "../api";
import { EmojiInput, EmojiView } from "../components/emoji";
import { ChannelSelect, Toggle } from "../components/pickers";
import { DiscordText } from "../components/DiscordText";

type Guild = GuildDetails["guild"];

const newId = () => Math.random().toString(36).slice(2, 10);

const ABOUT: Record<GuideKind, { icon: string; who: string }> = {
  server: { icon: "👥", who: "For members: welcome, rules, roles, channels and where to get help. Post it somewhere everyone can read." },
  staff: { icon: "🛡️", who: "For your team: how to moderate, handle tickets and when to escalate. Post it in a staff-only channel." },
};

/** Dashboard section for Guides: the Server guide and the Staff guide, each posted in its own channel. */
export function GuidesPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<GuidesResponse | null>(null);
  const [kind, setKind] = useState<GuideKind>("server");
  const [error, setError] = useState("");

  useEffect(() => {
    api.guides(guild.id).then(setData).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading guides…</p>;

  return (
    <div className="panel guides">
      <div className="cc-tabs">
        {guideKinds.map((k) => (
          <button key={k} className={`cc-tab ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
            {ABOUT[k].icon} {GUIDE_NAMES[k]} {data.posted[k] ? "· posted" : ""}
          </button>
        ))}
      </div>
      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {/* Keyed by kind so switching tabs starts from that guide's saved text. */}
      <GuideEditor key={kind} guild={guild} kind={kind} data={data} onSaved={setData} />
    </div>
  );
}

function GuideEditor({ guild, kind, data, onSaved }: { guild: Guild; kind: GuideKind; data: GuidesResponse; onSaved: (r: GuidesResponse) => void }) {
  const saved = data.settings[kind];
  const [g, setG] = useState<GuideSettings>(structuredClone(saved));
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => setG(structuredClone(saved)), [saved]);

  const set = (fn: (d: GuideSettings) => void) =>
    setG((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const index = Math.min(current, g.sections.length - 1);
  const section = g.sections[index];
  const setSection = (fn: (s: GuideSection) => void) => set((d) => fn(d.sections[index]));
  const move = (by: number) => {
    set((d) => {
      const [s] = d.sections.splice(index, 1);
      d.sections.splice(index + by, 0, s);
    });
    setCurrent(index + by);
  };

  const dirty = JSON.stringify(g) !== JSON.stringify(saved);
  const posted = data.posted[kind];
  const problem =
    (g.enabled && !g.channelId ? "Pick a channel for the guide." : null) ??
    (g.sections.find((s) => !s.title.trim()) ? "Every section needs a title." : null) ??
    (() => {
      const empty = g.sections.find((s) => !s.content.trim() && !s.image);
      return empty ? `"${empty.title}" is empty. Write something or add an image.` : null;
    })();

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.saveGuide(guild.id, kind, g);
      onSaved(r);
      setNotice(r.posted[kind] ? `Saved. The ${GUIDE_NAMES[kind]} is up to date in Discord.` : "Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetText = () => {
    if (!confirm(`Replace this guide's text with the ready-made ${GUIDE_NAMES[kind]}? Your channel and switches stay the same.`)) return;
    const d = guideDefaults[kind];
    set((x) => {
      x.title = d.title;
      x.intro = d.intro;
      x.color = d.color;
      x.image = "";
      x.sections = structuredClone(d.sections).map((s) => ({ ...s, id: newId() }));
    });
    setCurrent(0);
  };

  const sectionTitle = (s: GuideSection, i: number) => `${i + 1}. ${s.emoji && !s.emoji.startsWith("<") ? `${s.emoji} ` : ""}${s.title}`;

  return (
    <>
      <p className="muted small">{ABOUT[kind].who}</p>
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          {posted && <a className="small" href={posted} target="_blank" rel="noreferrer">Open in Discord</a>}
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      <div className="rv-editor">
        <div className="rv-form">
          <section className="sub">
            <div className="sub-head"><strong>📍 Where it's posted</strong></div>
            <div className="sub-body rv-fields">
              <Toggle
                label={`Post the ${GUIDE_NAMES[kind]}`}
                hint="Switch off to take it down. The text stays saved."
                checked={g.enabled}
                onChange={(v) => set((d) => { d.enabled = v; })}
              />
              <label className="field">
                <span>Channel</span>
                <ChannelSelect guild={guild} value={g.channelId} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.channelId = v; })} />
                <small className="muted">
                  Best in its own channel where only Number One can post, so it stays tidy.
                  {kind === "staff" ? " Make sure only staff can see it." : ""}
                </small>
              </label>
            </div>
          </section>

          <section className="sub">
            <div className="sub-head gd-pages-head">
              <strong>📑 Contents message</strong>
              <button className="link small" onClick={resetText}>Use the ready-made text</button>
            </div>
            <div className="sub-body rv-fields">
              <div className="mod-row">
                <label className="field">
                  <span>Title</span>
                  <input value={g.title} maxLength={256} onChange={(e) => set((d) => { d.title = e.target.value; })} />
                </label>
                <label className="field rv-color">
                  <span>Colour</span>
                  <input type="color" value={g.color} onChange={(e) => set((d) => { d.color = e.target.value; })} />
                </label>
              </div>
              <label className="field">
                <span>Intro <small className="muted">({g.intro.length}/1500)</small></span>
                <textarea rows={3} maxLength={1500} value={g.intro} onChange={(e) => set((d) => { d.intro = e.target.value; })} />
              </label>
              <label className="field">
                <span>Image link (optional)</span>
                <input value={g.image} maxLength={1000} placeholder="https://…" onChange={(e) => set((d) => { d.image = e.target.value; })} />
              </label>
              <Toggle
                label="Contents and Next buttons under each section"
                hint="Readers can jump back to the contents or on to the next section."
                checked={g.navButtons}
                onChange={(v) => set((d) => { d.navButtons = v; })}
              />
            </div>
          </section>

          <section className="sub">
            <div className="sub-head gd-pages-head">
              <strong>📄 Sections</strong>
              <button
                className="btn ghost small"
                disabled={g.sections.length >= MAX_GUIDE_SECTIONS}
                onClick={() => {
                  set((d) => { d.sections.push({ id: newId(), title: `Section ${d.sections.length + 1}`, emoji: "", content: "", image: "" }); });
                  setCurrent(g.sections.length);
                }}
              >
                + Add section ({g.sections.length}/{MAX_GUIDE_SECTIONS})
              </button>
            </div>
            <div className="sub-body rv-fields">
              <div className="gd-page-tabs">
                {g.sections.map((s, i) => (
                  <button key={s.id} className={`cc-tab ${i === index ? "on" : ""}`} onClick={() => setCurrent(i)}>
                    {i + 1}. {s.emoji && <EmojiView display={s.emoji} />} {s.title || "Untitled"}
                  </button>
                ))}
              </div>
              <div className="mod-row">
                <label className="field">
                  <span>Section title</span>
                  <input value={section.title} maxLength={100} onChange={(e) => setSection((s) => { s.title = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Emoji</span>
                  <EmojiInput guild={guild} value={section.emoji} onChange={(v) => setSection((s) => { s.emoji = v; })} />
                  {section.emoji && <button className="link small" onClick={() => setSection((s) => { s.emoji = ""; })}>No emoji</button>}
                </label>
              </div>
              <label className="field">
                <span>Text <small className="muted">({section.content.length}/4000)</small></span>
                <textarea rows={8} maxLength={4000} value={section.content} onChange={(e) => setSection((s) => { s.content = e.target.value; })} />
                <small className="muted">Discord formatting works: **bold**, lists, links, and #channel or @role mentions.</small>
              </label>
              <label className="field">
                <span>Image link (optional)</span>
                <input value={section.image} maxLength={1000} placeholder="https://…" onChange={(e) => setSection((s) => { s.image = e.target.value; })} />
              </label>
              <div className="cc-actions">
                <button className="btn ghost small" disabled={index === 0} onClick={() => move(-1)}>↑ Move up</button>
                <button className="btn ghost small" disabled={index === g.sections.length - 1} onClick={() => move(1)}>↓ Move down</button>
                <button
                  className="btn danger small"
                  disabled={g.sections.length === 1}
                  onClick={() => {
                    if (!confirm(`Remove the section "${section.title}"?`)) return;
                    set((d) => { d.sections.splice(index, 1); });
                    setCurrent(Math.max(0, index - 1));
                  }}
                >
                  Remove section
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="rv-preview-wrap">
          <div className="muted small">How it reads in the channel</div>
          <div className="rv-preview gd-channel">
            <div className="rv-preview-author">
              <span className="rv-preview-avatar">1</span>
              <strong>Number One</strong>
              <span className="rv-preview-bot">APP</span>
            </div>
            <div className="rv-preview-embed" style={{ borderLeftColor: g.color }}>
              {g.title && <div className="rv-preview-title">{g.title}</div>}
              <div className="rv-preview-desc">
                {g.intro.trim() && <><DiscordText text={g.intro.trim()} guild={guild} />{"\n"}</>}
                <strong>Contents</strong>
                {g.sections.map((s, i) => (
                  <span key={s.id}>
                    {"\n"}
                    <button className="gd-toc-link" onClick={() => setCurrent(i)}>{sectionTitle(s, i)}</button>
                  </span>
                ))}
              </div>
              {g.image && <img className="rv-preview-image" src={g.image} alt="" />}
            </div>
            {g.sections.map((s, i) => (
              <div key={s.id} className={`gd-section ${i === index ? "on" : ""}`} onClick={() => setCurrent(i)}>
                <div className="rv-preview-embed" style={{ borderLeftColor: g.color }}>
                  <div className="rv-preview-title">{s.emoji && !s.emoji.startsWith("<") ? `${s.emoji} ` : ""}{s.title}</div>
                  <div className="rv-preview-desc">
                    {s.emoji.startsWith("<") && <><EmojiView display={s.emoji} />{" "}</>}
                    <DiscordText text={s.content} guild={guild} />
                  </div>
                  {s.image && <img className="rv-preview-image" src={s.image} alt="" />}
                  <div className="gd-preview-footer">{i + 1} of {g.sections.length}</div>
                </div>
                {g.navButtons && (
                  <div className="tk-preview-buttons">
                    <span className="rv-preview-button gd-btn" style={{ background: "#4e5058" }}>📑 Contents ↗</span>
                    {g.sections[i + 1] && <span className="rv-preview-button gd-btn" style={{ background: "#4e5058" }}>⬇️ Next: {g.sections[i + 1].title} ↗</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>
          {dirty
            ? "You have unsaved changes."
            : posted
              ? "Posted. No changes to save."
              : g.enabled
                ? "Not posted yet."
                : "Switched off: not posted."}
        </span>
        <button className="btn ghost small" disabled={saving || !dirty} onClick={() => { setG(structuredClone(saved)); setError(""); }}>Discard</button>
        <button className="btn primary small" disabled={saving || Boolean(problem) || (!dirty && (Boolean(posted) || !g.enabled))} title={problem ?? undefined} onClick={save}>
          {saving ? "Saving…" : g.enabled && !posted ? "Save and post" : "Save changes"}
        </button>
      </div>
      {problem && <small className="muted">{problem}</small>}
    </>
  );
}
