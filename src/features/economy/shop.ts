import { type AutocompleteInteraction, type ChatInputCommandInteraction, EmbedBuilder, type Guild, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import type { SlashCommand } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { economyShopItems } from "../../server/db/schema.js";
import { getFeatureState } from "../../server/settings.js";
import { type EconomySettings, SHOP_LIMITS, type ShopItemInput, type ShopItemView, formatMoney, shopItemInput } from "../../shared/economy.js";
import { economyFeature } from "../../shared/features.js";
import * as store from "./store.js";

/**
 * The shop: admins set up items on the dashboard (optionally giving a role), members browse with /shop,
 * buy with /buy and see what they own with /inventory. Staff mark items as used with /economy take-item.
 */

type Item = typeof economyShopItems.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

const PINK = 0xff4fa3;
const PAGE_SIZE = 8;

class ShopError extends Error {}

const settingsOf = async (guildId: string) => (await getFeatureState(guildId, economyFeature)).settings as EconomySettings;
const itemsOf = (guildId: string) =>
  db.select().from(economyShopItems).where(eq(economyShopItems.guildId, guildId)).orderBy(asc(economyShopItems.position), asc(economyShopItems.id)).all();
const findItem = (guildId: string, id: number) =>
  db
    .select()
    .from(economyShopItems)
    .where(and(eq(economyShopItems.guildId, guildId), eq(economyShopItems.id, id)))
    .get();

const n = (x: number) => x.toLocaleString("en-US");
const label = (item: Pick<Item, "emoji" | "name">) => `${item.emoji ? `${item.emoji} ` : ""}${item.name}`;
/** Custom emoji can't show in autocomplete suggestions, so they're left out there. */
const plainLabel = (item: Pick<Item, "emoji" | "name">) => (/^<a?:\w+:\d+>$/.test(item.emoji) ? item.name : label(item));

const toView = (i: Item): ShopItemView => ({
  id: i.id,
  name: i.name,
  description: i.description,
  emoji: i.emoji,
  price: i.price,
  roleId: i.roleId,
  stock: i.stock,
  maxPerMember: i.maxPerMember,
  hidden: i.hidden,
  sold: i.sold,
});

/** Why Number One can't give a role, in plain words, or null when it can. */
export function roleProblem(guild: Guild, roleId: string) {
  const role = guild.roles.cache.get(roleId);
  if (!role || role.id === guild.id) return "That role no longer exists.";
  if (role.managed) return `@${role.name} belongs to a bot or integration, so nobody can be given it.`;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "I need the Manage Roles permission to give roles from the shop.";
  if (!role.editable) return `@${role.name} is above my highest role. Move my role above it in Server Settings → Roles.`;
  return null;
}

/** Problems with the shop for the dashboard, in plain words. */
export async function shopProblems(guild: Guild) {
  const problems = new Set<string>();
  for (const item of await itemsOf(guild.id)) {
    if (!item.roleId || item.hidden) continue;
    const p = roleProblem(guild, item.roleId);
    if (p) problems.add(`Shop item "${item.name}": ${p}`);
  }
  return [...problems];
}

export const shopItemsView = async (guildId: string) => (await itemsOf(guildId)).map(toView);

/* ------------------------------------------------------------ suggestions */

async function suggestItems(interaction: AutocompleteInteraction, filter: (i: Item) => boolean) {
  if (!interaction.inCachedGuild()) return interaction.respond([]);
  const s = await settingsOf(interaction.guildId);
  const typed = String(interaction.options.getFocused()).toLowerCase();
  const items = (await itemsOf(interaction.guildId)).filter(filter).filter((i) => i.name.toLowerCase().includes(typed));
  return interaction.respond(
    items.slice(0, 25).map((i) => ({ name: `${plainLabel(i)} · ${n(i.price)} ${i.price === 1 ? s.currency.singular : s.currency.plural}`.slice(0, 100), value: i.id })),
  );
}

/* ------------------------------------------------------------ commands */

const shopOff = "The shop is switched off in this server.";

export const shopCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("See what you can buy with the server's money.")
    .setContexts(0)
    .addIntegerOption((o) => o.setName("page").setDescription(`Which page (${PAGE_SIZE} items each)`).setMinValue(1)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!s.shop.enabled) return interaction.reply(shopOff);
    const items = (await itemsOf(interaction.guildId)).filter((i) => !i.hidden);
    if (!items.length) return interaction.reply("The shop is empty right now. Staff can add items on the dashboard.");
    const pages = Math.ceil(items.length / PAGE_SIZE);
    const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
    const lines = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((i) => {
      const extras = [
        i.roleId ? `Gives <@&${i.roleId}>` : "",
        i.stock !== null ? (i.stock === 0 ? "**Sold out**" : `${n(i.stock)} left`) : "",
        !i.roleId && i.maxPerMember !== null ? `Up to ${n(i.maxPerMember)} each` : "",
      ].filter(Boolean);
      return [`**${label(i)}** · ${formatMoney(s.currency, i.price)}`, i.description, extras.length ? `-# ${extras.join(" · ")}` : ""].filter(Boolean).join("\n");
    });
    const balance = store.peek(interaction.guildId, interaction.user.id, s.startingBalance).balance;
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setTitle(`🛍️ ${interaction.guild.name} shop`.slice(0, 256))
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `Buy with /buy · You have ${n(balance)} ${balance === 1 ? s.currency.singular : s.currency.plural} · Page ${page} of ${pages}` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const buyCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy something from the shop.")
    .setContexts(0)
    .addIntegerOption((o) => o.setName("item").setDescription("What to buy").setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName("quantity").setDescription("How many (1 if empty)").setMinValue(1).setMaxValue(SHOP_LIMITS.quantity)),
  autocomplete: (interaction) => suggestItems(interaction, (i) => !i.hidden),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!s.shop.enabled) return interaction.reply(shopOff);
    const item = await findItem(interaction.guildId, interaction.options.getInteger("item", true));
    if (!item || item.hidden) return interaction.reply("I couldn't find that item. Pick one from the list, or see `/shop`.");
    const quantity = item.roleId ? 1 : (interaction.options.getInteger("quantity") ?? 1);
    const member = interaction.member;

    if (item.roleId) {
      if (member.roles.cache.has(item.roleId)) return interaction.reply({ content: `You already have <@&${item.roleId}>.`, allowedMentions: { parse: [] } });
      const problem = roleProblem(interaction.guild, item.roleId);
      if (problem) return interaction.reply(`This item can't be bought right now: ${problem} Let the staff know.`);
    }

    const r = store.buy(interaction.guildId, member.id, item.id, quantity, s.startingBalance);
    if (!r.ok) {
      const text = {
        gone: "That item isn't for sale anymore.",
        broke: `You don't have enough. It costs ${formatMoney(s.currency, item.price * quantity)} and you have ${formatMoney(s.currency, r.balance)}.`,
        stock: r.left ? `Only ${n(r.left)} left.` : `**${label(item)}** is sold out.`,
        limit: r.left ? `You can only buy ${n(r.left)} more.` : `You already have as many as you're allowed.`,
      }[r.reason];
      return interaction.reply({ content: text, allowedMentions: { parse: [] } });
    }

    if (item.roleId) {
      const given = await member.roles.add(item.roleId, `Bought "${item.name}" in the shop`).then(
        () => true,
        () => false,
      );
      if (!given) {
        const balance = store.refundPurchase(interaction.guildId, member.id, item.id, quantity, r.cost, s.startingBalance);
        return interaction.reply({
          content: `Discord didn't let me give you <@&${item.roleId}>, so you got your money back. Let the staff know.\n-# Balance: ${formatMoney(s.currency, balance, false)}`,
          allowedMentions: { parse: [] },
        });
      }
    }

    const what = quantity > 1 ? `${n(quantity)}× **${label(item)}**` : `**${label(item)}**`;
    const role = item.roleId ? ` You now have <@&${item.roleId}>.` : "";
    return interaction.reply({
      content: `🛍️ <@${member.id}> bought ${what} for ${formatMoney(s.currency, r.cost)}.${role}\n-# Balance: ${formatMoney(s.currency, r.balance, false)}`,
      allowedMentions: { parse: [] },
    });
  },
};

