import { useEffect, useState } from "react";
import {
  type GuideInput,
  type GuidePage,
  type GuideView,
  type GuidesResponse,
  MAX_GUIDES,
  MAX_GUIDE_PAGES,
  MAX_GUIDE_ROLES,
  MAX_PAGE_LINKS,
  guideTemplates,
} from "../../../src/shared/guides";
import { type GuildDetails, api } from "../api";
import { EmojiInput, EmojiView } from "../components/emoji";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const newId = () => Math.random().toString(36).slice(2, 10);

const blankPage = (n: number): GuidePage => ({
  id: newId(),
  title: `Page ${n}`,
  emoji: "",
  content: "",
  image: "",
  links: [],
  linkUrl: "",
  linkLabel: "",
});

const blankGuide = (): GuideInput => ({
  channelId: "",
  name: "My guide",
  audience: "everyone",
  roleIds: [],
  title: "📖 Guide",
  intro: "",
  color: "#ff4fa3",
  image: "",
  showContents: true,
  pages: [{ ...blankPage(1), title: "Welcome", content: "Write your first page here." }],
});

/** A template, with fresh page IDs (links are remapped) so two guides from one template never share them. */
function fromTemplate(id: string): GuideInput {
  const t = guideTemplates.find((x) => x.id === id);
  if (!t) return blankGuide();
  const ids = new Map(t.guide.pages.map((p) => [p.id, newId()]));
  return {
    ...structuredClone(t.guide),
    channelId: "",
    roleIds: [],
    pages: t.guide.pages.map((p) => ({ ...p, id: ids.get(p.id)!, links: p.links.map((l) => ids.get(l)!).filter(Boolean) })),
  };
}

