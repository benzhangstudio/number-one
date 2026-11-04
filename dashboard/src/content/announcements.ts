/**
 * Number One update announcements, shown on the dashboard home and the Announcements page.
 *
 * To post an update: add an entry at the TOP of this list and commit. Newest first.
 * - id: unique and never reused (used to mark updates as read).
 * - date: YYYY-MM-DD.
 * - emoji: one emoji shown in the little bubble next to it.
 * - body: the same simple Markdown as the legal pages (paragraphs, "- " lists, **bold**, [links](...)).
 *   Keep it short: one line, then a few "- " points.
 */
export type AnnouncementTag = "New" | "Improved" | "Fixed" | "Notice";

export interface Announcement {
  id: string;
  date: string;
  title: string;
  tag: AnnouncementTag;
  emoji: string;
  body: string;
}

export const announcements: Announcement[] = [
  {
    id: "2026-11-03-channel-designs",
    date: "2026-11-03",
    title: "Text-only channel names and a new design",
    tag: "Improved",
    emoji: "🦋",
    body: `Two changes in **Cosmetics → Channel designs**.

- **Make names text-only:** takes every emoji and decoration out of your channel names, even ones added by hand or by another bot, so a new design starts clean.
- **Butterfly wings:** a new design, like \`ʚ💬ɞgeneral\`. It replaces Bows. If you used Bows, click **Apply design** once to switch.`,
  },
  {
    id: "2026-11-03-maintenance",
    date: "2026-11-03",
    title: "Maintenance notices",
    tag: "Notice",
    emoji: "🛠️",
    body: `When Number One is being updated, you'll now know.

- Commands reply with a short **under maintenance** note, and the dashboard shows a yellow notice with when it's expected back.
- Auto-moderation, logs and XP keep working the whole time.
- Pick a channel in **Other → Number One updates** to hear about maintenance before it starts.`,
  },
  {
    id: "2026-11-03-economy-shop",
    date: "2026-11-03",
    title: "Shop and games",
    tag: "New",
    emoji: "🛍️",
    body: `Your server's money finally has something to spend on. Find it in **Economy**.

- **Shop:** sell roles and fun items. Members use **/shop**, **/buy** and **/inventory**.
- **Games:** **/coinflip**, **/slots** and **/blackjack**, with the bet limits you choose.`,
  },
  {
    id: "2026-11-03-polls",
    date: "2026-11-03",
    title: "Polls",
    tag: "New",
    emoji: "📊",
    body: `Ask your server anything with up to 10 answers.

- Members vote with buttons and see **live results**.
- One answer or several, anonymous or public, and results hidden until the end if you like.
- Make them on the dashboard or with **/poll create**. The winner is posted when it ends.`,
  },
  {
    id: "2026-11-03-community-tools",
    date: "2026-11-03",
    title: "Community tools",
    tag: "New",
    emoji: "🏡",
    body: `Set up Discord's Community features from the dashboard, under **Community Settings**.

- Switch Community on or off, and make announcement channels.
- Edit your **Welcome Screen** and **Discord onboarding** without digging through Server Settings.`,
  },
  {
    id: "2026-11-03-economy",
    date: "2026-11-03",
    title: "Economy",
    tag: "New",
    emoji: "🪙",
    body: `Your server's own currency. Name it anything, like 💎 gems or 🌸 petals.

- Members earn it by chatting, with **/daily** (with streaks) and **/work**, and when they level up.
- Send it with **/pay** and compare with **/richest**.`,
  },
  {
    id: "2026-11-02-levels",
    date: "2026-11-02",
    title: "Levels",
    tag: "New",
    emoji: "🏆",
    body: `Members earn XP by chatting and level up.

- **/rank** shows a picture rank card, and **/leaderboard** shows the top members.
- Give **reward roles** at the levels you pick.`,
  },
  {
    id: "2026-11-02-staff-applications",
    date: "2026-11-02",
    title: "Staff applications",
    tag: "New",
    emoji: "📝",
    body: `Let members apply to join your team, with your own questions.

- Applications arrive in a staff channel to claim, accept or deny.
- Accepting gives the roles straight away.`,
  },
  {
    id: "2026-11-02-bot-updates",
    date: "2026-11-02",
    title: "Number One updates in your server",
    tag: "New",
    emoji: "📬",
    body: `Get news about Number One (new features, fixes and downtime) in a channel you choose.

- Set it up in **Other → Number One updates**, with an optional role to mention.`,
  },
  {
    id: "2026-11-02-look",
    date: "2026-11-02",
    title: "Colour presets and a new logo",
    tag: "Improved",
    emoji: "🎨",
    body: `- **Colour presets:** pick the dashboard's colour with the 🎨 button in the top menu.
- **New logo** across the dashboard.`,
  },
  {
    id: "2026-11-02-ticket-forms",
    date: "2026-11-02",
    title: "Ticket starter forms",
    tag: "Improved",
    emoji: "🧾",
    body: `Each ticket type can now have a **starter form** with up to 5 questions.

- The opener is mentioned with a **Fill in the form** button, and their answers are posted in the ticket.
- **Lock until sent:** the opener can't type until they send the form. Staff always can.
- Answers show on the dashboard and in transcripts.`,
  },
  {
    id: "2026-11-02-guides",
    date: "2026-11-02",
    title: "Server and staff guides",
    tag: "New",
    emoji: "📖",
    body: `Post a **Server guide** for members and a **Staff guide** for your team, each in the channel you pick. Find them in **Cosmetics → Guides**.

- **Easy to read:** a contents message at the top links straight to every section.
- **Easy to move around:** each section has Contents and Next buttons.
- **Ready-made text:** both guides start filled in, so you only edit what's different.`,
  },
  {
    id: "2026-11-02-tickets",
    date: "2026-11-02",
    title: "Tickets",
    tag: "New",
    emoji: "🎫",
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
    emoji: "🏠",
    body: `The dashboard now opens on a home page with your servers, quick links and the latest updates.

- **Announcements:** a page listing every Number One update. A dot in the menu shows unread updates.
- **Menus:** a full menu on phones, and an account menu under your avatar.`,
  },
  {
    id: "2026-11-02-dashboard-quality",
    date: "2026-11-02",
    title: "Light mode and Undo",
    tag: "Improved",
    emoji: "🌙",
    body: `- **Light mode:** switch with the sun / moon button in the top menu.
- **Undo:** every settings save shows a timed Undo button.
- **Top menu:** stays at the top while you scroll.`,
  },
  {
    id: "2026-11-02-logging-commands",
    date: "2026-11-02",
    title: "Logging, custom commands and rule verification",
    tag: "New",
    emoji: "📋",
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
    emoji: "📅",
    body: `- **Events:** RSVP buttons, reminders and auto-end.
- **Embed messages** and **Announcements** are now separate features.
- **Join & leave messages** moved out of onboarding into their own feature.`,
  },
  {
    id: "2026-11-02-protection",
    date: "2026-11-02",
    title: "Anti-raid and anti-spam",
    tag: "New",
    emoji: "🛡️",
    body: `- **Anti-raid:** join-wave detection, raid mode lockdown, a new-account filter and **/raidmode**.
- **Anti-spam:** message rate, cross-channel posting, attachment and link floods.`,
  },
  {
    id: "2026-11-01-moderation",
    date: "2026-11-01",
    title: "Moderation and auto-moderation",
    tag: "New",
    emoji: "🔨",
    body: `- **Moderation:** warn, timeout, kick, ban, unban, purge and cases.
- **Auto-moderation:** word, invite, link, mention, caps, emoji, zalgo and repeat filters.`,
  },
];

/** The newest announcement, or undefined if there are none. */
export const latestAnnouncement = announcements[0];