export const inventoryCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Show what you (or someone else) bought from the shop.")
    .setContexts(0)
    .addUserOption((o) => o.setName("member").setDescription("Whose inventory (yours, if empty)")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!s.shop.enabled) return interaction.reply(shopOff);
    const user = interaction.options.getUser("member") ?? interaction.user;
    if (user.bot) return interaction.reply("Bots don't have an inventory.");
    const owned = store.inventoryOf(interaction.guildId, user.id);
    const items = new Map((await itemsOf(interaction.guildId)).map((i) => [i.id, i]));
    const self = user.id === interaction.user.id;
    if (!owned.length) return interaction.reply({ content: self ? "You haven't bought anything yet. See `/shop`." : `<@${user.id}> hasn't bought anything yet.`, allowedMentions: { parse: [] } });
    const lines = owned.map((o) => {
      const item = items.get(o.itemId)!;
      return `**${label(item)}**${o.quantity > 1 ? ` ×${n(o.quantity)}` : ""}${item.roleId ? ` · <@&${item.roleId}>` : ""}`;
    });
    const member = interaction.options.getMember("member") ?? (self ? interaction.member : null);
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setAuthor({ name: `${member?.displayName ?? user.username}'s inventory`, iconURL: user.displayAvatarURL({ size: 128 }) })
      .setDescription(lines.join("\n").slice(0, 4096));
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

