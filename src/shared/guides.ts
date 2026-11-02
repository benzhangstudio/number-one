import { z } from "zod";

/**
 * Server guides: shapes shared by the bot and the dashboard.
 * A guide is a little book of embed pages (e.g. a server guide for members, a staff handbook).
 * Number One posts a cover with the table of contents. Readers open pages privately and move with
 * Back / Next, a "Jump to" menu, and buttons that link related pages.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Links must start with https://")
  .default("");

export const MAX_GUIDES = 10;
/** A dropdown holds 25 choices, so a guide can have up to 25 pages. */
export const MAX_GUIDE_PAGES = 25;
/** Related-page buttons under a page (one row, leaving room for a web link). */
export const MAX_PAGE_LINKS = 4;
export const MAX_GUIDE_ROLES = 10;

export const guidePage = z.object({
  /** Short random ID, set by the dashboard. Links and buttons use it, so it never changes. */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  title: z.string().trim().min(1, "Every page needs a title").max(100),
  emoji: z.string().trim().max(64).default(""),
  content: z.string().max(4000).default(""),
  image: link,
  /** Other pages in this guide shown as buttons under this one. */
  links: z.array(z.string()).max(MAX_PAGE_LINKS).default([]),
  /** An optional web link button. */
  linkUrl: link,
  linkLabel: z.string().trim().max(80).default(""),
});
export type GuidePage = z.infer<typeof guidePage>;

export const guideInput = z
  .object({
    channelId: snowflake,
    /** Shown on the dashboard and in each page's footer. */
    name: z.string().trim().min(1, "Give the guide a name").max(60),
    /** "everyone" = anyone can read it. "staff" = only the roles below (and people with Manage Server). */
    audience: z.enum(["everyone", "staff"]).default("everyone"),
    roleIds: z.array(snowflake).max(MAX_GUIDE_ROLES).default([]),
    /** The cover. */
    title: z.string().trim().max(256).default("📖 Server guide"),
    intro: z.string().max(3000).default(""),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
    image: link,
    /** List the pages on the cover. */
    showContents: z.boolean().default(true),
    pages: z.array(guidePage).min(1, "Add at least one page").max(MAX_GUIDE_PAGES),
  })
  .superRefine((g, ctx) => {
    const ids = new Set(g.pages.map((p) => p.id));
    if (ids.size !== g.pages.length) ctx.addIssue({ code: "custom", message: "Two pages have the same ID. Reload the page and try again." });
    for (const p of g.pages) {
      if (p.links.some((id) => !ids.has(id) || id === p.id)) {
        ctx.addIssue({ code: "custom", message: `"${p.title}" links to a page that isn't in this guide.` });
      }
      if (p.linkUrl && !p.linkLabel) ctx.addIssue({ code: "custom", message: `"${p.title}": give the web link a button label.` });
      if (!p.content.trim() && !p.image) ctx.addIssue({ code: "custom", message: `"${p.title}" is empty. Write something or add an image.` });
    }
    if (g.audience === "staff" && !g.roleIds.length) {
      ctx.addIssue({ code: "custom", message: "Pick the staff roles that can read this guide." });
    }
  });
export type GuideInput = z.infer<typeof guideInput>;

export interface GuideView extends GuideInput {
  id: number;
  /** Link to the posted cover, or null when it isn't up. */
  messageUrl: string | null;
  /** Times a page was opened. */
  views: number;
}

export interface GuidesResponse {
  guides: GuideView[];
  problems: string[];
}

/* ------------------------------------------------------------ starting templates */

const page = (id: string, emoji: string, title: string, content: string, links: string[] = []): GuidePage => ({
  id,
  emoji,
  title,
  content,
  image: "",
  links,
  linkUrl: "",
  linkLabel: "",
});

/** Ready-made guides to start from. Admins edit everything before posting. */
export const guideTemplates: { id: string; name: string; description: string; guide: Omit<GuideInput, "channelId" | "roleIds"> }[] = [
  {
    id: "server",
    name: "Server guide",
    description: "For members: welcome, rules, roles, channels and where to get help.",
    guide: {
      name: "Server guide",
      audience: "everyone",
      title: "📖 Server guide",
      intro: "New here? This guide covers everything you need. Press **Start reading** or jump straight to a page. Only you see the pages you open.",
      color: "#ff4fa3",
      image: "",
      showContents: true,
      pages: [
        page("welcome", "👋", "Welcome", "Welcome to the server! We're glad you're here.\n\nThis is a friendly place to hang out, share and meet people. Take a minute to read the rules, then grab some roles.", ["rules", "roles"]),
        page("rules", "📜", "Rules", "1. Be kind and respectful.\n2. No spam or self-promotion.\n3. Keep things safe for everyone.\n4. Follow Discord's Terms of Service.\n\nBreaking the rules can lead to a warning, timeout or ban.", ["help"]),
        page("roles", "🎭", "Roles", "Pick your own roles in the roles channel to unlock channels and get pinged for things you care about.\n\nStaff roles are shown at the top of the member list.", ["channels"]),
        page("channels", "🗺️", "Channels", "**#general** — chat about anything\n**#announcements** — news from the team\n**#support** — open a ticket if you need help\n\nMention channels with # so readers can click straight to them.", ["help"]),
        page("help", "🆘", "Getting help", "Need a hand or want to report something? Open a ticket in the support channel and a staff member will help you privately.\n\nYou can also ping a moderator in an emergency.", ["rules"]),
      ],
    },
  },
  {
    id: "staff",
    name: "Staff guide",
    description: "For your team: how to moderate, handle tickets and when to escalate. Staff roles only.",
    guide: {
      name: "Staff guide",
      audience: "staff",
      title: "🛡️ Staff handbook",
      intro: "Everything the team needs in one place. Only staff can open these pages, and only you see what you open.",
      color: "#5865f2",
      image: "",
      showContents: true,
      pages: [
        page("team", "🤝", "Welcome to the team", "Thanks for helping run the server! Your job is to keep it friendly and safe, and to help members when they need it.\n\nWhen in doubt, ask in the staff channel before acting.", ["mod", "values"]),
        page("values", "💗", "How we moderate", "- Be fair and calm, even when others aren't.\n- Explain why, so members can do better.\n- Use the lightest action that works: talk → warn → timeout → kick → ban.\n- Never moderate a fight you're part of; hand it to someone else.", ["mod"]),
        page("mod", "🔨", "Moderation commands", "**/warn** — give a warning (repeat warnings can trigger automatic steps)\n**/timeout** and **/untimeout** — mute someone for a while\n**/kick**, **/ban**, **/unban** — remove someone\n**/purge** — delete recent messages\n**/case** — look up or edit a past case\n\nEvery action gets a numbered case in the mod log.", ["escalate"]),
        page("tickets", "🎫", "Handling tickets", "1. Press **Claim** so others know you've got it.\n2. Be friendly and ask for details.\n3. Use **/ticket add** if someone else needs to see it.\n4. Press **Close** (or **/ticket close reason**) when it's sorted. A transcript is saved in the log channel.", ["escalate"]),
        page("escalate", "🚨", "When to escalate", "Hand things to a senior mod or admin when:\n- someone may be in danger\n- it involves a staff member\n- a raid is happening (admins can use **/raidmode on**)\n- you're unsure what to do\n\nWrite a short note of what happened and link the messages.", ["team"]),
      ],
    },
  },
];
