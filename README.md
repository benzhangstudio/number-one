# Number One

An all-in-one Discord server administration bot. Instead of juggling several small bots, server owners add Number One and switch on the features they want from a web dashboard.

The bot and its dashboard run together as **one program** on one Wispbyte server, sharing one database file.

## What's built so far

| Piece | Status |
| --- | --- |
| Bot core: slash commands, feature on/off checks, error handling | ✅ |
| Database (SQLite) with automatic upgrades and daily backups | ✅ |
| Dashboard: "Log in with Discord", server list, per-server feature switches, top menu on every page, light/dark mode, undo after saving | ✅ |
| Commands: `/setup`, `/dashboard`, `/ping` | ✅ |
| Setup categories with recommended features | ✅ |
| Reaction roles (dashboard) | ✅ |
| Join & leave messages: welcome, welcome DM, goodbye | ✅ |
| Rule verification: rules with an "I agree" button that gives a role | ✅ |
| Member onboarding: join roles, steps, access gate | ✅ |
| Auto-moderation: blocked words, invites, links, mass mentions, caps, emoji spam, zalgo, repeated messages | ✅ |
| Anti-spam: message rate, cross-channel posting, attachment and link floods | ✅ |
| Anti-raid: join-wave detection, raid mode lockdown, new-account filter, `/raidmode` | ✅ |
| Embed messages: multi-embed builder, post, edit and delete | ✅ |
| Announcements: templates, embed builder, pings, publishing, scheduling | ✅ |
| Events: RSVP buttons, reminders, one-click Discord Events tab | ✅ |
| Cosmetics → Channel designs: cute channel-name designs in one click | ✅ |
| Logging → Message logs: edits, deletes, bulk deletes with transcript | ✅ |
| Logging → Member logs: joins, leaves, nicknames, roles, profiles | ✅ |
| Logging → Server logs: channels, roles, settings, emojis, invites | ✅ |
| Logging → Voice logs: joins, leaves, moves, server mutes | ✅ |
| Custom commands: server-only slash commands with text or embed replies | ✅ |
| Custom commands → Rules: `/rule 1` posts that rule publicly | ✅ |
| Tickets: panels with buttons or a dropdown, private ticket channels, claim, close with transcript | ✅ |
| More admin features | Next, one at a time |

## Running on Wispbyte

Number One runs on Wispbyte and deploys itself on every restart:

1. Wispbyte pulls the latest code from `main` and runs `npm install`, which installs packages and builds the bot and dashboard.
2. The bot connects to Discord and registers its slash commands automatically.
3. The dashboard comes online at the server's Wispbyte subdomain (https://number-one.wispbyte.app), on the port Wispbyte assigns.

All settings (bot token, Discord client secret) live in the Wispbyte server's Environment settings. Nothing secret is stored in this repository. The dashboard address is detected automatically from the login redirect registered in the Discord application and from the address visitors use, so it never needs to be configured.

When everything is working, the console shows:

```
[web] dashboard online on port 16243
[bot] logged in as Number One#1234 in 3 servers
[bot] registered 2 global commands
[web] dashboard address: https://number-one.wispbyte.app (from Discord application settings)
```

If Discord login fails, the dashboard stays online and the bot retries every minute.

### Backups

A copy of the database is saved every day to `data/backups/`, and the last 7 days are kept. Download them from the File Manager. To restore one, stop the server, replace `data/number-one.db` with a backup and start it again.

## Features

### Commands

Number One keeps its command list short. Everything else is configured in the dashboard.

| Command | Who | What it does |
| --- | --- | --- |
| `/setup` | Manage Server | Asks what the server will use Number One for and switches on the right features |
| `/dashboard` | Manage Server | Link to this server's dashboard page |
| `/ping` | Everyone | Checks the bot is online |
| `/raidmode on/off/status` | Manage Server | Starts or ends raid mode by hand (Anti-raid) |
| `/ticket add/remove/close` | Ticket staff (close: also the opener) | Manages the ticket it's used in (Tickets) |

Every reply is public so staff can see who did what. Only `/setup` and a member's own walkthroughs (onboarding steps, role menu clicks) are private.

### Setup

`/setup` (or the "What will you use Number One for?" card on the dashboard) lets owners pick broad categories: 🛡️ Moderation & Safety, 👥 Community Settings, 🎭 Roles Management, 📋 Logging & Auditing, 🎉 Engagement & Fun, 🛠️ Utilities & Automation, and 🎀 Cosmetics. The recommended features in each picked category switch on.

