import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { and, asc, count, desc, eq, isNotNull, lte } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { pollVotes, polls } from "../../server/db/schema.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { pollsFeature } from "../../shared/features.js";
import {
  MAX_OPEN_POLLS,
  MAX_POLL_HOURS,
  POLL_LIMITS,
  type PollInput,
  type PollSettings,
  type PollView,
  type PollVoterView,
  type PollsResponse,
  answerEmojis,
  pollDurationChoices,
  pollInput,
  pollSettings,
} from "../../shared/polls.js";

/**
 * Polls: a question with one button per answer and live results bars. Made on the dashboard or with /poll create.
 * A poll closes at its end time (checked every 20 seconds) or when staff end it, and Number One then replies
 * to it with the winner. Votes are stored one row per answer picked, so multiple-choice polls work the same way.
 */

type Row = typeof polls.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

/** A problem the person can fix, shown as-is. */
class PollError extends Error {}

const log = (...args: unknown[]) => console.warn("[polls]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);
const PREFIX = "poll";
const HISTORY = 20;
const HOUR = 3_600_000;
const BAR = 12;

const t = (ms: number, style: string) => `<t:${Math.floor(ms / 1000)}:${style}>`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------ reading rows */

function detailsOf(row: Row): PollInput {
  const parsed = pollInput.safeParse(row.details);
  if (parsed.success) return parsed.data;
  // Shouldn't happen; keep the poll readable with what's certain.
  return pollInput.parse({ channelId: row.channelId, question: "Poll", answers: ["Yes", "No"] });
}

const findRow = (guildId: string, id: number) =>
  db
    .select()
    .from(polls)
    .where(and(eq(polls.guildId, guildId), eq(polls.id, id)))
    .get();

const votesOf = (pollId: number) => db.select().from(pollVotes).where(eq(pollVotes.pollId, pollId)).orderBy(asc(pollVotes.votedAt)).all();
type Vote = Awaited<ReturnType<typeof votesOf>>[number];

function tally(d: PollInput, votes: Vote[]) {
  const counts = d.answers.map(() => 0);
  for (const v of votes) if (v.answer < counts.length) counts[v.answer]++;
  return { counts, voters: new Set(votes.map((v) => v.userId)).size };
}

const messageUrl = (r: Row) => (r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null);
const settingsOf = async (guildId: string) => (await getFeatureState(guildId, pollsFeature)).settings as PollSettings;

/* ------------------------------------------------------------ the poll post */

function pingText(d: PollInput) {
  if (d.ping.type === "everyone") return "@everyone";
  if (d.ping.type === "here") return "@here";
  if (d.ping.type === "roles") return d.ping.roleIds.map((id) => `<@&${id}>`).join(" ");
  return "";
}

function bar(share: number) {
  const filled = Math.round(share * BAR);
  return `${"█".repeat(filled)}${"░".repeat(BAR - filled)}`;
}

function names(ids: string[], limit: number) {
  let text = "";
  for (let i = 0; i < ids.length; i++) {
    const next = `${text ? ", " : ""}<@${ids[i]}>`;
    if (text.length + next.length > limit - 12) return `${text} +${ids.length - i} more`;
    text += next;
  }
  return text;
}

/** The winning answers (more than one on a tie), or none when nobody voted. */
function winners(d: PollInput, counts: number[]) {
  const top = Math.max(0, ...counts);
  return top === 0 ? [] : d.answers.map((a, i) => ({ answer: a, i })).filter(({ i }) => counts[i] === top);
}

function buildPost(row: Row, votes: Vote[], withPing: boolean) {
  const d = detailsOf(row);
  const ended = row.status === "ended";
  const { counts, voters } = tally(d, votes);
  const total = counts.reduce((a, b) => a + b, 0);
  const showResults = ended || !d.hideResults;
  const best = ended ? new Set(winners(d, counts).map((w) => w.i)) : new Set<number>();
  // Discord allows 4096 characters in the description; share what's left between the answers' voter lists.
  const perAnswer = Math.floor((3600 - d.description.length) / d.answers.length);

  const lines = d.answers.map((answer, i) => {
    const head = `${answerEmojis[i]} **${answer}**${best.has(i) ? " 🏆" : ""}`;
    if (!showResults) return head;
    const share = total ? counts[i] / total : 0;
    let text = `${head}\n\`${bar(share)}\` ${Math.round(share * 100)}% · ${plural(counts[i], "vote")}`;
    if (!d.anonymous && counts[i]) {
      text += `\n-# ${names(votes.filter((v) => v.answer === i).map((v) => v.userId), Math.max(60, perAnswer - 120))}`;
    }
    return text;
  });

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x8c8c99 : Number.parseInt(d.color.slice(1), 16))
    .setTitle(`${ended ? "Ended: " : "📊 "}${d.question}`.slice(0, 256))
    .setDescription([d.description.trim(), lines.join("\n\n")].filter(Boolean).join("\n\n").slice(0, 4096));

  const facts = [plural(voters, "voter"), d.multiple ? "Pick as many as you like" : "Pick one", d.anonymous ? "Anonymous" : "Votes are public"];
  if (ended) embed.addFields({ name: "🕒 Ended", value: t(Date.now(), "f") });
  else if (row.endsAt) embed.addFields({ name: "🕒 Ends", value: `${t(row.endsAt.getTime(), "R")} (${t(row.endsAt.getTime(), "f")})` });
  if (d.voterRoleIds.length && !ended) embed.addFields({ name: "🔒 Who can vote", value: d.voterRoleIds.map((id) => `<@&${id}>`).join(" ") });
  embed.setFooter({
    text: [...facts, ended ? "This poll has ended." : showResults ? "Press a button to vote." : "Results show when the poll ends."].join(" · "),
  });

  const components = ended
    ? []
    : Array.from({ length: Math.ceil(d.answers.length / 5) }, (_, r) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          d.answers.slice(r * 5, r * 5 + 5).map((answer, j) =>
            new ButtonBuilder()
              .setCustomId(`${PREFIX}:v:${row.id}:${r * 5 + j}`)
              .setLabel(answer.slice(0, POLL_LIMITS.answer))
              .setEmoji(answerEmojis[r * 5 + j])
              .setStyle(ButtonStyle.Secondary),
          ),
        ),
      );

  const ping = withPing ? pingText(d) : "";
  return {
    content: ping,
    embeds: [embed],
    components,
    allowedMentions: !ping ? { parse: [] } : d.ping.type === "roles" ? { parse: [], roles: d.ping.roleIds } : { parse: ["everyone" as const] },
  };
}