/* ------------------------------------------------------------ /economy take-item (staff) */

export const takeItemSuggestions = (interaction: AutocompleteInteraction) => suggestItems(interaction, () => true);

/** Staff take items back, like when a member uses a "custom nickname" item they bought. */
export async function takeItem(interaction: ChatInputCommandInteraction<"cached">) {
  const user = interaction.options.getUser("member", true);
  const item = await findItem(interaction.guildId, interaction.options.getInteger("item", true));
  if (!item) return interaction.reply("I couldn't find that item. Pick one from the list.");
  const quantity = interaction.options.getInteger("quantity") ?? 1;
  const r = store.takeOwned(interaction.guildId, user.id, item.id, quantity);
  if (!r.had) return interaction.reply({ content: `<@${user.id}> doesn't have **${label(item)}**.`, allowedMentions: { parse: [] } });
  let role = "";
  if (item.roleId && r.left === 0 && interaction.options.getMember("member")?.roles.cache.has(item.roleId)) {
    const removed = await interaction.options
      .getMember("member")!
      .roles.remove(item.roleId, `${interaction.user.tag} took back "${item.name}"`)
      .then(
        () => true,
        () => false,
      );
    role = removed ? ` and removed <@&${item.roleId}>` : `, but I couldn't remove <@&${item.roleId}>`;
  }
  return interaction.reply({
    content: `Took ${n(Math.min(quantity, r.had))}× **${label(item)}** from <@${user.id}>${role}. They have ${n(r.left)} left.`,
    allowedMentions: { parse: [] },
  });
}

/* ------------------------------------------------------------ dashboard */

function parseItem(body: unknown): ShopItemInput {
  const parsed = shopItemInput.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ShopError(issue ? issue.message : "Check the item and try again.");
}

function checkItem(guild: Guild, d: ShopItemInput) {
  if (d.roleId) {
    const problem = roleProblem(guild, d.roleId);
    if (problem) throw new ShopError(problem);
    d.maxPerMember = 1;
  }
}

export function registerShopApi(api: FastifyInstance, respond: (guild: Guild) => Promise<unknown>) {
  const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
  const guarded = async (reply: import("fastify").FastifyReply, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof ShopError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  };

  api.post("/api/guilds/:guildId/economy/shop", (request: Req, reply) =>
    guarded(reply, async () => {
      const guild = guildOf(request);
      const d = parseItem(request.body);
      checkItem(guild, d);
      const total = (await db.select({ n: count() }).from(economyShopItems).where(eq(economyShopItems.guildId, guild.id)).get())?.n ?? 0;
      if (total >= SHOP_LIMITS.items) throw new ShopError(`The shop can have up to ${SHOP_LIMITS.items} items. Delete one first.`);
      await db
        .insert(economyShopItems)
        .values({ guildId: guild.id, ...d, position: total, createdAt: new Date() })
        .run();
      return respond(guild);
    }),
  );

  api.put("/api/guilds/:guildId/economy/shop/:id", (request: Req, reply) =>
    guarded(reply, async () => {
      const guild = guildOf(request);
      const item = await findItem(guild.id, Number(request.params.id));
      if (!item) throw new ShopError("That item isn't saved anymore. Reload the page.");
      const d = parseItem(request.body);
      checkItem(guild, d);
      await db.update(economyShopItems).set(d).where(eq(economyShopItems.id, item.id)).run();
      return respond(guild);
    }),
  );

  /** Deleting an item also removes it from every inventory. Roles members already bought are kept. */
  api.delete("/api/guilds/:guildId/economy/shop/:id", async (request: Req) => {
    const guild = guildOf(request);
    await db
      .delete(economyShopItems)
      .where(and(eq(economyShopItems.guildId, guild.id), eq(economyShopItems.id, Number(request.params.id))))
      .run();
    return respond(guild);
  });
}
