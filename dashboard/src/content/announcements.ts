/**
 * Number One update announcements, shown on the dashboard home and the Announcements page.
 *
 * To post an update: add an entry at the TOP of this list and commit. Newest first.
 * - id: unique and never reused (used to mark updates as read).
 * - date: YYYY-MM-DD.
 * - body: the same simple Markdown as the legal pages (paragraphs, "- " lists, **bold**, [links](...)).
 */
export type AnnouncementTag = "New" | "Improved" | "Fixed" | "Notice";

export interface Announcement {
  id: string;
  date: string;
  title: string;
  tag: AnnouncementTag;
  body: string;
}

export const announcements: Announcement[] = [
  {
    id: "2026-11-02-tickets",
    date: "2026-11-02",
    title: "Tickets",
    tag: "New",
    body: `Members can now open private tickets with your staff.

- **Ticket panels:** post a message with buttons or a dropdown, with up to 10 ticket types.
- **Optional question:** ask members what they need before the ticket opens.
- **Claim and close:** staff claim tickets, add people with **/ticket add**, and close with a transcript in your log channel.`,
  },
  {
    id: "2026-11-02-home-dashboard",
    date: "2026-11-02",
    title: "New home dashboard and announcements",
    tag: "New",
    body: `The dashboard now opens on a home page with your servers, quick links and the latest updates.

- **Announcements:** a page listing every Number One update. A dot in the menu shows unread updates.
- **Menus:** a full menu on phones, and an account menu under your avatar.`,
  },
  {
    id: "2026-11-02-dashboard-quality",
    date: "2026-11-02",
    title: "Light mode and Undo",
    tag: "Improved",
    body: `- **Light mode:** switch with the sun / moon button in the top menu.
- **Undo:** every settings save shows a timed Undo button.
- **Top menu:** stays at the top while you scroll.`,
  },
  {
    id: "2026-11-02-logging-commands",
    date: "2026-11-02",
    title: "Logging, custom commands and rule verification",
    tag: "New",
    body: `- **Logging:** message, member, server and voice logs.
- **Custom commands:** server-only slash commands with text or embed replies, plus **/rule** to post a rule.
- **Rule verification:** members accept the rules before getting access.
- **Cosmetics:** channel designs.`,
  },
  {
    id: "2026-11-02-events-embeds",
    date: "2026-11-02",
    title: "Events, embeds and server announcements",
    tag: "New",
    body: `- **Events:** RSVP buttons, reminders and auto-end.
- **Embed messages** and **Announcements** are now separate features.
- **Join & leave messages** moved out of onboarding into their own feature.`,
  },
  {
    id: "2026-11-02-protection",
    date: "2026-11-02",
    title: "Anti-raid and anti-spam",
    tag: "New",
    body: `- **Anti-raid:** join-wave detection, raid mode lockdown, a new-account filter and **/raidmode**.
- **Anti-spam:** message rate, cross-channel posting, attachment and link floods.`,
  },
  {
    id: "2026-11-01-moderation",
    date: "2026-11-01",
    title: "Moderation and auto-moderation",
    tag: "New",
    body: `- **Moderation:** warn, timeout, kick, ban, unban, purge and cases.
- **Auto-moderation:** word, invite, link, mention, caps, emoji, zalgo and repeat filters.`,
  },
];

/** The newest announcement, or undefined if there are none. */
export const latestAnnouncement = announcements[0];
