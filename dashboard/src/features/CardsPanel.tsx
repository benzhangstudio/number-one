import { useEffect, useState } from "react";
import { type CardSettings, type CardsResponse, packInfo, rarities, rarityInfo } from "../../../src/shared/cards";
import { type GuildDetails, api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const n = (x: number) => x.toLocaleString("en-US");

/** Dashboard section for BLACKPINK Poker: the mode, prices, rewards and the top collectors. */
export function CardsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<CardsResponse | null>(null);
  const [draft, setDraft] = useState<CardSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = (r: CardsResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };
  useEffect(() => {
    api.cards(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading cards…</p>;

  const set = (fn: (d: CardSettings) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const money = (x: number) => `${data.currency.emoji} ${n(x)} ${x === 1 ? data.currency.singular : data.currency.plural}`;
  const num = (value: number, onChange: (v: number) => void, max = 1_000_000) => (
    <NumberInput min={0} max={max} value={value} onChange={(v) => onChange(v)} />
  );
  const economy = draft.mode === "economy";

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveCardSettings(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel economy">
      <div className="stats">
        <div><strong>{n(data.ready)}</strong><span className="muted small">of {n(data.stats.catalog)} cards ready</span></div>
        <div><strong>{n(data.stats.owned)}</strong><span className="muted small">cards collected here</span></div>
        <div><strong>{n(data.stats.collectors)}</strong><span className="muted small">collectors</span></div>
      </div>

      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Good to know</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}

      <section className="sub">
        <div className="sub-head">
          <strong>🃏 How it works in this server</strong>
          <small className="muted">Members use <code>/cards</code> to open packs, collect, battle and trade.</small>
        </div>
        <div className="kc-modes">
          <button className={`kc-mode ${economy ? "on" : ""}`} onClick={() => set((d) => { d.mode = "economy"; })}>
            <strong>💰 With Economy</strong>
            <small className="muted">Packs cost {data.currency.plural}, duplicates sell for them, and battle wins pay out. Needs the Economy module.</small>
          </button>
          <button className={`kc-mode ${!economy ? "on" : ""}`} onClick={() => set((d) => { d.mode = "cards"; })}>
            <strong>🃏 Cards only</strong>
            <small className="muted">No money at all. A free daily pack, and a bonus card for beating Number One.</small>
          </button>
        </div>
        {economy && data.economyOff && <p className="muted small">Economy is switched off, so this runs as Cards only until you switch Economy on.</p>}
      </section>

      <div className="mod-grid">
        <section className="sub">
          <div className="sub-head"><strong>📦 Packs</strong></div>
          <Toggle label={`${packInfo.daily.emoji} Free daily pack`} hint="3 cards every 20 hours, in both modes." checked={draft.daily} onChange={(v) => set((d) => { d.daily = v; })} />
          {economy && (
            <div className="mod-row">
              {(["standard", "premium"] as const).map((k) => (
                <label key={k} className="field">
                  <span>{packInfo[k].emoji} {packInfo[k].name}</span>
                  {num(draft.prices[k], (v) => set((d) => { d.prices[k] = v; }))}
                  <small className="muted">{money(draft.prices[k])}</small>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="sub">
          <div className="sub-head"><strong>⚔️ Battles and trading</strong></div>
          <Toggle label="Battles" hint="Against Number One, or another member. Teams of 3, Pokémon-style types." checked={draft.battles.enabled} onChange={(v) => set((d) => { d.battles.enabled = v; })} />
          {draft.battles.enabled && (
            <div className="mod-row">
              {economy && (
                <label className="field">
                  <span>Reward for beating Number One</span>
                  {num(draft.battles.winReward, (v) => set((d) => { d.battles.winReward = v; }))}
                </label>
              )}
              <label className="field">
                <span>Rewarded wins per day</span>
                {num(draft.battles.rewardedWinsPerDay, (v) => set((d) => { d.battles.rewardedWinsPerDay = v; }), 50)}
                <small className="muted">{economy ? "Each one pays the reward." : "Each one gives a bonus card."}</small>
              </label>
            </div>
          )}
          {draft.battles.enabled && economy && (
            <Toggle label="Bets between members" checked={draft.battles.bets} onChange={(v) => set((d) => { d.battles.bets = v; })} />
          )}
          <Toggle label="Trading and gifts" hint="Members swap or give cards with /cards trade and /cards gift." checked={draft.trading} onChange={(v) => set((d) => { d.trading = v; })} />
        </section>
      </div>

      {economy && (
        <section className="sub">
          <div className="sub-head"><strong>💸 What cards sell for</strong><small className="muted">Members sell with <code>/cards sell</code> and <code>/cards sell-duplicates</code>.</small></div>
          <div className="kc-sell">
            {rarities.map((r) => (
              <label key={r} className="field">
                <span style={{ color: rarityInfo[r].color }}>{"★".repeat(rarityInfo[r].stars)} {rarityInfo[r].name}</span>
                {num(draft.sell[r], (v) => set((d) => { d.sell[r] = v; }))}
              </label>
            ))}
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {dirty && (
        <div className="evt-buttons">
          <button className="btn ghost small" disabled={saving} onClick={() => setDraft(structuredClone(data.settings))}>Discard</button>
          <button className="btn primary small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}

      <section className="sub">
        <div className="sub-head"><strong>🏆 Top collectors</strong></div>
        {data.top.length === 0 ? (
          <p className="muted small">Nobody has any cards yet.</p>
        ) : (
          <ol className="kc-top">
            {data.top.map((t) => (
              <li key={t.userId}><strong>{t.name}</strong> <span className="muted small">{n(t.unique)} different · {n(t.total)} in all</span></li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