/** Votes for one poll are saved one at a time, so quick presses don't overwrite each other. */
const locks = new Map<number, Promise<unknown>>();
function inOrder<T>(pollId: number, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(pollId) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  locks.set(pollId, tail);
  void tail.finally(() => {
    if (locks.get(pollId) === tail) locks.delete(pollId);
  });
  return run;
}

async function editPost(row: Row) {
  if (!row.messageId) return;
  const channel = client.guilds.cache.get(row.guildId)?.channels.cache.get(row.channelId);
  if (!channel?.isTextBased()) return;
  const post = buildPost(row, await votesOf(row.id), false);
  await channel.messages.edit(row.messageId, post).catch((err: Error) => log(`couldn't update poll #${row.id}:`, err.message));
}

/**
 * Busy polls get many votes a second, and Discord limits how often a message can be edited.
 * So the post is brought up to date at most once every 2 seconds, with the latest votes.
 */
const pending = new Map<number, NodeJS.Timeout>();
function refreshSoon(pollId: number) {
  if (pending.has(pollId)) return;
  pending.set(
    pollId,
    setTimeout(async () => {
      pending.delete(pollId);
      const row = await db.select().from(polls).where(eq(polls.id, pollId)).get();
      if (row) await editPost(row);
    }, 2000),
  );
}

/* ------------------------------------------------------------ checks */

const isStaff = (member: GuildMember | null | undefined) =>
  Boolean(member?.permissions.has(PermissionFlagsBits.ManageMessages) || member?.permissions.has(PermissionFlagsBits.ManageGuild));

function canCreate(member: GuildMember, s: PollSettings) {
  if (isStaff(member)) return true;
  if (s.creators === "everyone") return true;
  if (s.creators === "roles") return s.creatorRoleIds.some((id) => member.roles.cache.has(id));
  return false;
}

function whoCanCreate(s: PollSettings) {
  if (s.creators === "everyone") return "everyone";
  if (s.creators === "roles" && s.creatorRoleIds.length) return `staff and ${s.creatorRoleIds.map((id) => `<@&${id}>`).join(", ")}`;
  return "staff (people with Manage Messages)";
}

