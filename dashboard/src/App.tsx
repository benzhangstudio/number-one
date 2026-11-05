import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { DashboardUser } from "../../src/shared/features";
import type { MaintenanceState } from "../../src/shared/botUpdates";
import { useHasUnread } from "./announcementsSeen";
import { api, avatarUrl, inviteUrl } from "./api";
import { Footer, SUPPORT_SERVER } from "./components/Footer";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";

// Bigger pages load only when they're opened, so the first visit stays quick.
const GuildPage = lazy(() => import("./pages/GuildPage").then((m) => ({ default: m.GuildPage })));
const DeveloperPage = lazy(() => import("./pages/DeveloperPage").then((m) => ({ default: m.DeveloperPage })));
const DocsPage = lazy(() => import("./pages/DocsPage").then((m) => ({ default: m.DocsPage })));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })));
const ServersPage = lazy(() => import("./pages/ServersPage").then((m) => ({ default: m.ServersPage })));
const TermsPage = lazy(() => import("./pages/TermsPage").then((m) => ({ default: m.TermsPage })));
import { navigate, usePath } from "./router";
import { ACCENTS, useAccent, useTheme } from "./theme";
import { UndoToast } from "./undo";

/** The sun / moon button: switches between light and dark mode. */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}

/** 🎨 button: opens a row of color presets, like Discord's theme colors. */
function AccentPicker() {
  const { accent, setAccent } = useAccent();
  const light = document.documentElement.dataset.theme === "light"; // read live, so it follows the sun / moon button
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="accent-menu" ref={ref}>
      <button
        className="theme-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change color"
        title="Change color"
        aria-haspopup="true"
        aria-expanded={open}
      >
        🎨
      </button>
      {open && (
        <div className="dropdown accent-dropdown">
          <div className="dropdown-head">Color</div>
          <div className="accent-swatches" role="radiogroup" aria-label="Color">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={accent === a.id}
                aria-label={a.label}
                title={a.label}
                className={`accent-swatch ${accent === a.id ? "on" : ""}`}
                style={{ background: light ? a.light : a.dark }}
                onClick={() => setAccent(a.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Strip under the top bar on every page. Remove it when the bot leaves beta. */
function BetaBanner() {
  return (
    <div className="beta-banner" role="note">
      <span className="beta-tag">BETA</span>
      <span>
        Number One is in open beta. Found a bug or have an idea?{" "}
        <a href={SUPPORT_SERVER} target="_blank" rel="noopener noreferrer">
          Tell us in the support server
        </a>
        .
      </span>
    </div>
  );
}

/** Shown on every page while the bot's developer has maintenance mode on. */
function MaintenanceBanner({ state }: { state: MaintenanceState | null }) {
  if (!state?.on) return null;
  return (
    <div className="maintenance-banner" role="status">
      <strong>🛠️ Under maintenance</strong>
      <span>
        {state.message || "Commands in Discord are paused for a little while."}
        {state.until ? ` Expected back ${new Date(state.until).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : ""}
      </span>
    </div>
  );
}

/** One entry in the top menu or the phone menu. External links open in a new tab. */
interface MenuItem {
  label: string;
  to: string;
  external?: boolean;
  /** Highlighted when the current address matches. */
  active?: boolean;
  /** Shows a small "unread" dot. */
  dot?: boolean;
  /** Top bar only on wide screens; always in the phone menu. */
  wideOnly?: boolean;
}

function MenuLink({ item, onPick }: { item: MenuItem; onPick?: () => void }) {
  if (item.external) {
    return (
      <a href={item.to} target="_blank" rel="noopener noreferrer" className={item.wideOnly ? "wide-only" : ""} onClick={onPick}>
        {item.label}
      </a>
    );
  }
  return (
    <a
      href={item.to}
      className={`${item.active ? "on" : ""} ${item.wideOnly ? "wide-only" : ""}`}
      aria-current={item.active ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // keep "open in new tab"
        e.preventDefault();
        onPick?.();
        navigate(item.to);
        window.scrollTo(0, 0);
      }}
    >
      {item.label}
      {item.dot && <span className="unread-dot" aria-label="(new)" />}
    </a>
  );
}

/** Closes a dropdown on Escape or a click outside it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** Avatar button that opens the account menu. */
function UserMenu({ user }: { user: DashboardUser }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const avatar = avatarUrl(user);
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {avatar ? <img src={avatar} alt="" /> : <span className="avatar-fallback">{user.username[0]}</span>}
        <span className="user-name">{user.username}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            Signed in as <strong>{user.username}</strong>
          </div>
          <MenuLink item={{ label: "🏠 Home", to: "/" }} onPick={close} />
          <MenuLink item={{ label: "📋 My servers", to: "/servers" }} onPick={close} />
          <MenuLink item={{ label: "📣 Announcements", to: "/announcements" }} onPick={close} />
          <div className="dropdown-sep" />
          <button
            className="dropdown-item danger"
            onClick={async () => {
              await api.logout().catch(() => {});
              window.location.href = "/";
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

/** ☰ button for phones: opens a menu with every link from the top bar plus the legal pages. */
function MobileMenu({ items, path }: { items: MenuItem[]; path: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  useEffect(close, [path]);
  const extra: MenuItem[] = [
    { label: "Terms of Service", to: "/terms", active: path === "/terms" },
    { label: "Privacy Policy", to: "/privacy", active: path === "/privacy" },
  ];
  return (
    <div className="mobile-menu" ref={ref}>
      <button className="mobile-menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
        {open ? "✕" : "☰"}
        {!open && items.some((i) => i.dot) && <span className="unread-dot" />}
      </button>
      {open && (
        <nav className="dropdown mobile-dropdown" aria-label="Menu">
          {items.map((i) => (
            <MenuLink key={i.to} item={{ ...i, wideOnly: false }} onPick={close} />
          ))}
          <div className="dropdown-sep" />
          {extra.map((i) => (
            <MenuLink key={i.to} item={i} onPick={close} />
          ))}
        </nav>
      )}
    </div>
  );
}

export function App() {
  const path = usePath();
  const [user, setUser] = useState<DashboardUser | null | undefined>(undefined); // undefined = still checking
  const [clientId, setClientId] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const hasUnread = useHasUnread();

  useEffect(() => {
    // Any failure (usually "not logged in") shows the landing page.
    api.me().then(setUser).catch(() => setUser(null));
    const loadConfig = () =>
      api
        .config()
        .then((c) => {
          setClientId(c.clientId);
          setMaintenance(c.maintenance ?? null);
        })
        .catch(() => {});
    void loadConfig();
    // Check again now and then, so the maintenance notice appears and goes away without a reload.
    const t = setInterval(loadConfig, 60_000);
    return () => clearInterval(t);
  }, []);

  if (user === undefined) {
    return (
      <div className="app">
        <header className="topbar">
          <span className="brand">
            <img className="brand-mark" src="/logo.png" alt="" width={28} height={28} /> <span className="brand-name">Number One</span>
          </span>
          <AccentPicker />
          <ThemeToggle />
        </header>
        <BetaBanner />
        <MaintenanceBanner state={maintenance} />
        <main className="content center muted">Loading…</main>
        <Footer />
      </div>
    );
  }

  const guildMatch = path.match(/^\/servers\/(\d+)(?:\/([\w-]+))?/);
  const docsMatch = path.match(/^\/docs(?:\/([\w-]*))?\/?$/);
  const devMatch = path.match(/^\/developer(?:\/([\w-]*))?\/?$/);
  // Every page is rendered inside the layout below (top bar, page, footer). Add new pages to this list.
  let page;
  if (path === "/terms") page = <TermsPage />; // public: readable without logging in
  else if (path === "/privacy") page = <PrivacyPage />; // public too
  else if (path === "/announcements") page = <AnnouncementsPage />; // public too
  else if (docsMatch) page = <DocsPage slug={docsMatch[1] ?? ""} />; // public too
  else if (!user) page = <LandingPage />;
  else if (devMatch) page = user.isDeveloper ? <DeveloperPage section={devMatch[1] ?? ""} /> : <HomePage user={user} />; // the bot's developer only
  else if (guildMatch) page = <GuildPage guildId={guildMatch[1]} page={guildMatch[2] ?? ""} />;
  else if (path.startsWith("/servers")) page = <ServersPage />;
  else page = <HomePage user={user} />;

  // The main menu. Logged-in users get their pages; visitors get the public ones.
  const items: MenuItem[] = [
    ...(user
      ? [
          { label: "Home", to: "/", active: path === "/" },
          { label: "My servers", to: "/servers", active: path.startsWith("/servers") },
        ]
      : []),
    { label: "Docs", to: "/docs", active: Boolean(docsMatch) },
    { label: "Announcements", to: "/announcements", active: path === "/announcements", dot: hasUnread },
    ...(clientId ? [{ label: "Add bot", to: inviteUrl(clientId), external: true }] : []),
    { label: "Support", to: SUPPORT_SERVER, external: true, wideOnly: true },
    ...(user?.isDeveloper ? [{ label: "Developer", to: "/developer", active: Boolean(devMatch) }] : []),
  ];

  return (
    <div className="app">
      <header className="topbar">
        <MobileMenu items={items} path={path} />
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <img className="brand-mark" src="/logo.png" alt="" width={28} height={28} /> <span className="brand-name">Number One</span>
        </a>
        <nav className="topnav" aria-label="Main menu">
          {items.map((i) => (
            <MenuLink key={i.to} item={i} />
          ))}
        </nav>
        <AccentPicker />
        <ThemeToggle />
        {user ? (
          <UserMenu user={user} />
        ) : (
          <a className="btn ghost small" href="/auth/login">
            Log in
          </a>
        )}
      </header>
      <BetaBanner />
        <MaintenanceBanner state={maintenance} />
      <main className={`content ${(user && (guildMatch || (devMatch && user.isDeveloper))) || docsMatch ? "wide" : ""}`}><Suspense fallback={<p className="muted">Loading…</p>}>{page}</Suspense></main>
      <UndoToast />
      <Footer />
    </div>
  );
}
