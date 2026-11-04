import { useEffect, useState } from "react";
import { markAnnouncementsSeen } from "../announcementsSeen";
import { Markdown } from "../components/Markdown";
import { type Announcement, type AnnouncementTag, announcements } from "../content/announcements";

const tags: AnnouncementTag[] = ["New", "Improved", "Fixed", "Notice"];

/** "2026-11-02" → "2 Nov 2026" (read as a calendar date, so time zones never shift it a day). */
export function formatDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** One update as a list row: an emoji bubble, the title with its tag, and the text. */
export function AnnouncementItem({ item, compact = false, showDate = false }: { item: Announcement; compact?: boolean; showDate?: boolean }) {
  return (
    <li className={`ann-item ${compact ? "compact" : ""}`} id={item.id}>
      <span className="ann-bubble" aria-hidden="true">
        {item.emoji}
      </span>
      <div className="ann-content">
        <div className="ann-title-row">
          <h3>{item.title}</h3>
          <span className={`announcement-tag tag-${item.tag.toLowerCase()}`}>{item.tag}</span>
          {showDate && (
            <time className="ann-date" dateTime={item.date}>
              {formatDate(item.date)}
            </time>
          )}
        </div>
        <div className="announcement-body">
          <Markdown source={item.body} />
        </div>
      </div>
    </li>
  );
}

/** A short list of updates (home and landing pages), each with its date. */
export function AnnouncementList({ items }: { items: Announcement[] }) {
  return (
    <ul className="ann-list compact">
      {items.map((a) => (
        <AnnouncementItem key={a.id} item={a} compact showDate />
      ))}
    </ul>
  );
}

/** /announcements: every Number One update, newest first, grouped by day, with a filter by type. Public. */
export function AnnouncementsPage() {
  const [filter, setFilter] = useState<AnnouncementTag | "All">("All");

  useEffect(() => {
    markAnnouncementsSeen();
  }, []);

  const shown = filter === "All" ? announcements : announcements.filter((a) => a.tag === filter);
  const used = tags.filter((t) => announcements.some((a) => a.tag === t));
  const days: { date: string; items: Announcement[] }[] = [];
  for (const a of shown) {
    const day = days.at(-1);
    if (day?.date === a.date) day.items.push(a);
    else days.push({ date: a.date, items: [a] });
  }

  return (
    <section className="announcements-page">
      <h1>Announcements</h1>
      <p className="muted">New features, improvements and fixes to Number One.</p>
      {used.length > 1 && (
        <div className="ann-filters" role="group" aria-label="Filter announcements">
          {(["All", ...used] as const).map((t) => (
            <button key={t} className={`ann-filter ${filter === t ? "on" : ""}`} onClick={() => setFilter(t)} aria-pressed={filter === t}>
              {t}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="muted">No announcements yet.</p>
      ) : (
        days.map((d) => (
          <section key={d.date} className="ann-day">
            <h2 className="ann-day-head">
              <span aria-hidden="true">✿</span>
              <time dateTime={d.date}>{formatDate(d.date)}</time>
            </h2>
            <ul className="ann-list">
              {d.items.map((a) => (
                <AnnouncementItem key={a.id} item={a} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