/** Checks the poll can be posted. `member` is who's posting it. Throws a PollError. */
async function checkInput(guild: Guild, member: GuildMember, d: PollInput) {
  const channel = guild.channels.cache.get(d.channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new PollError("That channel no longer exists. Pick another one.");
  const me = guild.members.me;
  const mine = me ? channel.permissionsFor(me) : null;
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ];
  const pings = d.ping.type === "everyone" || d.ping.type === "here" || (d.ping.type === "roles" && d.ping.roleIds.some((id) => !guild.roles.cache.get(id)?.mentionable));
  if (pings) needed.push([PermissionFlagsBits.MentionEveryone, "Mention @everyone, @here and All Roles"]);
  const missing = needed.filter(([flag]) => !mine?.has(flag)).map(([, name]) => name);
  if (missing.length) throw new PollError(`In #${channel.name} I need: ${missing.join(", ")}.`);

  const theirs = channel.permissionsFor(member);
  if (!theirs.has(PermissionFlagsBits.ViewChannel) || !theirs.has(channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages)) {
    throw new PollError(`You can't post in #${channel.name} yourself, so I can't post there for you.`);
  }
  if (pings && !theirs.has(PermissionFlagsBits.MentionEveryone)) throw new PollError("You don't have permission to use that ping.");
  if (d.ping.type === "roles") {
    if (!d.ping.roleIds.length) throw new PollError("Pick at least one role to ping, or choose another ping.");
    if (d.ping.roleIds.some((id) => !guild.roles.cache.has(id) || id === guild.id)) throw new PollError("One of the roles to ping no longer exists.");
  }
  d.voterRoleIds = d.voterRoleIds.filter((id) => guild.roles.cache.has(id));

  const open = (await db.select({ n: count() }).from(polls).where(and(eq(polls.guildId, guild.id), eq(polls.status, "open"))).get())?.n ?? 0;
  if (open >= MAX_OPEN_POLLS) throw new PollError(`This server already has ${MAX_OPEN_POLLS} open polls. End one first.`);
}

/* ------------------------------------------------------------ actions */

async function toView(row: Row): Promise<PollView> {
  const d = detailsOf(row);
  return {
    ...d,
    id: row.id,
    status: row.status,
    url: messageUrl(row),
    endsAt: row.endsAt?.getTime() ?? null,
    ...tally(d, await votesOf(row.id)),
    createdByTag: row.createdByTag,
    createdAt: row.createdAt.getTime(),
  };
}

async function insertRow(guild: Guild, member: GuildMember, d: PollInput) {
  const [row] = await db
    .insert(polls)
    .values({
      guildId: guild.id,
      channelId: d.channelId,
      details: d,
      endsAt: d.hours ? new Date(Date.now() + d.hours * HOUR) : null,
      createdBy: member.id,
      createdByTag: member.user.tag,
      createdAt: new Date(),
    })
    .returning()
    .all();
  return row;
}

/** Makes and posts a poll in its channel. Throws a PollError. */
async function create(guild: Guild, userId: string, d: PollInput) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new PollError("You're no longer a member of this server.");
  await checkInput(guild, member, d);
  const row = await insertRow(guild, member, d);
  const channel = guild.channels.cache.get(d.channelId) as GuildTextBasedChannel;
  const sent = await channel.send(buildPost(row, [], true)).catch(async (err: Error) => {
    await db.delete(polls).where(eq(polls.id, row.id)).run();
    throw new PollError(`Discord didn't accept the poll: ${err.message}`);
  });
  await db.update(polls).set({ messageId: sent.id }).where(eq(polls.id, row.id)).run();
  return toView({ ...row, messageId: sent.id });
}

