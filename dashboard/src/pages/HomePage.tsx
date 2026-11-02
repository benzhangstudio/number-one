import { useEffect, useState } from "react";
import type { DashboardGuild, DashboardUser } from "../../../src/shared/features";
import { api, inviteUrl } from "../api";
import { SUPPORT_SERVER } from "../components/Footer";
import { PageLink } from "../components/PageLink";
import { announcements } from "../content/announcements";
import { navigate } from "../router";
import { AnnouncementCard } from "./AnnouncementsPage";
import { GuildIcon } from "./ServersPage";

const SHOWN_SERVERS = 6;
const SHOWN_ANNOUNCEMENTS = 3;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The logged-in home page: your servers, the latest announcements and quick links. */
export function HomePage({ user }: { user: DashboardUser }) {
  const [guilds, setGuilds] = useState<DashboardGuild[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.guilds().then(setGuilds).catch((err) => setError(err.message));
    api.config().then((c) => setClientId(c.clientId ?? "")).catch(() => {});
  }, []);

  const managed = guilds?.filter((g) => g.botPresent) ?? [];
  const addable = guilds?.filter((g) => !g.botPresent) ?? [];

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>
            {greeting()}, {user.username}
          </h1>
          <p className="muted">Pick a server to manage, or catch up on what's new.</p>
        </div>
        <button className="btn primary" onClick={() => navigate("/servers")}>
          All servers
        </button>
      </header>

      <div className="home-grid">
        <section className="home-main">
          <div className="home-section-head">
            <h2>Your servers</h2>
            {guilds && managed.length > SHOWN_SERVERS && <PageLink to="/servers">View all ({managed.length})</PageLink>}
          </div>
          {error && <p className="error">{error}</p>}
          {!guilds && !error && <p className="muted">Loading your servers…</p>}
          {guilds && managed.length === 0 && (
            <div className="card home-empty">
              <p>Number One isn't in any server you manage yet.</p>
              {clientId && (
                <a className="btn primary small" href={inviteUrl(clientId)} target="_blank" rel="noreferrer">
                  Add to a server
                </a>
              )}
            </div>
          )}
          {managed.length > 0 && (
            <div className="home-servers">
              {managed.slice(0, SHOWN_SERVERS).map((g) => (
                <button key={g.id} className="card home-server" onClick={() => navigate(`/servers/${g.id}`)}>
                  <GuildIcon guild={g} size={40} />
                  <span className="home-server-name">{g.name}</span>
                  <span className="home-server-go" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="home-section-head">
            <h2>Latest announcements</h2>
            <PageLink to="/announcements">View all</PageLink>
          </div>
          {announcements.length === 0 ? (
            <p className="muted">No announcements yet.</p>
          ) : (
            <div className="announcement-list">
              {announcements.slice(0, SHOWN_ANNOUNCEMENTS).map((a) => (
                <AnnouncementCard key={a.id} item={a} compact />
              ))}
            </div>
          )}
        </section>

        <aside className="home-side">
          <div className="card home-panel">
            <h3>Quick links</h3>
            <ul className="home-links">
              <li>
                <PageLink to="/servers">📋 My servers</PageLink>
              </li>
              <li>
                <PageLink to="/announcements">📣 Announcements</PageLink>
              </li>
              {clientId && (
                <li>
                  <a href={inviteUrl(clientId)} target="_blank" rel="noreferrer">
                    ➕ Add bot to a server
                  </a>
                </li>
              )}
              <li>
                <a href={SUPPORT_SERVER} target="_blank" rel="noopener noreferrer">
                  💬 Support server
                </a>
              </li>
            </ul>
          </div>

          {addable.length > 0 && (
            <div className="card home-panel">
              <h3>Not added yet</h3>
              <p className="muted small">Servers you manage without Number One.</p>
              <ul className="home-addable">
                {addable.slice(0, 5).map((g) => (
                  <li key={g.id}>
                    <GuildIcon guild={g} size={28} />
                    <span className="home-server-name">{g.name}</span>
                    {clientId && (
                      <a className="btn ghost small" href={inviteUrl(clientId, g.id)} target="_blank" rel="noreferrer">
                        Add
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card home-panel">
            <h3>Getting started</h3>
            <ol className="home-steps">
              <li>Add Number One to a server.</li>
              <li>
                Run <code>/setup</code> in Discord.
              </li>
              <li>Fine-tune each feature here.</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
