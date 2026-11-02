import { z } from "zod";

/**
 * Guides: settings shared by the bot and the dashboard.
 * Each server has two guides, a Server guide for members and a Staff guide for the team. Admins pick the
 * channel for each, and Number One posts it there as plain messages anyone in that channel can read:
 * a contents message at the top that links to every section, then one message per section with links
 * back to the contents and on to the next section. Nothing to press to read it.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const guideKinds = ["server", "staff"] as const;
export type GuideKind = (typeof guideKinds)[number];

/** Each section is its own message, so this keeps posting quick and the contents list short. */
export const MAX_GUIDE_SECTIONS = 20;

export const guideSection = z.object({
  /** Short random ID, set by the dashboard. */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  title: z.string().trim().min(1, "Every section needs a title").max(100),
  emoji: z.string().trim().max(64).default(""),
  content: z.string().max(4000).default(""),
  image: link,
});
export type GuideSection = z.infer<typeof guideSection>;

const section = (id: string, emoji: string, title: string, content: string): GuideSection => ({ id, emoji, title, content, image: "" });

const guideShape = (defaults: { title: string; intro: string; color: string; sections: GuideSection[] }) =>
  z
    .object({
      /** Posted in the channel. Off = taken down (the text stays saved). */
      enabled: z.boolean().default(false),
      channelId: snowflake.nullable().default(null),
      /** The contents message at the top. */
      title: z.string().trim().max(256).default(defaults.title),
      intro: z.string().max(1500).default(defaults.intro),
      color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default(defaults.color),
      image: link,
      /** Under each section: "Back to contents" and "Next" link buttons. */
      navButtons: z.boolean().default(true),
      sections: z
        .array(guideSection)
        .min(1, "Add at least one section")
        .max(MAX_GUIDE_SECTIONS)
        .default(defaults.sections),
    })
    .superRefine((g, ctx) => {
      if (new Set(g.sections.map((s) => s.id)).size !== g.sections.length) {
        ctx.addIssue({ code: "custom", message: "Two sections have the same ID. Reload the page and try again." });
      }
      for (const s of g.sections) {
        if (!s.content.trim() && !s.image) ctx.addIssue({ code: "custom", message: `"${s.title}" is empty. Write something or add an image.` });
      }
      if (g.enabled && !g.channelId) ctx.addIssue({ code: "custom", message: "Pick a channel for the guide." });
    });

/** Ready-made text each guide starts with. Admins edit everything before posting. */
export const guideDefaults: Record<GuideKind, { title: string; intro: string; color: string; sections: GuideSection[] }> = {
  server: {
    title: "📖 Server guide",
    intro: "New here? Everything you need to know is below. Tap a section to jump straight to it.",
    color: "#ff4fa3",
    sections: [
      section("welcome", "👋", "Welcome", "Welcome to the server! We're glad you're here.\n\nThis is a friendly place to hang out, share and meet people. Take a minute to read the rules, then grab some roles."),
      section("rules", "📜", "Rules", "1. Be kind and respectful.\n2. No spam or self-promotion.\n3. Keep things safe for everyone.\n4. Follow Discord's Terms of Service.\n\nBreaking the rules can lead to a warning, timeout or ban."),
      section("roles", "🎭", "Roles", "Pick your own roles in the roles channel to unlock channels and get pinged for things you care about.\n\nStaff roles are shown at the top of the member list."),
      section("channels", "🗺️", "Channels", "**#general** — chat about anything\n**#announcements** — news from the team\n**#support** — open a ticket if you need help\n\nMention channels with # so readers can tap straight to them."),
      section("help", "🆘", "Getting help", "Need a hand or want to report something? Open a ticket in the support channel and a staff member will help you privately.\n\nYou can also ping a moderator in an emergency."),
    ],
  },
  staff: {
    title: "🛡️ Staff guide",
    intro: "Everything the team needs in one place. Tap a section to jump to it. Post this in a staff-only channel.",
    color: "#5865f2",
    sections: [
      section("team", "🤝", "Welcome to the team", "Thanks for helping run the server! Your job is to keep it friendly and safe, and to help members when they need it.\n\nWhen in doubt, ask in the staff channel before acting."),
      section("values", "💗", "How we moderate", "- Be fair and calm, even when others aren't.\n- Explain why, so members can do better.\n- Use the lightest action that works: talk → warn → timeout → kick → ban.\n- Never moderate a fight you're part of; hand it to someone else."),
      section("mod", "🔨", "Moderation commands", "**/warn** — give a warning (repeat warnings can trigger automatic steps)\n**/timeout** and **/untimeout** — mute someone for a while\n**/kick**, **/ban**, **/unban** — remove someone\n**/purge** — delete recent messages\n**/case** — look up or edit a past case\n\nEvery action gets a numbered case in the mod log."),
      section("tickets", "🎫", "Handling tickets", "1. Press **Claim** so others know you've got it.\n2. Be friendly and ask for details.\n3. Use **/ticket add** if someone else needs to see it.\n4. Press **Close** (or **/ticket close reason**) when it's sorted. A transcript is saved in the log channel."),
      section("escalate", "🚨", "When to escalate", "Hand things to a senior mod or admin when:\n- someone may be in danger\n- it involves a staff member\n- a raid is happening (admins can use **/raidmode on**)\n- you're unsure what to do\n\nWrite a short note of what happened and link the messages."),
    ],
  },
};

export const guideSettings = {
  server: guideShape(guideDefaults.server),
  staff: guideShape(guideDefaults.staff),
};
export type GuideSettings = z.infer<(typeof guideSettings)["server"]>;

export const guidesSettings = z.object({
  server: guideSettings.server.prefault({}),
  staff: guideSettings.staff.prefault({}),
});
export type GuidesSettings = z.infer<typeof guidesSettings>;

export const GUIDE_NAMES: Record<GuideKind, string> = { server: "Server guide", staff: "Staff guide" };

export interface GuidesResponse {
  settings: GuidesSettings;
  /** Link to each guide's contents message, if it's posted. */
  posted: Record<GuideKind, string | null>;
  problems: string[];
}
