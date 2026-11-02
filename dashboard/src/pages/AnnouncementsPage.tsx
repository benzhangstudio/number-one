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

/** One update: date, tag, title and text. Used here and on the home dashboard. */
export function AnnouncementCard({ item, compact = false }: { item: Announcement; compact?: boolean }) {
  return (
    <article className={`announcement card ${compact ? "compact" : ""}`} id={item.id}>
      <div className="announcement-meta">
        <span className={`announcement-tag tag-${item.tag.toLowerCase()}`}>{item.tag}</span>
        <time dateTime={item.date}>{formatDate(item.date)}</time>
      </div>
      <h3>{item.title}</h3>
      <div className="announcement-body">
        <Markdown source={item.body} />
      </div>
    </article>
  );
}

/** /announcements: every Number One update, newest first, with a filter by type. Public. */
export function AnnouncementsPage() {
  const [filter, setFilter] = useState<AnnouncementTag | "All">("All");

  useEffect(() => {
    markAnnouncementsSeen();
  }, []);

  const shown = filter === "All" ? announcements : announcements.filter((a) => a.tag === filter);
  const used = tags.filter((t) => announcements.some((a) => a.tag === t));

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
        <div className="announcement-list">
          {shown.map((a) => (
            <AnnouncementCard key={a.id} item={a} />
          ))}
        </div>
      )}
    </section>
  );
}
