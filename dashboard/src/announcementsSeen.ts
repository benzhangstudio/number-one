import { useEffect, useState } from "react";
import { latestAnnouncement } from "./content/announcements";

/** Remembers (in this browser) the newest announcement the user has seen, for the "unread" dot. */
const KEY = "number-one:announcements-seen";
const EVENT = "announcements:seen";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** True when there is an announcement newer than the last one this browser has seen. */
export function useHasUnread() {
  const [seen, setSeen] = useState(read);
  useEffect(() => {
    const update = () => setSeen(read());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return Boolean(latestAnnouncement && seen !== latestAnnouncement.id);
}

/** Marks every current announcement as read. */
export function markAnnouncementsSeen() {
  if (!latestAnnouncement) return;
  try {
    localStorage.setItem(KEY, latestAnnouncement.id);
  } catch {
    // Storage blocked: the dot just stays.
  }
  window.dispatchEvent(new Event(EVENT));
}
