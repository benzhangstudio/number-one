import { useEffect, useMemo, useRef, useState } from "react";
import {
  CARD_PHOTO,
  type Card,
  type CardAdminResponse,
  type PileView,
  type Rarity,
  cardTypes,
  rarities,
  rarityInfo,
  typeInfo,
} from "../../../src/shared/cards";
import { pileFromFileName } from "../../../src/shared/cardCatalog";
import { api } from "../api";

type PileCard = Card & { owned: number };

const photoUrl = (id: string, at: number) =>
  `/api/developer/cards/card/${encodeURIComponent(id)}/photo?v=${at}`;
const previewUrl = (id: string, at: number) =>
  `/api/developer/cards/card/${encodeURIComponent(id)}/preview?v=${at}`;
const isPicture = (f: File) => /^image\/(jpeg|png|webp|gif)$/.test(f.type);
const stars = (r: Rarity) => "★".repeat(rarityInfo[r].stars);

function RaritySelect({
  value,
  onChange,
  className,
}: {
  value: Rarity;
  onChange: (r: Rarity) => void;
  className?: string;
}) {
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value as Rarity)}
    >
      {rarities.map((r) => (
        <option key={r} value={r}>
          {stars(r)} {rarityInfo[r].name}
        </option>
      ))}
    </select>
  );
}

/**
 * Developer page: the card manager for BLACKPINK Poker. Every photo added to a pile (a member, ship or the group)
 * becomes its own card with a name, rarity and type, and packs pull at random from every card that's in packs.
 */