/** Closes a poll: final results on the post, buttons removed, and (if switched on) a reply with the winner. */
async function endPoll(row: Row, endedBy: string | null) {
  if (row.status !== "open") return row;
  await db.update(polls).set({ status: "ended" }).where(eq(polls.id, row.id)).run();
  const ended: Row = { ...row, status: "ended" };
  clearTimeout(pending.get(row.id));
  pending.delete(row.id);
  await inOrder(row.id, () => editPost(ended));

  const s = await settingsOf(row.guildId);
  const channel = client.guilds.cache.get(row.guildId)?.channels.cache.get(row.channelId);
  if (s.announceResults && row.messageId && channel?.isTextBased()) {
    const d = detailsOf(row);
    const { counts, voters } = tally(d, await votesOf(row.id));
    const top = winners(d, counts);
    const result = !top.length
      ? "Nobody voted."
      : top.length === 1
        ? `🏆 **${top[0].answer}** won with ${plural(counts[top[0].i], "vote")}.`
        : `🤝 It's a tie between ${top.map((w) => `**${w.answer}**`).join(" and ")}, with ${plural(counts[top[0].i], "vote")} each.`;
    const by = endedBy ? ` Ended by <@${endedBy}>.` : "";
    await channel
      .send({
        content: `📊 The poll **${d.question.slice(0, 200)}** has ended. ${result} (${plural(voters, "voter")})${by}`,
        reply: { messageReference: row.messageId, failIfNotExists: false },
        allowedMentions: { parse: [] },
      })
      .catch((err: Error) => log(`couldn't post the result of poll #${row.id}:`, err.message));
  }
  return ended;
}

async function remove(guild: Guild, id: number) {
  const row = await findRow(guild.id, id);
  if (!row) return;
  const channel = guild.channels.cache.get(row.channelId);
  if (channel?.isTextBased() && row.messageId) await channel.messages.delete(row.messageId).catch(() => {});
  await db.delete(pollVotes).where(eq(pollVotes.pollId, id)).run();
  await db.delete(polls).where(eq(polls.id, id)).run();
}

async function voterList(guild: Guild, id: number): Promise<PollVoterView[]> {
  const row = await findRow(guild.id, id);
  if (!row) throw new PollError("That poll isn't saved anymore. Reload the page.");
  if (detailsOf(row).anonymous) throw new PollError("This poll is anonymous, so who voted for what isn't shown.");
  const votes = await votesOf(id);
  const byUser = new Map<string, number[]>();
  for (const v of votes) byUser.set(v.userId, [...(byUser.get(v.userId) ?? []), v.answer]);
  const members = byUser.size ? await guild.members.fetch({ user: [...byUser.keys()] }).catch(() => null) : null;
  return [...byUser].map(([userId, answers]) => {
    const m = members?.get(userId);
    return { userId, name: m?.displayName ?? m?.user.username ?? "Left the server", answers: answers.sort((a, b) => a - b) };
  });
}

async function overview(guild: Guild): Promise<PollsResponse> {
  const [open, past] = await Promise.all([
    db.select().from(polls).where(and(eq(polls.guildId, guild.id), eq(polls.status, "open"))).orderBy(desc(polls.createdAt)).all(),
    db.select().from(polls).where(and(eq(polls.guildId, guild.id), eq(polls.status, "ended"))).orderBy(desc(polls.createdAt)).limit(HISTORY).all(),
  ]);
  return { settings: await settingsOf(guild.id), polls: await Promise.all([...open, ...past].map(toView)), problems: [] };
}

/* ------------------------------------------------------------ voting */

const voteButtons: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, kind, idText, answerText] = interaction.customId.split(":");
    const id = Number(idText);
    const answer = Number(answerText);
    if (kind !== "v" || !Number.isInteger(id) || !Number.isInteger(answer)) return;
    // Voting is a member's own action, like a role menu click, so these notes are just for them.
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

    if (!(await isFeatureEnabled(interaction.guildId, pollsFeature))) return privately("Polls are turned off in this server right now.");
    const row = await findRow(interaction.guildId, id);
    if (!row) return privately("This poll isn't available anymore.");
    if (row.status !== "open" || (row.endsAt && row.endsAt.getTime() <= Date.now())) return privately("This poll has ended.");
    const d = detailsOf(row);
    if (answer < 0 || answer >= d.answers.length) return;
    if (d.voterRoleIds.length && !d.voterRoleIds.some((r) => interaction.member.roles.cache.has(r))) {
      return privately(`Only members with ${d.voterRoleIds.map((r) => `<@&${r}>`).join(" or ")} can vote in this poll.`);
    }

    const userId = interaction.user.id;
    const mine = await inOrder(id, async () => {
      const current = (await votesOf(id)).filter((v) => v.userId === userId).map((v) => v.answer);
      const has = current.includes(answer);
      const where = and(eq(pollVotes.pollId, id), eq(pollVotes.userId, userId));
      if (has) {
        // Pressing an answer you picked takes that vote back.
        await db.delete(pollVotes).where(and(where, eq(pollVotes.answer, answer))).run();
      } else {
        if (!d.multiple) await db.delete(pollVotes).where(where).run();
        await db.insert(pollVotes).values({ pollId: id, guildId: row.guildId, userId, answer, votedAt: new Date() }).onConflictDoNothing().run();
      }
      return has ? current.filter((a) => a !== answer) : d.multiple ? [...current, answer] : [answer];
    });
    refreshSoon(id);

    const picked = mine.sort((a, b) => a - b).map((a) => `${answerEmojis[a]} **${d.answers[a]}**`);
    const later = d.hideResults ? " Results show when the poll ends." : "";
    if (!picked.length) return privately(`You took your vote back.${later}`);
    return privately(`${picked.length === 1 ? "Your vote" : "Your votes"}: ${picked.join(", ")}.${d.multiple ? " Press another answer to add it, or the same one to take it back." : " Press it again to take it back."}${later}`);
  },
};

