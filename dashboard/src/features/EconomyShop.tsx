import { useState } from "react";
import { type CurrencySettings, type EconomyResponse, SHOP_LIMITS, type ShopItemInput, type ShopItemView, formatMoney } from "../../../src/shared/economy";
import { type GuildDetails, api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { RoleSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const n = (x: number) => x.toLocaleString("en-US");
/** Custom emoji like <:gem:123> can't show as text on the website, so show their name instead. */
const plainEmoji = (e: string) => e.replace(/<a?:(\w+):\d+>/g, ":$1:");

const blankItem = (): ShopItemInput => ({ name: "", description: "", emoji: "", price: 100, roleId: null, stock: null, maxPerMember: null, hidden: false });

/** The shop's items on the Economy dashboard: list, add, edit, hide and delete. */
export function EconomyShop({
  guild,
  items,
  currency,
  onChange,
}: {
  guild: Guild;
  items: ShopItemView[];
  currency: CurrencySettings;
  onChange: (r: EconomyResponse) => void;
}) {
  const [editing, setEditing] = useState<{ id: number | null; draft: ShopItemInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cur = { ...currency, emoji: plainEmoji(currency.emoji) };
  const roleName = (id: string) => guild.roles.find((r) => r.id === id)?.name ?? "deleted role";

  const run = async (job: () => Promise<EconomyResponse>) => {
    setBusy(true);
    setError("");
    try {
      onChange(await job());
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toInput = (i: ShopItemView): ShopItemInput => ({
    name: i.name,
    description: i.description,
    emoji: i.emoji,
    price: i.price,
    roleId: i.roleId,
    stock: i.stock,
    maxPerMember: i.maxPerMember,
    hidden: i.hidden,
  });

  if (editing) {
    const d = editing.draft;
    const set = (patch: Partial<ShopItemInput>) => setEditing({ ...editing, draft: { ...d, ...patch } });
    const problem = !d.name.trim() ? "Give the item a name." : d.price < 1 ? "The price has to be at least 1." : null;
    return (
      <div className="sub-body">
        <div className="mod-row">
          <label className="field">
            <span>Name</span>
            <input maxLength={SHOP_LIMITS.name} value={d.name} placeholder="e.g. VIP role, Custom nickname" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Emoji (optional)</span>
            <input maxLength={64} value={d.emoji} placeholder="e.g. ⭐" onChange={(e) => set({ emoji: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>Description (optional)</span>
          <input maxLength={SHOP_LIMITS.description} value={d.description} placeholder="What members get" onChange={(e) => set({ description: e.target.value })} />
        </label>
        <div className="mod-row">
          <label className="field">
            <span>Price</span>
            <NumberInput min={1} value={d.price} onChange={(v) => set({ price: v })} />
            <small className="muted">{formatMoney(cur, d.price, false)}</small>
          </label>
          <label className="field">
            <span>Gives a role (optional)</span>
            <RoleSelect guild={guild} value={d.roleId} onChange={(v) => set({ roleId: v, maxPerMember: v ? 1 : d.maxPerMember })} emptyLabel="No role" />
            {d.roleId && (
              <button className="link small" onClick={() => set({ roleId: null, maxPerMember: null })}>Don't give a role</button>
            )}
          </label>
        </div>
        <div className="mod-row">
          <label className="field">
            <span>Stock (empty = unlimited)</span>
            <NumberInput
              empty
              min={0}
              value={d.stock}
              onChange={(v) => set({ stock: v })}
            />
          </label>
          <label className="field">
            <span>Most per member (empty = no limit)</span>
            <NumberInput
              empty
              min={1}
              disabled={Boolean(d.roleId)}
              value={d.roleId ? 1 : d.maxPerMember}
              onChange={(v) => set({ maxPerMember: v })}
            />
            {d.roleId && <small className="muted">Roles can only be bought once.</small>}
          </label>
        </div>
        <Toggle label="Hidden" hint="Hidden items aren't shown in /shop and can't be bought." checked={d.hidden} onChange={(v) => set({ hidden: v })} />
        {error && <p className="error">{error}</p>}
        <div className="evt-buttons">
          <button className="btn ghost small" disabled={busy} onClick={() => { setEditing(null); setError(""); }}>Cancel</button>
          <button
            className="btn primary small"
            disabled={busy || Boolean(problem)}
            title={problem ?? undefined}
            onClick={() => run(() => (editing.id ? api.updateShopItem(guild.id, editing.id, d) : api.createShopItem(guild.id, d)))}
          >
            {busy ? "Saving…" : editing.id ? "Save item" : "Add item"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sub-body">
      {items.length === 0 ? (
        <p className="muted small">The shop is empty. Add roles, perks or fun items for members to buy.</p>
      ) : (
        <ul className="economy-shop">
          {items.map((i) => (
            <li key={i.id} className={i.hidden ? "hidden-item" : undefined}>
              <span className="economy-shop-text">
                <strong>{i.emoji ? `${plainEmoji(i.emoji)} ` : ""}{i.name}</strong>
                <span className="muted small">
                  {formatMoney(cur, i.price, false)}
                  {i.roleId ? ` · gives @${roleName(i.roleId)}` : ""}
                  {i.stock !== null ? ` · ${n(i.stock)} left` : ""}
                  {` · ${n(i.sold)} sold`}
                  {i.hidden ? " · hidden" : ""}
                </span>
              </span>
              <button className="btn ghost small" onClick={() => setEditing({ id: i.id, draft: toInput(i) })}>Edit</button>
              <button
                className="btn danger small"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete "${i.name}"? It's also removed from every member's inventory. Roles already bought are kept.`)) {
                    void run(() => api.deleteShopItem(guild.id, i.id));
                  }
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      <button
        className="btn primary small economy-shop-add"
        disabled={items.length >= SHOP_LIMITS.items}
        onClick={() => setEditing({ id: null, draft: blankItem() })}
      >
        + Add item
      </button>
    </div>
  );
}
