import { useEffect, useState } from "react";
import {
  DAILY_COOLDOWN_HOURS,
  type EconomyResponse,
  type EconomySettings,
  HISTORY_DAYS,
  STREAK_GRACE_HOURS,
  formatMoney,
  transactionKinds,
} from "../../../src/shared/economy";
import { type GuildDetails, api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { ChannelPicker, Toggle } from "../components/pickers";
import { EconomyShop } from "./EconomyShop";

type Guild = GuildDetails["guild"];
type Draft = EconomySettings;

const n = (x: number) => x.toLocaleString("en-US");
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Custom emoji like <:gem:123> can't show as text on the website, so show their name instead. */
const plainEmoji = (e: string) => e.replace(/<a?:(\w+):\d+>/g, ":$1:");

const CHAT_COOLDOWNS = [0, 15, 30, 60, 120, 300];
const WORK_COOLDOWNS = [15, 30, 60, 120, 240, 480, 720, 1440];
const GAME_COOLDOWNS = [0, 5, 10, 30, 60, 300];
const minutesLabel = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`);

/** Dashboard section for Economy: the currency, how it's earned, the shop, games, the richest members and recent activity. */
export function EconomyPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<EconomyResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = (r: EconomyResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.economy(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading economy…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });
  const cur = { ...draft.currency, emoji: plainEmoji(draft.currency.emoji) };
  const money = (v: number) => formatMoney(cur, v, false);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveEconomy(guild.id, draft));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm(`Reset every member's ${data.settings.currency.plural} to zero and delete the history? This can't be undone.`)) return;
    setResetting(true);
    setError("");
    try {
      const r = await api.resetEconomy(guild.id);
      setData((d) => (d ? { ...d, holders: r.holders, totalMoney: r.totalMoney, richest: r.richest, activity: r.activity } : r));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const num = (value: number, max: number, onChange: (v: number) => void, min = 0) => (
    <NumberInput min={min} max={max} value={value} onChange={(v) => onChange(v)} />
  );

  return (
    <div className="panel economy">
      <div className="stats">
        <div><strong>{n(data.holders)}</strong><span className="muted small">members with {data.settings.currency.plural}</span></div>
        <div><strong>{n(data.totalMoney)}</strong><span className="muted small">{data.settings.currency.plural} in total</span></div>
        <div><strong>{data.richest[0] ? n(data.richest[0].balance) : "—"}</strong><span className="muted small">richest member has</span></div>
      </div>

      {data.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {data.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}

      <div className="mod-grid">
        <section className="sub">
          <div className="sub-head">
            <strong>Currency</strong>
            <small className="muted">What your server's money is called. Preview: {money(1)} · {money(250)}</small>
          </div>
          <div className="mod-row">
            <label className="field">
              <span>Name for one</span>
              <input maxLength={32} value={draft.currency.singular} onChange={(e) => set((d) => { d.currency.singular = e.target.value; })} />
            </label>
            <label className="field">
              <span>Name for many</span>
              <input maxLength={32} value={draft.currency.plural} onChange={(e) => set((d) => { d.currency.plural = e.target.value; })} />
            </label>
          </div>
          <div className="mod-row">
            <label className="field">
              <span>Emoji</span>
              <input maxLength={64} value={draft.currency.emoji} onChange={(e) => set((d) => { d.currency.emoji = e.target.value; })} />
              <small className="muted">An emoji like 💎, or a server emoji's code like <code>&lt;:gem:123…&gt;</code>.</small>
            </label>
            <label className="field">
              <span>Starting balance</span>
              {num(draft.startingBalance, 1_000_000, (v) => set((d) => { d.startingBalance = v; }))}
              <small className="muted">What members have before they earn anything.</small>
            </label>
          </div>
        </section>

        <section className="sub">
          <div className="sub-head">
            <strong>Other ways to get it</strong>
          </div>
          <label className="field">
            <span>Reward for each new level</span>
            {num(draft.levelUpReward, 1_000_000, (v) => set((d) => { d.levelUpReward = v; }))}
            <small className="muted">Paid when someone levels up with the Levels module. 0 turns it off.</small>
          </label>
          <Toggle
            label="Let members pay each other"
            hint="Members can send money with /pay."
            checked={draft.payEnabled}
            onChange={(v) => set((d) => { d.payEnabled = v; })}
          />
        </section>
      </div>

      <div className="mod-grid">
        <section className="sub">
          <Toggle label="Earn by chatting" hint="A small random amount per message, once per cooldown." checked={draft.chat.enabled} onChange={(v) => set((d) => { d.chat.enabled = v; })} />
          {draft.chat.enabled && (
            <div className="sub-body">
              <div className="mod-row">
                <label className="field"><span>From</span>{num(draft.chat.min, 1000, (v) => set((d) => { d.chat.min = v; }))}</label>
                <label className="field"><span>to</span>{num(draft.chat.max, 1000, (v) => set((d) => { d.chat.max = v; }))}</label>
              </div>
              <label className="field">
                <span>Cooldown</span>
                <select value={draft.chat.cooldownSeconds} onChange={(e) => set((d) => { d.chat.cooldownSeconds = Number(e.target.value); })}>
                  {!CHAT_COOLDOWNS.includes(draft.chat.cooldownSeconds) && <option value={draft.chat.cooldownSeconds}>{draft.chat.cooldownSeconds} seconds</option>}
                  {CHAT_COOLDOWNS.map((s) => <option key={s} value={s}>{s === 0 ? "No cooldown" : s < 60 ? `${s} seconds` : minutesLabel(s / 60)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Nothing earned in</span>
                <ChannelPicker guild={guild} value={draft.chat.noEarnChannelIds} onChange={(v) => set((d) => { d.chat.noEarnChannelIds = v; })} placeholder="Add a channel or category…" />
              </label>
            </div>
          )}
        </section>

        <section className="sub">
          <Toggle
            label="/daily"
            hint={`Once every ${DAILY_COOLDOWN_HOURS} hours. Claiming again within ${STREAK_GRACE_HOURS / 24} days builds a streak.`}
            checked={draft.daily.enabled}
            onChange={(v) => set((d) => { d.daily.enabled = v; })}
          />
          {draft.daily.enabled && (
            <div className="sub-body">
              <label className="field"><span>Amount</span>{num(draft.daily.amount, 1_000_000, (v) => set((d) => { d.daily.amount = v; }))}</label>
              <div className="mod-row">
                <label className="field"><span>Extra per streak day</span>{num(draft.daily.streakBonus, 100_000, (v) => set((d) => { d.daily.streakBonus = v; }))}</label>
                <label className="field"><span>Most extra</span>{num(draft.daily.maxStreakBonus, 1_000_000, (v) => set((d) => { d.daily.maxStreakBonus = v; }))}</label>
              </div>
              <small className="muted">
                Day 1: {money(draft.daily.amount)} · Day 5: {money(draft.daily.amount + Math.min(draft.daily.maxStreakBonus, 4 * draft.daily.streakBonus))}
              </small>
            </div>
          )}
          <div className="spaced-top">
            <Toggle label="/work" hint="A quick job for a random amount, once per cooldown." checked={draft.work.enabled} onChange={(v) => set((d) => { d.work.enabled = v; })} />
          </div>
          {draft.work.enabled && (
            <div className="sub-body">
              <div className="mod-row">
                <label className="field"><span>From</span>{num(draft.work.min, 1_000_000, (v) => set((d) => { d.work.min = v; }))}</label>
                <label className="field"><span>to</span>{num(draft.work.max, 1_000_000, (v) => set((d) => { d.work.max = v; }))}</label>
              </div>
              <label className="field">
                <span>Cooldown</span>
                <select value={draft.work.cooldownMinutes} onChange={(e) => set((d) => { d.work.cooldownMinutes = Number(e.target.value); })}>
                  {!WORK_COOLDOWNS.includes(draft.work.cooldownMinutes) && <option value={draft.work.cooldownMinutes}>{minutesLabel(draft.work.cooldownMinutes)}</option>}
                  {WORK_COOLDOWNS.map((m) => <option key={m} value={m}>{minutesLabel(m)}</option>)}
                </select>
              </label>
            </div>
          )}
        </section>
      </div>

      <div className="mod-grid">
        <section className="sub">
          <Toggle
            label="🛍️ Shop"
            hint="Members browse with /shop, buy with /buy and see what they own with /inventory. Items save straight away."
            checked={draft.shop.enabled}
            onChange={(v) => set((d) => { d.shop.enabled = v; })}
          />
          {draft.shop.enabled && (
            <EconomyShop
              guild={guild}
              items={data.shopItems}
              currency={data.settings.currency}
              onChange={(r) => setData((old) => (old ? { ...old, shopItems: r.shopItems, problems: r.problems } : r))}
            />
          )}
        </section>

        <section className="sub">
          <Toggle label="🎲 Games" hint="Members bet their money. Bets are taken first and winnings paid back." checked={draft.games.enabled} onChange={(v) => set((d) => { d.games.enabled = v; })} />
          {draft.games.enabled && (
            <div className="sub-body">
              <Toggle label="/coinflip" hint="Heads or tails. Right guess doubles the bet." checked={draft.games.coinflip} onChange={(v) => set((d) => { d.games.coinflip = v; })} />
              <Toggle label="/slots" hint="Three in a row pays ×5 to ×100. Two in a row gives the bet back." checked={draft.games.slots} onChange={(v) => set((d) => { d.games.slots = v; })} />
              <Toggle label="/blackjack" hint="Against Number One, with Hit, Stand and Double buttons. Blackjack pays 3 to 2." checked={draft.games.blackjack} onChange={(v) => set((d) => { d.games.blackjack = v; })} />
              <div className="mod-row">
                <label className="field"><span>Smallest bet</span>{num(draft.games.minBet, 1_000_000_000, (v) => set((d) => { d.games.minBet = v; }), 1)}</label>
                <label className="field"><span>Biggest bet</span>{num(draft.games.maxBet, 1_000_000_000, (v) => set((d) => { d.games.maxBet = v; }), 1)}</label>
              </div>
              <label className="field">
                <span>Wait between games</span>
                <select value={draft.games.cooldownSeconds} onChange={(e) => set((d) => { d.games.cooldownSeconds = Number(e.target.value); })}>
                  {!GAME_COOLDOWNS.includes(draft.games.cooldownSeconds) && <option value={draft.games.cooldownSeconds}>{draft.games.cooldownSeconds} seconds</option>}
                  {GAME_COOLDOWNS.map((sec) => <option key={sec} value={sec}>{sec === 0 ? "No wait" : sec < 60 ? `${sec} seconds` : minutesLabel(sec / 60)}</option>)}
                </select>
                <small className="muted">Stops channels from filling up with games.</small>
              </label>
            </div>
          )}
        </section>
      </div>

      <div className="mod-grid">
        <section className="sub">
          <div className="sub-head">
            <strong>Richest members</strong>
            <small className="muted">The top 25. Members see the full list with <code>/richest</code>.</small>
          </div>
          {data.richest.length === 0 ? (
            <p className="muted small">Nobody has any {data.settings.currency.plural} yet.</p>
          ) : (
            <ol className="levels-board economy-board">
              {data.richest.map((m, i) => (
                <li key={m.userId}>
                  <span className="levels-place">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                  {m.avatar ? <img src={m.avatar} alt="" /> : <span className="levels-avatar" />}
                  <span className="levels-name">{m.name}</span>
                  <strong>{n(m.balance)}</strong>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="sub">
          <div className="sub-head">
            <strong>Recent activity</strong>
            <small className="muted">Kept for {HISTORY_DAYS} days. Chatting isn't listed, there's too much of it.</small>
          </div>
          {data.activity.length === 0 ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            <ul className="economy-activity">
              {data.activity.map((a) => (
                <li key={a.id}>
                  <span className={a.amount > 0 ? "economy-plus" : "economy-minus"}>{a.amount > 0 ? "+" : "−"}{n(Math.abs(a.amount))}</span>
                  <span className="levels-name">
                    {a.kind === "pay_out" ? <>{a.name} → {a.otherName}</> : <>{a.name} · {transactionKinds[a.kind]}</>}
                  </span>
                  <span className="muted small">{when(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {data.holders > 0 && (
        <button className="btn danger small" disabled={resetting} onClick={reset}>
          {resetting ? "Resetting…" : `Reset everyone's ${data.settings.currency.plural}`}
        </button>
      )}

      {error && <p className="error">{error}</p>}
      <div className="save-bar">
        <span>{dirty ? "You have unsaved changes." : "No changes to save."}</span>
        <button className="btn ghost small" disabled={saving || !dirty} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
        <button
          className="btn primary small"
          disabled={saving || !dirty || !draft.currency.singular.trim() || !draft.currency.plural.trim() || !draft.currency.emoji.trim()}
          onClick={save}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