/* ------------------------------------------------------------ slash commands */

/** Answers typed in one box: "Pizza | Tacos | Sushi", or with commas when there's no "|". */
function splitAnswers(text: string) {
  const parts = text.includes("|") ? text.split("|") : text.split(",");
  return parts.map((p) => p.trim()).filter(Boolean);
}

function inputError(err: { issues: { path: PropertyKey[]; message: string }[] }) {
  const issue = err.issues[0];
  return issue ? issue.message : "Check the poll and try again.";
}

const pollCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Make a poll, or end one.")
    .setContexts(0)
    .addSubcommand((c) =>
      c
        .setName("create")
        .setDescription("Post a poll with answer buttons and live results")
        .addStringOption((o) => o.setName("question").setDescription("What are you asking?").setRequired(true).setMaxLength(POLL_LIMITS.question))
        .addStringOption((o) =>
          o.setName("answers").setDescription('2 to 10 answers, split with | (like "Pizza | Tacos | Sushi")').setRequired(true).setMaxLength(1000),
        )
        .addIntegerOption((o) =>
          o
            .setName("duration")
            .setDescription("How long it stays open (the server's default if empty)")
            .addChoices(...pollDurationChoices.map((c) => ({ name: c.label, value: c.hours }))),
        )
        .addBooleanOption((o) => o.setName("multiple").setDescription("Let members pick more than one answer (default: no)"))
        .addBooleanOption((o) => o.setName("anonymous").setDescription("Hide who voted for what (default: yes)"))
        .addBooleanOption((o) => o.setName("hide_results").setDescription("Hide the results until the poll ends (default: no)"))
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Where to post it (this channel if empty)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("end")
        .setDescription("End an open poll now and post the result")
        .addIntegerOption((o) => o.setName("poll").setDescription("Which poll").setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(interaction) {
    if (!interaction.inCachedGuild()) return interaction.respond([]);
    const typed = String(interaction.options.getFocused()).toLowerCase();
    const staff = isStaff(interaction.member);
    const open = await db
      .select()
      .from(polls)
      .where(and(eq(polls.guildId, interaction.guildId), eq(polls.status, "open")))
      .orderBy(desc(polls.createdAt))
      .all();
    const choices = open
      .filter((r) => staff || r.createdBy === interaction.user.id)
      .map((r) => ({ name: `#${r.id} · ${detailsOf(r).question}`.slice(0, 100), value: r.id }))
      .filter((c) => c.name.toLowerCase().includes(typed))
      .slice(0, 25);
    return interaction.respond(choices);
  },

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const guild = interaction.guild;
    const s = await settingsOf(guild.id);

    if (interaction.options.getSubcommand() === "end") {
      const row = await findRow(guild.id, interaction.options.getInteger("poll", true));
      if (!row) return interaction.reply("I couldn't find that poll. Pick one from the list.");
      if (row.status !== "open") return interaction.reply("That poll has already ended.");
      if (row.createdBy !== interaction.user.id && !isStaff(interaction.member)) {
        return interaction.reply("Only the person who made this poll, or staff with Manage Messages, can end it.");
      }
      await interaction.deferReply();
      await endPoll(row, interaction.user.id);
      const link = messageUrl(row);
      return interaction.editReply({ content: `Poll ended.${link ? ` ${link}` : ""}`, allowedMentions: { parse: [] } });
    }

    if (!canCreate(interaction.member, s)) {
      return interaction.reply({ content: `In this server, polls can be made by ${whoCanCreate(s)}.`, allowedMentions: { parse: [] } });
    }
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!channel) return interaction.reply("I can't post in this channel.");
    const parsed = pollInput.safeParse({
      channelId: channel.id,
      question: interaction.options.getString("question", true),
      answers: splitAnswers(interaction.options.getString("answers", true)),
      hours: interaction.options.getInteger("duration") ?? s.defaultHours,
      multiple: interaction.options.getBoolean("multiple") ?? false,
      anonymous: interaction.options.getBoolean("anonymous") ?? true,
      hideResults: interaction.options.getBoolean("hide_results") ?? false,
    });
    if (!parsed.success) return interaction.reply(`${inputError(parsed.error)}. Split answers with |, like \`Pizza | Tacos | Sushi\`.`);

    try {
      const view = await create(guild, interaction.user.id, parsed.data);
      if (channel.id === interaction.channelId) {
        return interaction.reply({ content: "📊 Poll posted.", flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `📊 Poll posted in <#${channel.id}>: ${view.url ?? ""}`, allowedMentions: { parse: [] } });
    } catch (err) {
      if (err instanceof PollError) return interaction.reply({ content: err.message, allowedMentions: { parse: [] } });
      throw err;
    }
  },
};