- Categories without features yet are marked "coming soon". When a feature ships in a picked category, it switches on automatically for that server.
- Re-running setup never switches off anything already in use.
- When Number One joins a new server, it posts a one-time welcome in the system channel with a **Set up** button.

### Join & leave messages (Community Settings)

Welcomes new members and says goodbye when they leave. Configured on the dashboard:

| Part | Default | What it does |
| --- | --- | --- |
| Welcome message | On (system channel) | Posts in a chosen channel when someone joins, as a pink card or plain text. |
| Welcome DM | Off | Sends a private welcome too. |
| Goodbye message | Off | Posts when someone leaves. |

- Placeholders: `{user}`, `{username}`, `{server}`, `{memberCount}`.
- Bots are skipped. Nothing is posted while Anti-raid's raid mode is on.
- The dashboard warns if a chosen channel is gone or the bot can't post there.
- **Permissions:** View Channel, Send Messages and Embed Links in the chosen channels.

### Rule verification (Community Settings)

Posts the server's rules with an **I agree** button. Works on its own, whether Member onboarding is on or off.

- **The rules message:** channel, title, rules text, colour and an optional image. Button label, emoji and colour. Saving updates the message in place; picking another channel moves it.
- **Agreeing** gives the verified role and can take an "unverified" role away (verified goes on first, so nobody is left with neither). Pressing it again just says they've already agreed. The reply is only shown to them.
- **New members** can be given the unverified role when they join.
- To hide channels until people agree, allow them only for the verified role (or deny them for the unverified role) in Discord's channel settings.
- The dashboard shows how many have agreed and how many are still unverified, with a live preview of the message.
- Switching the feature off takes the rules message down. Saving again (or switching it back on) posts it again.
- **Permissions:** Manage Roles, with Number One's role above both roles; View Channel, Send Messages and Embed Links in the rules channel.

### Member onboarding (Community Settings)

Discord-style onboarding **without turning on Community settings**. Configured on the dashboard; every part is optional:

| Part | Default | What it does |
| --- | --- | --- |
| Join roles / bot roles | None | Given right away. Bots skip onboarding. |
| Onboarding steps | Off | A Start button in a chosen channel opens a private walkthrough: rules ("I agree"), then up to 5 questions (single or multiple choice, required or optional), each answer giving up to 5 roles. With no rules or questions, members just click Finish. Members can change their answers later. |
| Access gate | Off | Owner-only. Pick **staff categories** (never touched) and **whitelisted channels** (left exactly as they are), then click "Set it up for me". After a two-step confirm, it creates a "Start here" category with a read-only #start-here channel, a New member role and a **Verified** role (or uses the one you pick). It gives Verified to everyone already in the server, then makes every other channel visible only to Verified. Finishing onboarding gives Verified, which opens the server. Channels that are already private are left alone. Turning it off puts every channel back exactly as it was. Optionally removes members who don't finish in time. |

- The Start card explains each step ("Answer 3 questions · 2 required, 1 optional"), what members get, and roughly how long it takes. A second card shows live numbers: members, verified, still at the gate, joined and finished this week.
- The walkthrough shows "Step 2 of 5" with a progress bar, and the last step lists the roles the member will get.
- Only "View Channel" is changed, and only for @everyone, the New member role and the Verified role. The original @everyone setting is recorded before it's changed, so it can always be restored. New channels follow the same rules automatically.
- Switching onboarding off also turns the access gate's private channels back to normal, so nobody is locked out.
- Progress is saved, so members resume where they left off, even after restarts.
- All roles are applied in one update at the end.
- People who joined while the bot was offline get their starting roles when it's back.
- The dashboard shows joins, completions and pending members, and warns if Discord's own Community features are on.
- Nobody gets stuck behind the gate: it can't be on without onboarding steps, and switching onboarding off takes the New member role off everyone still holding it.
- The dashboard warns if a join role is allowed into a channel the gate hides (in Discord, an allow beats a deny, so new members would still see it).
- **Permissions:** Manage Roles (and its role above the roles it gives); Manage Channels for the access gate; Kick Members for removing unfinished members.

### Reaction roles (Roles Management)

Members get roles by reacting to a message, and lose them by removing the reaction. Managed entirely from the dashboard:

- Create, edit and delete messages: channel, title, description, single-choice option, and emoji-to-role rows.
- Emoji picker with the server's custom emojis and common emojis. Roles the bot can't give (above its own role) are greyed out.
- **Single choice:** members can hold only one role from that message. Picking another swaps the role and clears the old reaction.
- The bot adds the reactions itself, works on old messages after restarts, ignores bot reactions, and supports custom emojis.
- Up to 20 emojis per message (Discord's limit). Changing the channel reposts the message there.
- Cleans up automatically when the message, its channel or a role is deleted. If someone clears the reactions, the bot puts its own back.
- **Permissions:** the bot needs Manage Roles, and its role must sit above the roles it gives out. In the channel it needs View Channel, Send Messages, Embed Links, Add Reactions and Read Message History. Admins can only set up roles below their own highest role. Problems are explained on save.

### Auto-moderation (Moderation & Safety)

Catches rule-breaking messages automatically. Configured on the dashboard; every filter is off until switched on.

| Filter | Run by | What it catches |
| --- | --- | --- |
| Blocked words | Discord AutoMod | Your own list (up to 1,000, with `*` wildcards), plus Discord's swearing, sexual content and slur lists. A "never block" list stops false matches. |
| Invite links | Discord AutoMod | discord.gg and similar server invites. |
| Links | Discord AutoMod | Any web link, except sites on the allow list (subdomains included). |
| Mass mentions | Discord AutoMod | Messages that ping more than a set number of people or roles, plus Discord's mention-raid protection. |
| Excessive caps | Number One | Messages that are mostly capitals (percentage and minimum length are adjustable). |
| Emoji spam | Number One | More than a set number of emojis in one message. |
| Zalgo text | Number One | Glitchy text made of stacked accent marks. Normal accents and scripts like Thai or Hindi are never caught. |
| Repeated messages | Number One | The same message posted a set number of times within a set number of seconds, in any channels. All copies are deleted. |
| Message rate (anti-spam) | Number One | More than a set number of messages within a few seconds, or posting in several channels at once (how hacked accounts spread scam links). Works without Message Content Intent. |
| Attachment spam (anti-spam) | Number One | More than a set number of files, images or stickers within a set time. |
| Link spam (anti-spam) | Number One | More than a set number of links within a set time, even spread over many messages. |

- **Discord AutoMod filters** become rules in Server Settings → AutoMod, named "Number One · …". Discord blocks the message before anyone sees it and keeps working while Number One is offline. Number One keeps these rules in step with the dashboard (on save, when it's switched on or off, and on every restart) and never touches rules other people made. Switching the feature off removes its rules.
- **Number One filters** read each new or edited message and delete it if it breaks a rule. They only work while the bot is online.
- **Each filter chooses what happens:** delete only, delete and warn, delete and time out, or delete and kick. Warnings, timeouts and kicks go through Moderation, so they get a numbered case, a mod log entry, a DM to the member, and count towards automatic warning steps. A burst of spam leads to one action, not one per message.
- **Anti-spam filters** delete the whole burst (one request per channel), take one action, and post one alert. If the member keeps going, each new message is deleted straight away until they slow down.
- **Each filter can skip** up to 50 channels or categories and up to 20 roles. Like Discord's AutoMod, admins and people with Manage Server are never filtered.
- **Alerts:** an optional channel gets a note with the caught message each time something is caught.
- **Privacy:** message text is checked in memory and never saved. Repeated-message checks keep only a short fingerprint of each message for up to 10 minutes, and anti-spam checks keep only message IDs and times for up to 2 minutes.
- **Permissions:** Manage Server (for Discord AutoMod rules), Manage Messages (to delete messages), Timeout Members and Kick Members (for those actions).
- **Developer Portal:** the Number One filters (except Message rate) need **Message Content Intent** turned on (Developer Portal → Bot → Privileged Gateway Intents), then a restart. If it's off, the bot still logs in without it, the other features keep working, and the dashboard lists which filters are paused. (Once Number One is in 100+ servers, Discord must approve this intent.)

### Anti-raid (Moderation & Safety)

Stops raids: waves of accounts joining at once to spam. Configured on the dashboard.

| Setting | Default | What it does |
| --- | --- | --- |
| Join limit | More than 10 joins in 10 seconds | Starts **raid mode**. |
| Raiders | Kick | Everyone in the wave, and anyone who joins during raid mode, is kicked, timed out or banned (bans also delete their last hour of messages). Or "Lock down only". |
| Pause invites | On | Uses Discord's own "Pause invites", which Discord lifts by itself even if Number One is offline. |
| Raise verification | On | Sets the verification level to High (new members wait 10 minutes before chatting), then puts it back. |
| Raid mode lasts | 15 minutes | Lasts longer while joins keep coming too fast. Up to 24 hours. |
| Turn away new accounts | Off | At any time, kicks, times out or bans accounts younger than a set number of days. Each one is a Moderation case with a DM saying why. |

- Raid mode can also be started or ended by hand with `/raidmode` or the dashboard's buttons. The dashboard shows whether raid mode is on, joins in the last minute and how many accounts were dealt with.
- One alert (pinging a chosen role) when raid mode starts, and one summary when it ends. Raiders are dealt with one at a time in the background, without a case or DM each, so a big raid doesn't flood the mod log.
- While raid mode is on, Join & leave messages skips welcome and goodbye messages so those channels aren't flooded.
- Raid mode is saved, so a restart still ends it on time. Everything it changed is put back when it ends, when Anti-raid is switched off, or when the server's data is deleted. The verification level is only put back if nobody changed it during the raid.
- Admins, people with Manage Server and bots are never treated as raiders.
- **Permissions:** Manage Server (pause invites, verification), and Kick Members, Ban Members or Timeout Members for the chosen action.

### Embed messages (Utilities & Automation)

Build messages with embeds on the dashboard and Number One posts them.

- Text plus up to 10 embeds, each with colour, author, title and link, description, up to 25 fields, big and small images, footer and time. A live preview shows how it will look in Discord.
- Saved messages can be edited (the message in Discord changes too), moved to another channel, or deleted. Up to 100 per server.
- If a message is deleted in Discord, it's removed from the list. Editing one that was deleted posts it again.
- Mentions in the text show up but never ping anyone.
- Admins can only post in channels where they could post themselves.
- **Permissions:** View Channel, Send Messages and Embed Links in the chosen channel.

### Announcements (Utilities & Automation)

Write announcements on the dashboard, ping who needs to know, and send now or later.

- **Write:** start blank, from the server's own templates, or from a starter (Server update, Event, Maintenance, Rules update). Text plus an optional embed with its own builder and live preview.
- **Ping:** none, @everyone, @here, or up to 10 roles. Only the chosen ping goes off. Admins can only use pings they're allowed to use themselves.
- **Publish:** in announcement channels, optionally publishes to servers that follow the channel.
- **Schedule:** send at a set time, up to 90 days ahead (up to 25 waiting per server). Checked every 30 seconds, so scheduled ones still go out after a restart. Scheduled announcements can be edited, sent right away, or cancelled.
- **Templates:** save announcements with their channel and ping (up to 25), or "Save as template" while writing.
- **History:** the last 30 sent announcements, with links. Sent ones can be edited (the ping isn't sent again) or deleted. Failed ones show why and can be tried again.
- **Permissions:** View Channel, Send Messages and Embed Links, plus "Mention @everyone, @here and All Roles" for those pings.

### Events (Engagement & Fun)

Events like sesh.fyi, set up on the dashboard.

- **The post:** name, description, start and optional end time (everyone sees their own time zone, with a countdown), a place or link or a voice/stage channel, cover image and colour. An optional ping when it's posted.
- **Answers:** ✅ Going, ❔ Maybe and ❌ Can't go buttons, with a live list of who answered. Pressing your answer again takes it back. An optional limit on how many can go; when it's full, people can still pick Maybe.
- **Reminders:** a DM to everyone going or maybe going, from 10 minutes to a day before (or none).
- **Afterwards:** the post is marked ended and its buttons are removed. Cancelling marks it cancelled and DMs everyone who was going or maybe going.
- **Discord's Events tab:** the **Add to Discord Events** button (or a tick when creating) makes a matching Discord event with the same name, time, place, description, cover image and a link back to the post. Nobody has to set it up by hand. Edits are copied to it, cancelling or deleting removes it, and it shows as live when the event starts.
- The dashboard lists upcoming and past events with answer counts and who's coming, and can edit, copy, cancel or delete them. Up to 50 upcoming events per server.
- **Permissions:** View Channel, Send Messages and Embed Links in the event channel; Manage Events for Discord's Events tab; "Mention @everyone, @here and All Roles" for those pings. Admins need Manage Events (or Create Events) themselves to add events to the Events tab.

### Channel designs (Cosmetics)

Adds a cute design around every channel's name in one click, like `general` → `💬・general` or `꒰💬꒱general`.

- **8 designs:** Soft dot, Cloud frame, Sparkle trail, Fairy dust, Corner brackets, Dotted line, Little hearts and Bows. Each picks an emoji that fits the channel (💬 general, 📜 rules, 📢 announcements, 🎮 gaming and about 30 more), with a cute default when nothing fits.
- **Only the design is added.** The channel's own name and everything else about the channel (permissions, topic, position) stay the same. Each channel's own name is saved, so switching designs never stacks them and removing the design puts every name back exactly.
- **Which channels:** text channels always; announcement channels and voice/stage channels are options. Channels or whole categories can be left alone, and new channels can get the design too.
- The dashboard shows every channel's name before and after, and progress while renaming. Discord lets each channel be renamed twice every 10 minutes, so switching designs quickly can take a few minutes.
- If someone renames a designed channel by hand, that new name becomes its own name.
- Switching the feature off leaves names as they are (use **Remove design** first). Deleting the server's data puts the original names back.
- **Permissions:** Manage Channels (the bot and the admin).

### Message logs (Logging & Auditing)

Posts edited and deleted messages to a staff channel.

- **Edits:** what it said before and after, the author, channel and a link to the message. Link previews loading don't count as edits.
- **Deletes:** what it said, the author, files and stickers it had, and when it was sent.
- **Bulk deletes** (purges and mass deletes): one log with a text file of every deleted message.
- **Skip:** bots and webhooks (on by default), chosen channels or categories, and members with chosen roles. The log channel itself is never logged.
- Old text comes from Number One's memory of recent messages, so messages sent before it last restarted are logged without their text. Needs **Message Content Intent** to show text.
- **Permissions:** View Channel, Send Messages, Embed Links and Attach Files in the log channel.

### Member logs (Logging & Auditing)

Posts member activity to a staff channel.

- **Joins:** account age (marked ⚠️ new when younger than a set number of days) and the new member count.
- **Leaves:** when they joined and the roles they had.
- **Nickname and role changes:** before and after, and who made the change (from Discord's audit log).
- **Username, display name and avatar changes**, including server avatars.
- Bots can be skipped.
- **Permissions:** View Channel, Send Messages and Embed Links in the log channel; View Audit Log to show who made changes.

### Server logs (Logging & Auditing)

Posts server changes to a staff channel, with who made each one.

- **Channels:** created, deleted, renamed, moved to another category, topic, age restriction, slowmode, voice settings, and whose permissions changed.
- **Roles:** created, deleted, and changes to name, colour, display, icon, and exactly which permissions were given or taken away.
- **Server settings:** name, icon, banner, verification level, image filter, notifications, two-factor, system/rules/AFK channels, vanity invite and owner.
- **Emojis and stickers** added, removed and renamed. **Invites** created (channel, expiry, uses, who made it) and deleted.
- Changes Number One makes itself (like channel designs) are skipped by default. Just moving channels or roles up and down isn't logged.
- **Permissions:** View Channel, Send Messages and Embed Links in the log channel; View Audit Log to show who made changes; Manage Server for invites.

### Voice logs (Logging & Auditing)

Posts voice activity to a staff channel.

- **Joins, leaves** (with how long they stayed) and **moves** between voice channels.
- **Server mutes and deafens** by staff (not people muting themselves).
- Bots (by default) and chosen voice channels or categories can be skipped.
- **Permissions:** View Channel, Send Messages and Embed Links in the log channel.

### Custom commands (Utilities & Automation)

Admins make their own slash commands for their server, like `/faq` or `/ip`.

- Each command has a name, a description (shown in Discord's command list) and a reply: text, an embed (title, description, colour, image, footer), or both. Placeholders: `{user}`, `{username}`, `{server}`, `{channel}`, `{memberCount}`.
- Replies are public in the channel where the command is used. Only the person who used it can be pinged.
- Optionally only members with chosen roles can use a command.
- Commands are registered in that server only and kept in step with the dashboard (on save, when the feature is switched on or off, and on every restart). Number One's own command names can't be reused. Up to 50 per server, with a use count for each.
- **Rules (`/rule`):** admins write up to 25 numbered rules (title and optional description), a heading and a colour on the Rules tab. Anyone can type `/rule 1` to post that rule publicly in the channel, or `/rule` on its own to post the full list. While typing, Discord suggests the rule titles. `/rule` only appears in the server once it's switched on with at least one rule.
- **Permissions:** Send Messages. Number One must have been added with the commands permission (the dashboard's "Add bot" button includes it).

### Tickets (Utilities & Automation)

Members open a private channel with the staff team from a **ticket panel**.

- **Panels:** a message with an embed (title, description, colour, image) and up to 10 ticket types, shown as buttons or a dropdown. Up to 10 panels per server. Saving updates the panel in place; picking another channel moves it.
- **Ticket types:** name, emoji, button colour (or dropdown description), the first message in the ticket (placeholders `{user}`, `{username}`, `{server}`, `{type}`, `{number}`), and an optional question asked in a pop-up first. Each type can use its own channel name start, category and extra staff roles.
- **Opening:** creates `ticket-0001` (or `ticket-username`), visible only to the member, the staff roles and Number One. The welcome message is pinned and has **Close** and **Claim** buttons. Members can have 1–5 open tickets at once (default 1); double-clicks never open two.
- **Staff** (the picked roles, plus anyone with Manage Channels) can claim tickets, `/ticket add` and `/ticket remove` people, and close any ticket. Members can close their own, unless that's switched off.
- **Closing** asks to confirm, posts a transcript file (last 1,000 messages) to the log channel, can DM it to the member, then deletes the channel after 5 seconds. Tickets whose channel is deleted by hand are marked closed.
- The dashboard lists the 50 most recent tickets (open and closed) with who opened, claimed and closed them.
- Switching the feature off takes panels down; open tickets stay. Switching it back on posts them again.
- **Permissions:** Manage Channels (to create and delete ticket channels); View Channel, Send Messages and Embed Links in the panel and log channels.

## How the project is organized

```
index.js                  Start file for Wispbyte
src/
  shared/features.ts      The list of features and their settings, used by both the bot and the dashboard
  features/<name>/        One folder per feature: its commands and what it reacts to in Discord
  server/
    bot/                  Connects to Discord, routes commands to features
    web/                  Dashboard login and the API the dashboard talks to
    db/                   Database tables, upgrades and backups
    settings.ts           Reads and saves each server's feature settings
dashboard/                The website admins use
drizzle/                  Database upgrade files (created automatically, don't edit)
```

### How a feature is added

Each feature ships as one change containing all of its parts:

1. **Definition:** an entry in `src/shared/features.ts` with its name, description and settings, each with a sensible default.
2. **Bot behavior:** a folder in `src/features/` with its commands and event handlers.
3. **Dashboard page:** its settings form in `dashboard/`.
4. **Database tables**, only if it needs to store records such as warnings or tickets.

Features start **off** in every server until an admin turns them on. If someone uses a command from a disabled feature, the bot tells them where to enable it.

### Undo

After every settings save (each feature's Save changes, the on/off switches, and Choose features), a timed **Undo** button appears at the top right for 8 seconds. Clicking it puts the previous settings back; the button then stays, disabled, until its time runs out. Save buttons are always shown and stay disabled until there's a change to save, including right after an undo. Only the latest save can be undone. Things that have already gone out in Discord (an announcement, an embed message, an event, a role menu) don't offer undo.

### Security

- Only people with **Manage Server** can open a server's dashboard page. This is re-checked with Discord on every request, so removing someone's permission takes effect immediately.
- Settings are checked against each feature's rules before saving, so the dashboard can't store invalid values.
- Login sessions last up to 7 days. The browser only holds a random, signed ID, and the Discord login details stay in the database.
- The key that signs login cookies is generated automatically on first start and stored in `data/session-secret` on the server. It's never shown or uploaded anywhere.
- The "Add bot" button asks for Administrator permission, since an all-in-one admin bot needs to manage roles, channels, messages and members.

## For developers

```bash
npm install                # also builds everything
npm run dev                # run the bot + API with auto-reload
npm run dev:dashboard      # dashboard with live reload at http://localhost:5173
npm run typecheck
npm run db:generate        # after changing src/server/db/schema.ts
```

Settings come from environment variables. Set `SKIP_BOT=true` to run only the dashboard without logging the bot in.

Stack: Node.js 22.13+ (the server runs Node 26), TypeScript, discord.js v14, Fastify, SQLite (built into Node.js) + Drizzle ORM, React + Vite.
