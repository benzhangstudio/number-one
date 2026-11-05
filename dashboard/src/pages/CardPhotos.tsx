import { useEffect, useMemo, useRef, useState } from "react";
import { CARD_PHOTO, type CardPhotosResponse, allVersions, photoKeyForFile } from "../../../src/shared/cards";
import { cardGroups, groupById } from "../../../src/shared/cardCatalog";
import { api } from "../api";

/** What a photo key means, in words: "BLACKPINK · Jennie" or "BLACKPINK · Jennie · Legend". */
function keyLabel(key: string) {
  const [g, m, v] = key.split(".");
  const group = groupById.get(g);
  const member = group?.members.find((x) => x.id === m);
  const version = v ? allVersions.find((x) => x.id === v) : null;
  return [group?.name ?? g, member?.name ?? m, version?.name].filter(Boolean).join(" · ");
}

const photoUrl = (key: string, at: number) => `/api/developer/cards/photos/${encodeURIComponent(key)}?v=${at}`;

/**
 * Developer page: card photos for the K-pop card game. Pick many photos (or a whole folder) at once;
 * each file is matched to its member or card by its name, then uploaded and cropped by the server.
 */
export function CardPhotos() {
  const [data, setData] = useState<CardPhotosResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [credit, setCredit] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [openGroup, setOpenGroup] = useState<string | null>("blackpink");
  const [error, setError] = useState("");
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.cardPhotos().then(setData).catch((err) => setError(err.message));
    // The folder picker isn't a standard attribute, so it's set here.
    pickFolder.current?.setAttribute("webkitdirectory", "");
  }, []);

  const matches = useMemo(() => {
    const images = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    const matched = images.map((f) => ({ file: f, key: photoKeyForFile(f.name) }));
    return {
      ok: matched.filter((m): m is { file: File; key: string } => Boolean(m.key)),
      unmatched: matched.filter((m) => !m.key).map((m) => m.file.name),
      tooBig: images.filter((f) => f.size > CARD_PHOTO.maxBytes).map((f) => f.name),
      skipped: files.length - images.length,
    };
  }, [files]);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading card photos…</p>;

  const upload = async () => {
    const list = matches.ok.filter((m) => m.file.size <= CARD_PHOTO.maxBytes);
    setProgress({ done: 0, total: list.length });
    setFailures([]);
    const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      try {
        setData(await api.uploadCardPhoto(list[i].key, list[i].file, credit.trim()));
      } catch (err) {
        failed.push(`${list[i].file.name}: ${(err as Error).message}`);
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setFailures(failed);
    setFiles([]);
    setProgress(null);
  };

  const remove = async (key: string) => {
    if (!confirm(`Remove the photo for ${keyLabel(key)}? Cards without a photo stop appearing in packs (members keep the ones they have).`)) return;
    try {
      setData(await api.deleteCardPhoto(key));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const editCredit = async (key: string) => {
    const next = prompt(`Photo credit for ${keyLabel(key)}:`, data.photos[key]?.credit ?? "");
    if (next === null) return;
    try {
      setData(await api.setCardPhotoCredit(key, next));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const groupDone = (gId: string) => groupById.get(gId)!.members.filter((m) => data.photos[`${gId}.${m.id}`]).length;

  return (
    <div className="card kc-photos">
      <div className="dev-item-head">
        <h2>🃏 Card photos</h2>
        <span className="pill">{data.ready.toLocaleString("en-US")} of {data.total.toLocaleString("en-US")} cards ready</span>
      </div>
      <p className="muted small">
        Only cards with a photo appear in packs. Name each file after the group and member, like <code>blackpink-jennie.jpg</code> (used on all of
        Jennie's cards), or add a version for one card, like <code>blackpink-jennie-legend.jpg</code>. Spaces, dashes and underscores all work. Photos
        are cropped to a square, keeping the top part where faces usually are.
      </p>

      <div className="kc-upload">
        <label className="field">
          <span>Photo credit for this batch (optional)</span>
          <input value={credit} maxLength={CARD_PHOTO.credit} placeholder="e.g. Photo: Wikimedia Commons / CC BY-SA" onChange={(e) => setCredit(e.target.value)} />
        </label>
        <div className="dev-buttons">
          <button className="btn primary" disabled={Boolean(progress)} onClick={() => pickFolder.current?.click()}>Choose a folder</button>
          <button className="btn ghost" disabled={Boolean(progress)} onClick={() => pickFiles.current?.click()}>Choose photos</button>
        </div>
        <input ref={pickFolder} type="file" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        <input ref={pickFiles} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </div>

      {files.length > 0 && !progress && (
        <div className="kc-batch">
          <strong>{matches.ok.length} photo{matches.ok.length === 1 ? "" : "s"} matched</strong>
          <ul className="kc-matches">
            {matches.ok.map((m) => (
              <li key={m.file.name} className={m.file.size > CARD_PHOTO.maxBytes ? "error" : undefined}>
                <span className="muted small">{m.file.name}</span> → {keyLabel(m.key)}
                {data.photos[m.key] && <span className="muted small"> (replaces the current one)</span>}
                {m.file.size > CARD_PHOTO.maxBytes && <span className="small"> · too big (8 MB max)</span>}
              </li>
            ))}
          </ul>
          {matches.unmatched.length > 0 && (
            <p className="small warning">
              ⚠️ Not matched, so they'll be skipped: {matches.unmatched.slice(0, 12).join(", ")}
              {matches.unmatched.length > 12 ? ` and ${matches.unmatched.length - 12} more` : ""}. Rename them like <code>group-member.jpg</code>.
            </p>
          )}
          {matches.skipped > 0 && <p className="muted small">{matches.skipped} file{matches.skipped === 1 ? " isn't a picture" : "s aren't pictures"} and will be skipped.</p>}
          <div className="dev-buttons">
            <button className="btn primary" disabled={!matches.ok.length} onClick={upload}>Upload {matches.ok.length} photo{matches.ok.length === 1 ? "" : "s"}</button>
            <button className="btn ghost" onClick={() => setFiles([])}>Cancel</button>
          </div>
        </div>
      )}
      {progress && (
        <div className="kc-batch">
          <strong>Uploading… {progress.done}/{progress.total}</strong>
          <div className="poll-bar"><span style={{ width: `${(progress.done / progress.total) * 100}%`, background: "var(--accent)" }} /></div>
        </div>
      )}
      {failures.length > 0 && (
        <div className="notice warning-box">
          <strong>Some photos didn't upload</strong>
          {failures.map((f) => <span key={f} className="small">⚠️ {f}</span>)}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="kc-groups">
        {cardGroups.map((g) => {
          const done = groupDone(g.id);
          const open = openGroup === g.id;
          const versionPhotos = Object.keys(data.photos).filter((k) => k.startsWith(`${g.id}.`) && k.split(".").length === 3);
          return (
            <div key={g.id} className="kc-group">
              <button className="kc-group-head" onClick={() => setOpenGroup(open ? null : g.id)}>
                <span className="kc-dot" style={{ background: g.color }} />
                <strong>{g.name}</strong>
                <span className={`small ${done === g.members.length ? "kc-done" : "muted"}`}>{done}/{g.members.length}</span>
              </button>
              {open && (
                <div className="kc-members">
                  {g.members.map((m) => {
                    const key = `${g.id}.${m.id}`;
                    const p = data.photos[key];
                    return (
                      <div key={key} className="kc-member">
                        {p ? <img src={photoUrl(key, p.updatedAt)} alt="" /> : <div className="kc-empty small muted">No photo</div>}
                        <strong className="small">{m.name}</strong>
                        <code className="small muted">{g.id}-{m.id}</code>
                        {p && (
                          <span className="kc-member-actions">
                            <a className="link small" href={`/api/developer/cards/preview/${g.id}.${m.id}.legend`} target="_blank" rel="noreferrer">Preview</a>
                            <button className="link small" onClick={() => editCredit(key)}>Credit</button>
                            <button className="link small danger" onClick={() => remove(key)}>Remove</button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {versionPhotos.length > 0 && (
                    <div className="kc-versions small">
                      <span className="muted">Version photos:</span>
                      {versionPhotos.map((k) => (
                        <span key={k} className="fr-tag">
                          {keyLabel(k).split(" · ").slice(1).join(" · ")}
                          <button className="link small" onClick={() => remove(k)} aria-label="Remove">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
