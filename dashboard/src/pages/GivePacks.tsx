import { useEffect, useState } from "react";
import { type GiveMember, type GiveServer, MAX_GIFT_PACKS, packInfo } from "../../../src/shared/cards";
import { api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { Toggle } from "../components/pickers";

type Kind = "standard" | "premium";

/** Developer console: put BLACKPINK Poker packs straight into a member's bag, for free. */
export function GivePacks() {
  const [servers, setServers] = useState<GiveServer[] | null>(null);
  const [guildId, setGuildId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GiveMember[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState<GiveMember | null>(null);
  const [kind, setKind] = useState<Kind>("standard");
  const [amount, setAmount] = useState(1);
  const [dm, setDm] = useState(true);
  const [giving, setGiving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    api.giveServers().then(setServers).catch((err) => setError(err.message));
  }, []);

  // Search members as you type (a short pause first, so it doesn't search on every key).
  useEffect(() => {
    if (!guildId || !query.trim() || member) return setResults(null);
    setSearching(true);
    const t = setTimeout(() => {
      api
        .giveMembers(guildId, query)
        .then(setResults)
        .catch((err) => setError(err.message))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [guildId, query, member]);

  if (!servers) return error ? <p className="error">{error}</p> : <p className="muted">Loading servers…</p>;

  const server = servers.find((s) => s.id === guildId);
  const what = `${amount} ${packInfo[kind].name.toLowerCase()}${amount === 1 ? "" : "s"}`;

  const give = async () => {
    if (!member || !server) return;
    setError("");
    setDone("");
    setGiving(true);
    try {
      const r = await api.givePacks({ guildId, userId: member.id, kind, amount, dm });
      setDone(
        `Gave ${member.name} ${what} in ${server.name}. They now have ${r.bag.standard} Standard and ${r.bag.premium} Premium unopened.` +
          (dm ? (r.dmSent ? " They got a DM about it." : " Their DMs are closed, so they weren't told.") : ""),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGiving(false);
    }
  };

  return (
    <div className="card give-packs">
      <label className="field">
        <span>1. Server</span>
        <select
          value={guildId}
          onChange={(e) => {
            setGuildId(e.target.value);
            setMember(null);
            setQuery("");
            setDone("");
          }}
        >
          <option value="">Pick a server…</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.members.toLocaleString()} members)
            </option>
          ))}
        </select>
      </label>

      {guildId && (
        <div className="field">
          <span>2. Member</span>
          {member ? (
            <div className="give-member picked">
              <img src={member.avatar} alt="" />
              <span>
                <strong>{member.name}</strong> <small className="muted">@{member.username}</small>
              </span>
              <button className="btn ghost small" onClick={() => { setMember(null); setDone(""); }}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input value={query} placeholder="Search by name, or paste their user ID" onChange={(e) => setQuery(e.target.value)} autoFocus />
              {searching && <small className="muted">Searching…</small>}
              {results && !searching && results.length === 0 && <small className="muted">No one found. Try their username or user ID.</small>}
              {results && results.length > 0 && (
                <div className="give-results">
                  {results.map((m) => (
                    <button key={m.id} className="give-member" onClick={() => setMember(m)}>
                      <img src={m.avatar} alt="" />
                      <span>
                        <strong>{m.name}</strong> <small className="muted">@{m.username}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {member && (
        <>
          <div className="field">
            <span>3. Pack</span>
            <div className="give-kinds">
              {(["standard", "premium"] as const).map((k) => (
                <button key={k} className={`chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {packInfo[k].emoji} {packInfo[k].name}
                </button>
              ))}
            </div>
            <small className="muted">{packInfo[kind].about}</small>
          </div>
          <label className="field">
            <span>4. How many</span>
            <NumberInput min={1} max={MAX_GIFT_PACKS} value={amount} onChange={setAmount} />
          </label>
          <Toggle label="Let them know by DM" hint="Tells them what they got and to use /cards open." checked={dm} onChange={setDm} />
          <div className="dev-buttons">
            <button className="btn primary" disabled={giving} onClick={give}>
              {giving ? "Giving…" : `Give ${what} to ${member.name}`}
            </button>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {done && <p className="give-done">🎁 {done}</p>}
    </div>
  );
}
