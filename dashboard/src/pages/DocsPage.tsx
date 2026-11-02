import { useEffect, useMemo, useState } from "react";
import { headings, Markdown } from "../components/Markdown";
import { PageLink } from "../components/PageLink";
import { docGroups, docPages, docSourceUrl, findDoc } from "../content/docs";

/**
 * The docs, laid out like GitHub's: pages down the left, the page in the middle, and
 * "On this page" on the right with a link to every heading. Public: no login needed.
 * `slug` is the part after /docs/, or "" for /docs itself (the first page).
 */
export function DocsPage({ slug }: { slug: string }) {
  const page = slug ? findDoc(slug) : docPages[0];
  const toc = useMemo(() => (page ? headings(page.source) : []), [page]);
  const active = useActiveHeading(toc.map((h) => h.id));
  const [filter, setFilter] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
    document.title = page ? `${page.title} · Number One Docs` : "Number One Docs";
    // Links like /docs/moderation#cases: jump to the heading once the page has rendered.
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => {
      document.title = "Number One";
    };
  }, [page]);

  const q = filter.trim().toLowerCase();
  const groups = q
    ? docGroups
        .map((g) => ({
          ...g,
          pages: g.pages.filter(
            (p) => p.title.toLowerCase().includes(q) || headings(p.source).some((h) => h.text.toLowerCase().includes(q)),
          ),
        }))
        .filter((g) => g.pages.length)
    : docGroups;

  const index = page ? docPages.indexOf(page) : -1;
  const prev = index > 0 ? docPages[index - 1] : null;
  const next = index >= 0 && index < docPages.length - 1 ? docPages[index + 1] : null;

  return (
    <div className="docs">
      <aside className={`docs-nav ${navOpen ? "open" : ""}`} aria-label="Docs pages">
        <button className="docs-nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen}>
          <span>☰ {page?.title ?? "Docs"}</span>
          <span aria-hidden>{navOpen ? "▴" : "▾"}</span>
        </button>
        <div className="docs-nav-list">
          <input
            type="search"
            className="docs-filter"
            placeholder="Filter pages…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter pages"
          />
          {groups.map((g) => (
            <div key={g.name} className="docs-group">
              <div className="docs-group-name">{g.name}</div>
              {g.pages.map((p) => (
                <span key={p.slug} className={p === page ? "docs-link on" : "docs-link"}>
                  <PageLink to={`/docs/${p.slug}`}>{p.title}</PageLink>
                </span>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="muted small">No pages match.</p>}
        </div>
      </aside>

      <article className="docs-body">
        {page ? (
          <>
            <div className="docs-crumbs muted small">
              <PageLink to="/docs">Docs</PageLink> / {page.group}
            </div>
            <Markdown source={page.source} anchors />
            <div className="docs-pager">
              {prev ? (
                <PageLink to={`/docs/${prev.slug}`}>
                  <small className="muted">← Previous</small>
                  <span>{prev.title}</span>
                </PageLink>
              ) : (
                <span />
              )}
              {next && (
                <PageLink to={`/docs/${next.slug}`}>
                  <small className="muted">Next →</small>
                  <span>{next.title}</span>
                </PageLink>
              )}
            </div>
            <p className="docs-edit small">
              <a href={docSourceUrl(page.slug)} target="_blank" rel="noopener noreferrer">
                View this page on GitHub
              </a>
            </p>
          </>
        ) : (
          <>
            <h1>Page not found</h1>
            <p>
              There's no docs page called “{slug}”. <PageLink to="/docs">Go to the docs home</PageLink>.
            </p>
          </>
        )}
      </article>

      {toc.length > 0 && (
        <nav className="docs-toc" aria-label="On this page">
          <div className="docs-group-name">On this page</div>
          {toc.map((h) => (
            <a key={h.id} href={`#${h.id}`} className={`level-${h.level} ${h.id === active ? "on" : ""}`}>
              {h.text}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

/** The heading the reader is currently looking at: the last one that has scrolled past the top bar. */
function useActiveHeading(ids: string[]) {
  const [active, setActive] = useState("");
  const key = ids.join(" ");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 52;
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top + 24) current = id;
      }
      // At the very bottom, the last heading may never reach the top: mark it anyway.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = ids[ids.length - 1] ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}