/* ------------------------------------------------------------ timers and clean-up */

let ticking = false;

/** Ends polls whose time is up. */
export async function checkPolls() {
  if (ticking) return;
  ticking = true;
  try {
    const due = await db
      .select()
      .from(polls)
      .where(and(eq(polls.status, "open"), isNotNull(polls.endsAt), lte(polls.endsAt, new Date())))
      .all();
    for (const row of due) await endPoll(row, null);
  } catch (err) {
    log("checking polls failed:", err);
  } finally {
    ticking = false;
  }
}

/** The poll post was deleted in Discord: nobody can vote anymore, so the poll ends quietly. */
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (!message.guildId) return;
  await db.update(polls).set({ messageId: null, status: "ended" }).where(eq(polls.messageId, message.id)).run();
});

/* ------------------------------------------------------------ dashboard */

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PollError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new PollError(issue ? `${issue.path.length ? `${issue.path.join(" → ")}: ` : ""}${issue.message}` : "Check the form and try again.");
}

const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
const idOf = (request: Req) => Number(request.params.id);

export const pollsBot: BotFeature = {
  info: pollsFeature,
  commands: [pollCommand],
  components: [voteButtons],
  events: [messageDeleted],

  setup() {
    setInterval(() => void checkPolls(), 20_000).unref();
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/polls", async (request: Req) => overview(guildOf(request)));

    api.put("/api/guilds/:guildId/polls/settings", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const s = parse(pollSettings, request.body);
        s.creatorRoleIds = s.creatorRoleIds.filter((id) => guild.roles.cache.has(id));
        s.defaultHours = Math.min(s.defaultHours, MAX_POLL_HOURS);
        const state = await getFeatureState(guild.id, pollsFeature);
        await saveFeatureState(guild.id, pollsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
        return overview(guild);
      }),
    );

    api.post("/api/guilds/:guildId/polls", (request: Req, reply) =>
      guarded(reply, () => create(guildOf(request), request.session!.userId, parse(pollInput, request.body))),
    );

    api.get("/api/guilds/:guildId/polls/:id/voters", (request: Req, reply) => guarded(reply, () => voterList(guildOf(request), idOf(request))));

    api.post("/api/guilds/:guildId/polls/:id/end", (request: Req, reply) =>
      guarded(reply, async () => {
        const row = await findRow(request.params.guildId, idOf(request));
        if (!row) throw new PollError("That poll isn't saved anymore. Reload the page.");
        if (row.status !== "open") throw new PollError("This poll has already ended.");
        return toView(await endPoll(row, request.session!.userId));
      }),
    );

    api.delete("/api/guilds/:guildId/polls/:id", async (request: Req) => {
      await remove(guildOf(request), idOf(request));
      return { ok: true };
    });
  },
};
