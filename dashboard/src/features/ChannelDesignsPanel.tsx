import { useEffect, useState } from "react";
import {
  type ChannelDesignSettings,
  type ChannelDesignsResponse,
  type CleanupSettings,
  type DesignChannel,
  MAX_SKIPPED,
  decorate,
  designTemplates,
  includes,
  plainName,
} from "../../../src/shared/channelDesigns";
import { type GuildDetails, api } from "../api";
import { ChannelPicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const icon = (type: number) => (type === 5 ? "📢 " : type === 2 || type === 13 ? "🔊 " : "# ");

/** Dashboard section for Channel designs: pick a design, see every channel's new name, apply or remove. */
export function ChannelDesignsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<ChannelDesignsResponse | null>(null);
  const [draft, setDraft] = useState<ChannelDesignSettings | null>(null);
  const [clean, setClean] = useState<CleanupSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = (r: ChannelDesignsResponse, keepDraft = false) => {
    setData(r);
    if (!keepDraft) {
      setDraft(structuredClone(r.settings));
      setClean(structuredClone(r.settings.cleanup));
    }
  };

  useEffect(() => {
    api.channelDesigns(guild.id).then((r) => load(r)).catch((err) => setError(err.message));
  }, [guild.id]);

  // While channels are being renamed, keep the progress up to date.
  const running = data?.job?.phase === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api.channelDesigns(guild.id).then((r) => load(r, true)).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [guild.id, running]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft || !clean) return <p className="muted panel">Loading channel designs…</p>;

  const set = (fn: (d: ChannelDesignSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const isSkipped = (c: DesignChannel) => draft.skippedChannelIds.includes(c.id) || Boolean(c.parentId && draft.skippedChannelIds.includes(c.parentId));
  const inScope = data.channels.filter((c) => includes(draft, c.type) && !isSkipped(c));
  const template = designTemplates.find((t) => t.id === draft.templateId) ?? null;
  const applied = designTemplates.find((t) => t.id === data.settings.templateId) ?? null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const examples = (inScope.length ? inScope : data.channels).slice(0, 3).map((c) => c.baseName);
  const sample = examples.length ? examples : ["general", "announcements", "gaming"];
  const changes = data.channels.filter((c) => {
    const target = template && includes(draft, c.type) && !isSkipped(c) ? decorate(c.baseName, template) : c.baseName;
    return target !== null && target !== c.currentName;
  }).length;

  const apply = async (settings: ChannelDesignSettings) => {
    setBusy(true);
    setError("");
    try {
      load(await api.applyChannelDesign(guild.id, settings));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // "Make names text-only": what each chosen channel would be called with every emoji and decoration taken out.
  const cleanSkipped = (c: DesignChannel) => clean.skippedChannelIds.includes(c.id) || Boolean(c.parentId && clean.skippedChannelIds.includes(c.parentId));
  const cleanList = data.channels
    .filter((c) => includes(clean, c.type) && !cleanSkipped(c))
    .map((c) => ({ c, plain: plainName(c.currentName) }))
    .filter(({ c, plain }) => plain !== c.currentName);
  const cleanable = cleanList.filter((x) => x.plain).length;

  const runClean = async () => {
    if (!confirm(`Take every emoji and design out of ${cleanable} channel name${cleanable === 1 ? "" : "s"}? The current design is switched off too. This can't be undone, so check the list first.`)) return;
    setBusy(true);
    setError("");
    try {
      load(await api.cleanChannelNames(guild.id, clean));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const categoryName = (id: string | null) => (id ? guild.channels.find((c) => c.id === id)?.name ?? "" : "");
  const job = data.job;

  return (
    <div className="panel designs">
      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {job && (
        <div className={`notice ${job.phase === "failed" || job.skipped.length ? "warning-box" : ""}`}>
          <strong>
            {job.phase === "running"
              ? `${job.action === "remove" ? "Removing the design" : job.action === "clean" ? "Making names text-only" : "Adding the design"}… ${job.done}/${job.total} channels`
              : job.phase === "failed"
                ? job.error
                : `Done. ${job.total - job.skipped.length} of ${job.total} channels ${job.action === "remove" ? "are back to their own names" : job.action === "clean" ? "are text-only now. Pick a design above to style them." : "are up to date"}.`}
          </strong>
          {job.phase === "running" && (
            <span className="small muted">Discord lets each channel be renamed twice every 10 minutes, so switching designs quickly can take a few minutes. You can leave this page.</span>
          )}
          {job.skipped.map((s) => <span key={s.name} className="small">⚠️ #{s.name}: {s.reason}</span>)}
        </div>
      )}

      <p className="muted small">
        Pick a design and it's added around every channel's name. The names themselves stay the same, and nothing else about your channels
        changes. Switch designs or remove it anytime and the names go back exactly as they were.
        {applied ? ` On now: ${applied.name}.` : ""}
      </p>

      <div className="design-grid">
        <button className={`card design-card ${draft.templateId === null ? "on" : ""}`} onClick={() => set((d) => { d.templateId = null; })}>
          <strong>No design</strong>
          {sample.map((n) => <span key={n} className="design-sample">{icon(0)}{n}</span>)}
          {data.settings.templateId === null && <span className="design-badge">On now</span>}
        </button>
        {designTemplates.map((t) => (
          <button key={t.id} className={`card design-card ${draft.templateId === t.id ? "on" : ""}`} onClick={() => set((d) => { d.templateId = t.id; })}>
            <strong>{t.name}</strong>
            {sample.map((n) => <span key={n} className="design-sample">{icon(0)}{decorate(n, t) ?? n}</span>)}
            {data.settings.templateId === t.id && <span className="design-badge">On now</span>}
          </button>
        ))}
      </div>

      <section className="sub">
        <div className="sub-head"><strong>Which channels</strong><small className="muted">Text channels are always included.</small></div>
        <div className="sub-body design-options">
          <Toggle label="📢 Announcement channels" checked={draft.includeAnnouncements} onChange={(v) => set((d) => { d.includeAnnouncements = v; })} />
          <Toggle label="🔊 Voice and stage channels" checked={draft.includeVoice} onChange={(v) => set((d) => { d.includeVoice = v; })} />
          <Toggle
            label="Design new channels too"
            hint="Channels created later get the design straight away."
            checked={draft.decorateNew}
            onChange={(v) => set((d) => { d.decorateNew = v; })}
          />
          <div className="field">
            <span>Leave these alone (channels or whole categories)</span>
            <ChannelPicker guild={guild} value={draft.skippedChannelIds} max={MAX_SKIPPED} onChange={(v) => set((d) => { d.skippedChannelIds = v; })} />
          </div>
        </div>
      </section>

      <section className="sub">
        <div className="sub-head">
          <strong>Preview</strong>
          <small className="muted">{changes === 0 ? "No names change." : `${changes} channel name${changes === 1 ? "" : "s"} will change.`}</small>
        </div>
        <ul className="sub-body design-preview">
          {data.channels.map((c) => {
            const on = template && includes(draft, c.type) && !isSkipped(c);
            const target = on ? decorate(c.baseName, template) : c.baseName;
            const change = target !== null && target !== c.currentName;
            return (
              <li key={c.id} className={change ? "change" : "muted"}>
                <span className="design-cat small muted">{categoryName(c.parentId)}</span>
                <span>{icon(c.type)}{c.currentName}</span>
                {target === null ? <span className="small warning">too long for this design, left as is</span> : change ? <span>→ {icon(c.type)}{target}</span> : <span />}
              </li>
            );
          })}
        </ul>
      </section>

      {error && <p className="error">{error}</p>}
      <div className="design-buttons">
        {data.settings.templateId && (
          <button
            className="btn danger small"
            disabled={busy || running}
            onClick={() => {
              if (confirm("Remove the design? Every channel goes back to its own name.")) void apply({ ...draft, templateId: null });
            }}
          >
            Remove design
          </button>
        )}
        <button
          className="btn primary small"
          disabled={busy || running || (!dirty && changes === 0)}
          onClick={() => {
            const what = draft.templateId ? `add the ${template?.name} design to` : "remove the design from";
            if (changes === 0 || confirm(`This will ${what} ${changes} channel${changes === 1 ? "" : "s"}. Go ahead?`)) void apply(draft);
          }}
        >
          {busy ? "Starting…" : draft.templateId ? "Apply design" : "Save"}
        </button>
      </div>

      <section className="sub">
        <div className="sub-head">
          <strong>🧹 Make names text-only</strong>
          <small className="muted">
            Takes every emoji and decoration out of channel names, even ones added by hand or by another bot, so all your channels match before you pick
            a new design. Letters and numbers stay.
          </small>
        </div>
        <div className="sub-body design-options">
          <div className="sub-head"><strong>Which channels</strong><small className="muted">Text channels are always included.</small></div>
          <Toggle label="📢 Announcement channels" checked={clean.includeAnnouncements} onChange={(v) => setClean({ ...clean, includeAnnouncements: v })} />
          <Toggle label="🔊 Voice and stage channels" checked={clean.includeVoice} onChange={(v) => setClean({ ...clean, includeVoice: v })} />
          <div className="field">
            <span>Leave these alone (channels or whole categories)</span>
            <ChannelPicker guild={guild} value={clean.skippedChannelIds} max={MAX_SKIPPED} onChange={(v) => setClean({ ...clean, skippedChannelIds: v })} />
          </div>
        </div>
        <div className="sub-head">
          <strong>Preview</strong>
          <small className="muted">{cleanList.length === 0 ? "Every chosen channel is already text-only." : `${cleanable} channel name${cleanable === 1 ? "" : "s"} will change.`}</small>
        </div>
        {cleanList.length > 0 && (
          <ul className="sub-body design-preview">
            {cleanList.map(({ c, plain }) => (
              <li key={c.id} className={plain ? "change" : "muted"}>
                <span className="design-cat small muted">{categoryName(c.parentId)}</span>
                <span>{icon(c.type)}{c.currentName}</span>
                {plain ? <span>→ {icon(c.type)}{plain}</span> : <span className="small warning">only emojis, left as is</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="design-buttons">
          <button className="btn primary small" disabled={busy || running || cleanable === 0} onClick={runClean}>
            {busy ? "Starting…" : "Make names text-only"}
          </button>
        </div>
      </section>
    </div>
  );
}