/** Dashboard section for Server guides: the guides list and the editor. */
export function GuidesPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<GuidesResponse | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; draft: GuideInput } | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.guides(guild.id).then(setData).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data) return <p className="muted panel">Loading guides…</p>;

  if (editing) {
    return (
      <GuideEditor
        guild={guild}
        id={editing.id}
        initial={editing.draft}
        onCancel={() => setEditing(null)}
        onSaved={(r) => {
          setData(r);
          setEditing(null);
          setNotice("Saved. The guide is up to date in Discord.");
        }}
      />
    );
  }

  const remove = async (g: GuideView) => {
    if (!confirm(`Delete "${g.name}"? Its cover is removed from Discord.`)) return;
    try {
      setData(await api.deleteGuide(guild.id, g.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted channel";

  return (
    <div className="panel guides">
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
          A guide is a little book of pages. Number One posts a cover with the contents; readers open pages just for themselves and move with
          Back, Next and buttons to related pages. {data.guides.length}/{MAX_GUIDES} used.
        </p>
        <button className="btn primary small" disabled={data.guides.length >= MAX_GUIDES} onClick={() => setPicking((v) => !v)}>
          New guide
        </button>
      </div>

      {picking && (
        <div className="gd-templates">
          {guideTemplates.map((t) => (
            <button key={t.id} className="card gd-template" onClick={() => { setPicking(false); setEditing({ id: null, draft: fromTemplate(t.id) }); }}>
              <strong>{t.guide.title}</strong>
              <span className="muted small">{t.description}</span>
              <span className="small">{t.guide.pages.length} pages ready to edit</span>
            </button>
          ))}
          <button className="card gd-template" onClick={() => { setPicking(false); setEditing({ id: null, draft: blankGuide() }); }}>
            <strong>📝 Blank guide</strong>
            <span className="muted small">Start from one empty page.</span>
          </button>
        </div>
      )}

      {data.guides.length === 0 ? (
        !picking && <div className="card"><p className="muted">No guides yet. Start from the Server guide or Staff guide template.</p></div>
      ) : (
        <ul className="cc-list">
          {data.guides.map((g) => (
            <li key={g.id} className="card cc-item">
              <div className="cc-item-text">
                <strong>{g.audience === "staff" ? "🔒 " : ""}{g.name}</strong>
                <span className="muted small">
                  #{channelName(g.channelId)} · {g.pages.length} page{g.pages.length === 1 ? "" : "s"} · {g.views.toLocaleString()} page view{g.views === 1 ? "" : "s"}
                  {" · "}
                  {g.messageUrl ? <a href={g.messageUrl} target="_blank" rel="noreferrer">Open in Discord</a> : "not posted"}
                </span>
              </div>
              <div className="cc-actions">
                <button className="btn ghost small" onClick={() => setEditing({ id: g.id, draft: structuredClone(g) })}>Edit</button>
                <button className="btn danger small" onClick={() => remove(g)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GuideEditor({
  guild,
  id,
  initial,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  id: number | null;
  initial: GuideInput;
  onCancel: () => void;
  onSaved: (r: GuidesResponse) => void;
}) {
  const [g, setG] = useState<GuideInput>(() => {
    // Strip any extra fields (id, views, messageUrl) that came with an existing guide.
    const { channelId, name, audience, roleIds, title, intro, color, image, showContents, pages } = structuredClone(initial);
    return { channelId, name, audience, roleIds, title, intro, color, image, showContents, pages };
  });
  const [current, setCurrent] = useState(0);
  const [preview, setPreview] = useState<"cover" | "page">("cover");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (fn: (d: GuideInput) => void) =>
    setG((d) => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const index = Math.min(current, g.pages.length - 1);
  const page = g.pages[index];
  const setPage = (fn: (p: GuidePage) => void) => set((d) => fn(d.pages[index]));

  const move = (by: number) => {
    set((d) => {
      const [p] = d.pages.splice(index, 1);
      d.pages.splice(index + by, 0, p);
    });
    setCurrent(index + by);
  };
  const removePage = () => {
    if (!confirm(`Remove the page "${page.title}"?`)) return;
    set((d) => {
      const [gone] = d.pages.splice(index, 1);
      for (const p of d.pages) p.links = p.links.filter((l) => l !== gone.id);
    });
    setCurrent(Math.max(0, index - 1));
  };

  const problem =
    (!g.channelId ? "Pick a channel for the guide." : null) ??
    (!g.name.trim() ? "Give the guide a name." : null) ??
    (g.audience === "staff" && !g.roleIds.length ? "Pick the staff roles that can read this guide." : null) ??
    (g.pages.find((p) => !p.title.trim()) ? "Every page needs a title." : null) ??
    (() => {
      const empty = g.pages.find((p) => !p.content.trim() && !p.image);
      return empty ? `"${empty.title}" is empty. Write something or add an image.` : null;
    })() ??
    (() => {
      const bad = g.pages.find((p) => p.linkUrl && (!p.linkLabel.trim() || !/^https:\/\/\S+$/i.test(p.linkUrl)));
      return bad ? `"${bad.title}": web links need a label and must start with https://` : null;
    })();

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(id ? await api.updateGuide(guild.id, id, g) : await api.createGuide(guild.id, g));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const others = g.pages.filter((p) => p.id !== page.id);

  return (
    <div className="panel guides">
      <div className="rv-editor">
        <div className="rv-form">
          <section className="sub">
            <div className="sub-head"><strong>📖 The guide</strong></div>
            <div className="sub-body rv-fields">
              <div className="mod-row">
                <label className="field">
                  <span>Name</span>
                  <input value={g.name} maxLength={60} onChange={(e) => set((d) => { d.name = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Post the cover in</span>
                  <ChannelSelect guild={guild} value={g.channelId || null} emptyLabel="Choose a channel…" onChange={(v) => set((d) => { d.channelId = v ?? ""; })} />
                </label>
              </div>
              <label className="field">
                <span>Who can read it</span>
                <select value={g.audience} onChange={(e) => set((d) => { d.audience = e.target.value as GuideInput["audience"]; })}>
                  <option value="everyone">Everyone</option>
                  <option value="staff">Staff only (roles below)</option>
                </select>
              </label>
              {g.audience === "staff" && (
                <label className="field">
                  <span>Staff roles</span>
                  <RolePicker guild={guild} value={g.roleIds} max={MAX_GUIDE_ROLES} anyRole placeholder="Add a role…" onChange={(v) => set((d) => { d.roleIds = v; })} />
                  <small className="muted">People with Manage Server can always read it. Post the cover in a staff channel too.</small>
                </label>
              )}
            </div>
          </section>

          <section className="sub">
            <div className="sub-head"><strong>🪧 The cover</strong></div>
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
                <span>Intro</span>
                <textarea rows={3} maxLength={3000} value={g.intro} onChange={(e) => set((d) => { d.intro = e.target.value; })} />
              </label>
              <label className="field">
                <span>Image link (optional)</span>
                <input value={g.image} maxLength={1000} placeholder="https://…" onChange={(e) => set((d) => { d.image = e.target.value; })} />
              </label>
              <Toggle label="List the pages on the cover" checked={g.showContents} onChange={(v) => set((d) => { d.showContents = v; })} />
            </div>
          </section>

          <section className="sub">
            <div className="sub-head gd-pages-head">
              <strong>📄 Pages</strong>
              <button
                className="btn ghost small"
                disabled={g.pages.length >= MAX_GUIDE_PAGES}
                onClick={() => {
                  set((d) => { d.pages.push(blankPage(d.pages.length + 1)); });
                  setCurrent(g.pages.length);
                  setPreview("page");
                }}
              >
                + Add page ({g.pages.length}/{MAX_GUIDE_PAGES})
              </button>
            </div>
            <div className="sub-body rv-fields">
              <div className="gd-page-tabs">
                {g.pages.map((p, i) => (
                  <button key={p.id} className={`cc-tab ${i === index ? "on" : ""}`} onClick={() => { setCurrent(i); setPreview("page"); }}>
                    {i + 1}. {p.emoji && <EmojiView display={p.emoji} />} {p.title || "Untitled"}
                  </button>
                ))}
              </div>

              <div className="mod-row">
                <label className="field">
                  <span>Page title</span>
                  <input value={page.title} maxLength={100} onChange={(e) => setPage((p) => { p.title = e.target.value; })} />
                </label>
                <label className="field">
                  <span>Emoji</span>
                  <EmojiInput guild={guild} value={page.emoji} onChange={(v) => setPage((p) => { p.emoji = v; })} />
                  {page.emoji && <button className="link small" onClick={() => setPage((p) => { p.emoji = ""; })}>No emoji</button>}
                </label>
              </div>
              <label className="field">
                <span>Text <small className="muted">({page.content.length}/4000)</small></span>
                <textarea rows={8} maxLength={4000} value={page.content} onChange={(e) => setPage((p) => { p.content = e.target.value; })} />
                <small className="muted">Discord formatting works: **bold**, lists, links, and #channel or @role mentions.</small>
              </label>
              <label className="field">
                <span>Image link (optional)</span>
                <input value={page.image} maxLength={1000} placeholder="https://…" onChange={(e) => setPage((p) => { p.image = e.target.value; })} />
              </label>

              {others.length > 0 && (
                <div className="field">
                  <span>Link to related pages <small className="muted">(up to {MAX_PAGE_LINKS}, shown as buttons)</small></span>
                  <div className="gd-links">
                    {others.map((o) => {
                      const on = page.links.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          className={`chip gd-link ${on ? "on" : ""}`}
                          disabled={!on && page.links.length >= MAX_PAGE_LINKS}
                          onClick={() => setPage((p) => { p.links = on ? p.links.filter((l) => l !== o.id) : [...p.links, o.id]; })}
                        >
                          {on ? "✓ " : "+ "}{o.title || "Untitled"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mod-row">
                <label className="field">
                  <span>Web link button (optional)</span>
                  <input value={page.linkLabel} maxLength={80} placeholder="Button label" onChange={(e) => setPage((p) => { p.linkLabel = e.target.value; })} />
                </label>
                <label className="field">
                  <span>&nbsp;</span>
                  <input value={page.linkUrl} maxLength={1000} placeholder="https://…" onChange={(e) => setPage((p) => { p.linkUrl = e.target.value; })} />
                </label>
              </div>

              <div className="cc-actions">
                <button className="btn ghost small" disabled={index === 0} onClick={() => move(-1)}>↑ Move earlier</button>
                <button className="btn ghost small" disabled={index === g.pages.length - 1} onClick={() => move(1)}>↓ Move later</button>
                <button className="btn danger small" disabled={g.pages.length === 1} onClick={removePage}>Remove page</button>
              </div>
            </div>
          </section>
        </div>

        <div className="rv-preview-wrap">
          <div className="cc-tabs">
            <button className={`cc-tab ${preview === "cover" ? "on" : ""}`} onClick={() => setPreview("cover")}>Cover</button>
            <button className={`cc-tab ${preview === "page" ? "on" : ""}`} onClick={() => setPreview("page")}>Page {index + 1}</button>
          </div>
          <div className="rv-preview">
            <div className="rv-preview-author">
              <span className="rv-preview-avatar">1</span>
              <strong>Number One</strong>
              <span className="rv-preview-bot">APP</span>
              {preview === "page" && <span className="muted small">· only you can see this</span>}
            </div>
            {preview === "cover" ? (
              <>
                <div className="rv-preview-embed" style={{ borderLeftColor: g.color }}>
                  {g.title && <div className="rv-preview-title">{g.title}</div>}
                  <div className="rv-preview-desc">
                    {g.intro.trim()}
                    {g.showContents && (
                      <>
                        {g.intro.trim() ? "\n\n" : ""}
                        <strong>Contents</strong>
                        {g.pages.map((p, i) => <span key={p.id}>{"\n"}<strong>{i + 1}.</strong> {p.emoji && <EmojiView display={p.emoji} />} {p.title}</span>)}
                      </>
                    )}
                  </div>
                  {g.image && <img className="rv-preview-image" src={g.image} alt="" />}
                  <div className="gd-preview-footer">{g.audience === "staff" ? "🔒 Staff only · " : ""}Pages open just for you</div>
                </div>
                <span className="rv-preview-button" style={{ background: "#5865f2" }}>📖 Start reading</span>
                <div className="tk-preview-menu"><span>📑 Jump to a page…</span><span>▾</span></div>
              </>
            ) : (
              <>
                <div className="rv-preview-embed" style={{ borderLeftColor: g.color }}>
                  <div className="rv-preview-title">{page.emoji && !page.emoji.startsWith("<") ? `${page.emoji} ` : ""}{page.title}</div>
                  <div className="rv-preview-desc">{page.content}</div>
                  {page.image && <img className="rv-preview-image" src={page.image} alt="" />}
                  <div className="gd-preview-footer">{g.name} · Page {index + 1} of {g.pages.length}</div>
                </div>
                <div className="tk-preview-buttons">
                  <span className={`rv-preview-button gd-btn ${index === 0 ? "off" : ""}`} style={{ background: "#4e5058" }}>◀️ Back</span>
                  <span className="rv-preview-button gd-btn" style={{ background: "#4e5058" }}>📑 Contents</span>
                  <span className={`rv-preview-button gd-btn ${index === g.pages.length - 1 ? "off" : ""}`} style={{ background: "#5865f2" }}>Next ▶️</span>
                </div>
                <div className="tk-preview-menu"><span>{index + 1}. {page.title}</span><span>▾</span></div>
                {(page.links.length > 0 || (page.linkUrl && page.linkLabel)) && (
                  <div className="tk-preview-buttons">
                    {page.links.map((l) => {
                      const target = g.pages.find((p) => p.id === l);
                      return target ? (
                        <button key={l} className="rv-preview-button gd-btn" style={{ background: "#4e5058", border: 0 }} onClick={() => setCurrent(g.pages.indexOf(target))}>
                          → {target.title}
                        </button>
                      ) : null;
                    })}
                    {page.linkUrl && page.linkLabel && <span className="rv-preview-button gd-btn" style={{ background: "#4e5058" }}>{page.linkLabel} ↗</span>}
                  </div>
                )}
              </>
            )}
          </div>
          <small className="muted">Readers see pages privately, so many people can read at once.</small>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{id ? "Saving updates the cover in Discord." : "Saving posts the cover (when Server guides is on)."}</span>
        <button className="btn ghost small" disabled={saving} onClick={onCancel}>Cancel</button>
        <button className="btn primary small" disabled={saving || Boolean(problem)} title={problem ?? undefined} onClick={save}>
          {saving ? "Saving…" : id ? "Save changes" : "Save and post"}
        </button>
      </div>
      {problem && <small className="muted">{problem}</small>}
    </div>
  );
}
