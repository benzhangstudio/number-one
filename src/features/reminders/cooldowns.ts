import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, type GuildTextBasedChannel, type MessageComponentInteraction, MessageFlags, PermissionFlagsBits } from "discord.js";
import { sqlite } from "../../server/db/client.js";
import type { ComponentHandler } from "../../server/bot/types.js";

/**
 * Cooldown reminders: members can ask to be @mentioned when /daily or /work is ready again.
 * It's opt-in per member and per command, with the 🔔 button under those replies. Once on, every claim queues
 * a reminder in the channel they used the command in (or a DM if the bot can't post there). Saved in the
 * database, so reminders survive restarts.
 */

export interface ReminderKind {
  /** What to type, e.g. "/daily". */
  command: string;
  /** What's ready, e.g. "daily reward". */
  what: string;
  /** Whether this server allows these reminders right now (feature on, reminders switched on). */
  allowed: (guildId: string) => Promise<boolean>;
}

const kinds = new Map<string, ReminderKind>();
const PREFIX = "cdr";
const log = (...args: unknown[]) => console.warn("[reminders]", ...args);

/** Each feature registers the commands it offers reminders for. */
export const registerReminderKind = (kind: string, info: ReminderKind) => kinds.set(kind, info);

const sql = {
  get: "SELECT always FROM cooldown_reminders WHERE guild_id = ? AND user_id = ? AND kind = ?",
  set: `INSERT INTO cooldown_reminders (guild_id, user_id, kind, always, channel_id, due_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, kind) DO UPDATE SET always = excluded.always, channel_id = excluded.channel_id, due_at = excluded.due_at`,
  queue: "UPDATE cooldown_reminders SET channel_id = ?, due_at = ? WHERE guild_id = ? AND user_id = ? AND kind = ? AND always = 1",
  due: "SELECT guild_id, user_id, kind, channel_id FROM cooldown_reminders WHERE due_at IS NOT NULL AND due_at <= ? LIMIT 50",
  clear: "UPDATE cooldown_reminders SET due_at = NULL WHERE guild_id = ? AND user_id = ? AND kind = ?",
  off: "UPDATE cooldown_reminders SET always = 0, due_at = NULL WHERE guild_id = ? AND user_id = ? AND kind = ?",
};
const q = (key: keyof typeof sql) => sqlite.prepare(sql[key]);

export const remindersOn = (guildId: string, userId: string, kind: string) =>
  Boolean((q("get").get(guildId, userId, kind) as { always: number } | undefined)?.always);

/**
 * Call after a successful claim. If the member has reminders on, queues the next one for `readyAt`.
 * Returns the 🔔/🔕 button row to put under the reply, or [] when this server doesn't allow reminders.
 */
export async function afterClaim(guildId: string, userId: string, kind: string, channelId: string, readyAt: number) {
  const info = kinds.get(kind);
  if (!info || !(await info.allowed(guildId))) return [];
  q("queue").run(channelId, readyAt, guildId, userId, kind);
  return [toggleRow(userId, kind, remindersOn(guildId, userId, kind), readyAt)];
}

function toggleRow(userId: string, kind: string, on: boolean, readyAt: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:toggle:${userId}:${kind}:${readyAt}`)
      .setEmoji(on ? "🔕" : "🔔")
      .setLabel(on ? "Stop reminders" : "Remind me when it's ready")
      .setStyle(ButtonStyle.Secondary),
  );
}

export const reminderButtons: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, action, userId, kind, readyAtText] = interaction.customId.split(":");
    const info = kinds.get(kind);
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: `Use \`${info?.command ?? "the command"}\` yourself to get your own reminders.`, flags: MessageFlags.Ephemeral });
    }
    if (action === "stop") {
      q("off").run(interaction.guildId, userId, kind);
      return interaction.update({ components: [] }).then(() =>
        interaction.followUp({ content: `🔕 No more reminders for \`${info?.command}\`. Turn them back on with the 🔔 button next time you use it.`, flags: MessageFlags.Ephemeral }),
      );
    }
    // toggle
    const readyAt = Number(readyAtText) || 0;
    const on = !remindersOn(interaction.guildId, userId, kind);
    if (on && info && !(await info.allowed(interaction.guildId))) {
      return interaction.reply({ content: "Reminders are switched off in this server.", flags: MessageFlags.Ephemeral });
    }
    q("set").run(interaction.guildId, userId, kind, on ? 1 : 0, interaction.channelId, on && readyAt > Date.now() ? readyAt : null);
    await interaction.update({ components: [toggleRow(userId, kind, on, readyAt)] });
    const when = readyAt > Date.now() ? ` <t:${Math.ceil(readyAt / 1000)}:R>` : "";
    return interaction.followUp({
      content: on
        ? `🔔 I'll mention you here when \`${info?.command}\` is ready${when}, and every time after that. Press 🔕 to stop.`
        : `🔕 Reminders for \`${info?.command}\` are off.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

function canPost(channel: GuildTextBasedChannel) {
  const me = channel.guild.members.me;
  return Boolean(me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]));
}

/** Sends every reminder that's due. Runs every 30 seconds. */
async function sendDue(client: Client) {
  const due = q("due").all(Date.now()) as { guild_id: string; user_id: string; kind: string; channel_id: string | null }[];
  for (const r of due) {
    q("clear").run(r.guild_id, r.user_id, r.kind); // first, so a slow send never sends twice
    const info = kinds.get(r.kind);
    const guild = client.guilds.cache.get(r.guild_id);
    if (!info || !guild || !(await info.allowed(r.guild_id).catch(() => false))) continue;
    const content = `🔔 <@${r.user_id}>, your ${info.what} is ready! Use \`${info.command}\`.`;
    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:stop:${r.user_id}:${r.kind}`).setEmoji("🔕").setLabel("Stop these").setStyle(ButtonStyle.Secondary),
      ),
    ];
    const channel = r.channel_id ? guild.channels.cache.get(r.channel_id) : null;
    try {
      if (channel?.isTextBased() && canPost(channel as GuildTextBasedChannel)) {
        await (channel as GuildTextBasedChannel).send({ content, components, allowedMentions: { users: [r.user_id] } });
      } else {
        const member = await guild.members.fetch(r.user_id).catch(() => null);
        await member?.send({ content: `${content} (in **${guild.name}**)` }).catch(() => {});
      }
    } catch (err) {
      log(`couldn't send a reminder in ${r.guild_id}:`, (err as Error).message);
    }
  }
}

let started = false;
export function startReminders(client: Client) {
  if (started) return;
  started = true;
  setInterval(() => void sendDue(client).catch((err) => log("check failed:", err)), 30_000).unref();
}