export function CardManager() {
  const [data, setData] = useState<CardAdminResponse | null>(null);
  const [openPile, setOpenPile] = useState<string | null>(null);
  const [credit, setCredit] = useState("");
  const [rarity, setRarity] = useState<Rarity>("common");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState("");
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    api
      .cardAdmin()
      .then(setData)
      .catch((err) => setError(err.message));
    pickFolder.current?.setAttribute("webkitdirectory", "");
  }, []);

  const matches = useMemo(() => {
    const pictures = files.filter(isPicture);
    const matched = pictures.map((file) => ({
      file,
      match: pileFromFileName(file.name),
    }));
    return {
      ok: matched.filter(
        (m): m is { file: File; match: { pile: string; name: string } } =>
          Boolean(m.match),
      ),
      unmatched: matched.filter((m) => !m.match).map((m) => m.file.name),
      skipped: files.length - pictures.length,
    };
  }, [files]);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading cards…</p>;

  const pileName = (key: string) =>
    data.piles.find((p) => p.key === key)?.subject ?? key;

  const uploadBatch = async () => {
    const list = matches.ok.filter((m) => m.file.size <= CARD_PHOTO.maxBytes);
    const failed = matches.ok
      .filter((m) => m.file.size > CARD_PHOTO.maxBytes)
      .map((m) => `${m.file.name}: too big (8 MB max)`);
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      try {
        setData(
          await api.addCard(list[i].match.pile, list[i].file, {
            name: list[i].match.name,
            rarity,
            credit: credit.trim(),
          }),
        );
      } catch (err) {
        failed.push(`${list[i].file.name}: ${(err as Error).message}`);
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setFailures(failed);
    setFiles([]);
    setProgress(null);
    setRefresh((n) => n + 1);
  };

  const kinds = [
    ["member", "👤 Members"],
    ["ship", "💞 Ships"],
    ["group", "👯 Group"],
  ] as const;

  return (
    <div className="card kc-photos">
      <div className="dev-item-head">
        <h2>🃏 BLACKPINK Poker cards</h2>
        <span className="pill">
          {data.total} card{data.total === 1 ? "" : "s"} · {data.active} in
          packs
        </span>
      </div>
      <p className="muted small">
        Every photo you add becomes its own card, and a pile can have as many as
        you like. Packs pull at random from every card that's in packs, weighted
        by rarity: Common the most, Mythic the rarest.{" "}
        <strong>Click a pile</strong> to add, rename, re-rate or remove its
        cards.
      </p>

      <div className="kc-upload">
        <label className="field">
          <span>Photo credit for new cards (optional)</span>
          <input
            value={credit}
            maxLength={CARD_PHOTO.credit}
            placeholder="e.g. Photo: Wikimedia Commons / CC BY-SA"
            onChange={(e) => setCredit(e.target.value)}
          />
        </label>
        <label className="field kc-rarity-field">
          <span>New cards start as</span>
          <RaritySelect value={rarity} onChange={setRarity} />
        </label>
      </div>
      <details className="kc-bulk">
        <summary>Add lots at once (matched by file name)</summary>
        <p className="muted small">
          Name files after the pile, then the card's name:{" "}
          <code>jennie-pink-venom.jpg</code>, <code>chaelisa-airport.jpg</code>,{" "}
          <code>rose-lisa-concert.jpg</code> or{" "}
          <code>blackpink-coachella.jpg</code>. With no name after it (
          <code>jennie.jpg</code>), the card is called "Jennie #3" and you can
          rename it after.
        </p>
        <div className="dev-buttons">
          <button
            className="btn ghost"
            disabled={Boolean(progress)}
            onClick={() => pickFolder.current?.click()}
          >
            Choose a folder
          </button>
          <button
            className="btn ghost"
            disabled={Boolean(progress)}
            onClick={() => pickFiles.current?.click()}
          >
            Choose photos
          </button>
        </div>
        <input
          ref={pickFolder}
          type="file"
          multiple
          hidden
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
        <input
          ref={pickFiles}
          type="file"
          multiple
          hidden
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
        {files.length > 0 && !progress && (
          <div className="kc-batch">
            <strong>
              {matches.ok.length} new card{matches.ok.length === 1 ? "" : "s"},
              all {rarityInfo[rarity].name}
            </strong>
            <ul className="kc-matches">
              {matches.ok.map((m) => (
                <li key={m.file.name}>
                  <span className="muted small">{m.file.name}</span> →{" "}
                  {pileName(m.match.pile)}
                  {m.match.name ? ` · "${m.match.name}"` : ""}
                </li>
              ))}
            </ul>
            {matches.unmatched.length > 0 && (
              <p className="small warning">
                ⚠️ Not matched to a pile, so they'll be skipped:{" "}
                {matches.unmatched.slice(0, 12).join(", ")}
                {matches.unmatched.length > 12
                  ? ` and ${matches.unmatched.length - 12} more`
                  : ""}
                .
              </p>
            )}
            {matches.skipped > 0 && (
              <p className="muted small">
                {matches.skipped} file(s) aren't pictures and will be skipped.
              </p>
            )}
            <div className="dev-buttons">
              <button
                className="btn primary"
                disabled={!matches.ok.length}
                onClick={uploadBatch}
              >
                Add {matches.ok.length} card{matches.ok.length === 1 ? "" : "s"}
              </button>
              <button className="btn ghost" onClick={() => setFiles([])}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </details>
      {progress && (
        <div className="kc-batch">
          <strong>
            Adding cards… {progress.done}/{progress.total}
          </strong>
          <div className="poll-bar">
            <span
              style={{
                width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        </div>
      )}
      {failures.length > 0 && (
        <div className="notice warning-box">
          <strong>Some cards weren't added</strong>
          {failures.map((f) => (
            <span key={f} className="small">
              ⚠️ {f}
            </span>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {kinds.map(([kind, title]) => {
        const list = data.piles.filter((p) => p.kind === kind);
        if (!list.length) return null;
        const openHere = list.find((p) => p.key === openPile);
        return (
          <div key={kind} className="kc-pile">
            <strong className="small">
              {title}{" "}
              <span className="muted">
                {list.reduce((a, p) => a + p.count, 0)} cards
              </span>
            </strong>
            <div className="kc-members">
              {list.map((p) => (
                <PileTile
                  key={p.key}
                  pile={p}
                  open={openPile === p.key}
                  onClick={() => setOpenPile(openPile === p.key ? null : p.key)}
                />
              ))}
            </div>
            {openHere && (
              <PilePanel
                key={`${openHere.key}-${refresh}`}
                pile={openHere}
                credit={credit}
                rarity={rarity}
                onChange={setData}
                onClose={() => setOpenPile(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PileTile({
  pile,
  open,
  onClick,
}: {
  pile: PileView;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`kc-member kc-pile-tile ${open ? "open" : ""}`}
      onClick={onClick}
      title={`Manage ${pile.subject}'s cards`}
    >
      <span className="kc-tile">
        {pile.cover ? (
          <img src={photoUrl(pile.cover.id, pile.cover.updatedAt)} alt="" />
        ) : (
          <span className="kc-empty small muted">＋ Add cards</span>
        )}
        {pile.count > 0 && <span className="kc-count small">{pile.count}</span>}
      </span>
      <strong className="small">{pile.subject}</strong>
      {pile.about && <span className="small muted">{pile.about}</span>}
      <span className="small muted">
        {pile.count} card{pile.count === 1 ? "" : "s"}
        {pile.count !== pile.active
          ? ` · ${pile.count - pile.active} out of packs`
          : ""}
      </span>
    </button>
  );
}

/** One pile's cards: add more, and edit or delete each one. */
function PilePanel({
  pile,
  credit,
  rarity,
  onChange,
  onClose,
}: {
  pile: PileView;
  credit: string;
  rarity: Rarity;
  onChange: (r: CardAdminResponse) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<PileCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .pileCards(pile.key)
      .then((r) => setCards(r.cards))
      .catch((err) => setError(err.message));
  }, [pile.key]);

  const apply = (r: CardAdminResponse & { cards: PileCard[] }) => {
    onChange(r);
    setCards(r.cards);
  };

  const add = async (list: File[]) => {
    setBusy(true);
    setError("");
    for (const file of list.filter(isPicture)) {
      if (file.size > CARD_PHOTO.maxBytes) {
        setError(`${file.name} is too big (8 MB max).`);
        continue;
      }
      try {
        apply(
          await api.addCard(pile.key, file, {
            name: "",
            rarity,
            credit: credit.trim(),
          }),
        );
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setBusy(false);
    if (pick.current) pick.current.value = "";
  };

  return (
    <div className="kc-pile-panel">
      <div className="kc-pile-head">
        <strong>
          {pile.subject}
          {pile.about ? (
            <span className="muted small"> · {pile.about}</span>
          ) : null}
        </strong>
        <span className="dev-buttons">
          <button
            className="btn primary small"
            disabled={busy}
            onClick={() => pick.current?.click()}
          >
            {busy ? "Adding…" : `＋ Add cards (${rarityInfo[rarity].name})`}
          </button>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </span>
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => void add([...(e.target.files ?? [])])}
        />
      </div>
      <p className="muted small">
        Pick one or more photos: each becomes a new card in {pile.subject}'s
        pile, starting as {rarityInfo[rarity].name} (change it for each card
        below, or pick a different starting rarity above).
      </p>
      {error && <p className="error small">{error}</p>}
      {!cards ? (
        <p className="muted small">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="muted small">No cards in this pile yet.</p>
      ) : (
        <div className="kc-card-list">
          {cards.map((c) => (
            <CardEditor
              key={`${c.id}-${c.updatedAt}`}
              card={c}
              onChange={apply}
              onError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CardEditor({
  card,
  onChange,
  onError,
}: {
  card: PileCard;
  onChange: (r: CardAdminResponse & { cards: PileCard[] }) => void;
  onError: (e: string) => void;
}) {
  const [d, setD] = useState({
    name: card.name,
    rarity: card.rarity,
    type: card.type,
    credit: card.credit,
    active: card.active,
  });
  const [busy, setBusy] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const dirty =
    d.name !== card.name ||
    d.rarity !== card.rarity ||
    d.type !== card.type ||
    d.credit !== card.credit ||
    d.active !== card.active;

  const run = async (
    job: () => Promise<CardAdminResponse & { cards: PileCard[] }>,
  ) => {
    setBusy(true);
    onError("");
    try {
      onChange(await job());
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`kc-card-edit ${card.active ? "" : "inactive"}`}>
      <a
        href={previewUrl(card.id, card.updatedAt)}
        target="_blank"
        rel="noreferrer"
        title="See the finished card"
      >
        <img src={photoUrl(card.id, card.updatedAt)} alt="" />
      </a>
      <div className="kc-card-fields">
        <div className="kc-card-row">
          <input
            value={d.name}
            maxLength={CARD_PHOTO.name}
            placeholder="Card name"
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
          <span className="muted small">#{card.number}</span>
        </div>
        <RaritySelect
          value={d.rarity}
          onChange={(r) => setD({ ...d, rarity: r })}
        />
        <select
          value={d.type}
          onChange={(e) => setD({ ...d, type: e.target.value as Card["type"] })}
        >
          {cardTypes.map((t) => (
            <option key={t} value={t}>
              {typeInfo[t].emoji} {typeInfo[t].name}
            </option>
          ))}
        </select>
        <input
          className="small"
          value={d.credit}
          maxLength={CARD_PHOTO.credit}
          placeholder="Photo credit (optional)"
          onChange={(e) => setD({ ...d, credit: e.target.value })}
        />
        <span className="muted small">
          HP {card.hp} · Power {card.power} · {card.owned} owned
        </span>
        <label className="check small">
          <input
            type="checkbox"
            checked={d.active}
            onChange={(e) => setD({ ...d, active: e.target.checked })}
          />
          <span>In packs</span>
        </label>
        <div className="kc-card-row">
          <span className="kc-card-actions">
            {dirty && (
              <button
                className="btn primary small"
                disabled={busy || !d.name.trim()}
                onClick={() =>
                  run(() =>
                    api.editCard(card.id, { ...d, name: d.name.trim() }),
                  )
                }
              >
                Save
              </button>
            )}
            <button
              className="link small"
              disabled={busy}
              onClick={() => photo.current?.click()}
            >
              Change photo
            </button>
            <button
              className="link small danger"
              disabled={busy}
              onClick={() => {
                const owned = card.owned
                  ? ` ${card.owned} member${card.owned === 1 ? " owns" : "s own"} it, and they'll lose it too.`
                  : "";
                if (
                  confirm(
                    `Delete "${card.name}"?${owned} To keep it for owners, untick "In packs" instead.`,
                  )
                )
                  void run(() => api.deleteCard(card.id));
              }}
            >
              Delete
            </button>
          </span>
        </div>
      </div>
      <input
        ref={photo}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(() => api.replaceCardPhoto(card.id, f));
        }}
      />
    </div>
  );
}
