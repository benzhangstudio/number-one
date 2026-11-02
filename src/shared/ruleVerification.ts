import { z } from "zod";

/**
 * Rule verification: settings shared by the bot and the dashboard.
 * Number One posts the server's rules with an "I agree" button. Agreeing gives a role (and can take
 * an "unverified" role away), so channels can be opened only to people who accepted the rules.
 * Works on its own, whether or not Member onboarding is on.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const verifyButtonStyles = ["success", "primary", "secondary", "danger"] as const;
export type VerifyButtonStyle = (typeof verifyButtonStyles)[number];

export const ruleVerificationSettings = z.object({
  /** Where the rules message is posted. */
  channelId: snowflake.nullable().default(null),
  title: z.string().trim().max(256).default("📜 Server rules"),
  rules: z.string().max(4000).default("1. Be kind and respectful.\n2. No spam or self-promotion.\n3. Keep things safe for everyone."),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
  image: link,
  buttonLabel: z.string().trim().min(1, "The button needs a label").max(80).default("I agree"),
  buttonEmoji: z.string().trim().max(8).default("✅"),
  buttonStyle: z.enum(verifyButtonStyles).default("success"),
  /** Given when someone agrees. */
  verifiedRoleId: snowflake.nullable().default(null),
  /** Taken away when someone agrees (e.g. "Unverified"). Optional. */
  unverifiedRoleId: snowflake.nullable().default(null),
  /** Give the unverified role to everyone who joins, so they only see what that role allows until they agree. */
  giveUnverifiedOnJoin: z.boolean().default(false),
  /** Shown only to the person who agreed. */
  successMessage: z.string().trim().max(500).default("✅ Thanks for agreeing to the rules. Welcome in!"),
});
export type RuleVerificationSettings = z.infer<typeof ruleVerificationSettings>;

export interface RuleVerificationResponse {
  settings: RuleVerificationSettings;
  /** Link to the posted rules message, if it's up. */
  messageUrl: string | null;
  /** Members holding the verified role right now. */
  verifiedCount: number | null;
  /** Members still holding the unverified role. */
  unverifiedCount: number | null;
  problems: string[];
}
