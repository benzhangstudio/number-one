/**
 * The docs at /docs. Each page is a Markdown file in this folder, named after its URL:
 * moderation.md is /docs/moderation. Its first "# " line is its title.
 * To add a page, add the file and put its name in a group below.
 */
const files = import.meta.glob("./*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const groups: { name: string; pages: string[] }[] = [
  { name: "Start here", pages: ["getting-started", "dashboard", "commands"] },
  { name: "🛡️ Moderation & Safety", pages: ["moderation", "automod", "anti-raid"] },
  { name: "👥 Community Settings", pages: ["join-leave", "rule-verification", "onboarding", "staff-applications"] },
  { name: "🎭 Roles Management", pages: ["reaction-roles"] },
  { name: "📋 Logging & Auditing", pages: ["message-logs", "member-logs", "server-logs", "voice-logs"] },
  { name: "🎉 Engagement & Fun", pages: ["events"] },
  { name: "🛠️ Utilities & Automation", pages: ["embeds", "announcements", "custom-commands", "tickets"] },
  { name: "🎨 Cosmetics", pages: ["channel-designs", "guides"] },
  { name: "🧩 Other", pages: ["bot-updates"] },
  { name: "Help", pages: ["permissions", "troubleshooting"] },
];

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  source: string;
}

export const docGroups: { name: string; pages: DocPage[] }[] = groups.map((g) => ({
  name: g.name,
  pages: g.pages.map((slug) => {
    const source = files[`./${slug}.md`];
    if (source === undefined) throw new Error(`docs: ${slug}.md is listed but missing`);
    const title = source.match(/^# (.+)$/m)?.[1] ?? slug;
    return { slug, title, group: g.name, source };
  }),
}));

/** Every page in sidebar order, for previous/next links. */
export const docPages: DocPage[] = docGroups.flatMap((g) => g.pages);

export const findDoc = (slug: string) => docPages.find((p) => p.slug === slug);

/** Where each page lives in the repository, for "Edit this page". */
export const docSourceUrl = (slug: string) =>
  `https://github.com/benzhangstudio/number-one/blob/main/dashboard/src/content/docs/${slug}.md`;
