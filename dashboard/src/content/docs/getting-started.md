# Getting started

Number One is an all-in-one Discord server administration bot. Instead of juggling several small bots, you add Number One once and switch on the modules you want from the web dashboard.

> New here? Add the bot, run **/setup**, then open the dashboard to fine-tune each module. Most servers are running in under five minutes.

## What Number One does

Number One combines the jobs of many single-purpose bots into one:

| Category | Modules |
| --- | --- |
| 🛡️ Moderation & Safety | [Moderation](/docs/moderation), [Auto-moderation](/docs/automod), [Anti-raid](/docs/anti-raid) |
| 👥 Community Settings | [Join & leave messages](/docs/join-leave), [Rule verification](/docs/rule-verification), [Member onboarding](/docs/onboarding) |
| 🎭 Roles Management | [Reaction roles](/docs/reaction-roles) |
| 📋 Logging & Auditing | [Message logs](/docs/message-logs), [Member logs](/docs/member-logs), [Server logs](/docs/server-logs), [Voice logs](/docs/voice-logs) |
| 🎉 Engagement & Fun | [Events](/docs/events) |
| 🛠️ Utilities & Automation | [Embed messages](/docs/embeds), [Announcements](/docs/announcements), [Custom commands](/docs/custom-commands), [Tickets](/docs/tickets) |
| 🎨 Cosmetics | [Channel designs](/docs/channel-designs), [Guides](/docs/guides) |
| 🧩 Other | [Number One updates](/docs/bot-updates) |

Number One keeps its slash command list short on purpose. Almost everything is set up on the dashboard, and only the things staff need in the moment (like `/ban` or `/raidmode`) are commands. See [Commands](/docs/commands) for the full list.

## Step 1: Add the bot

1. Open the dashboard and click **Add bot** in the top menu.
2. Pick your server and approve the permissions.
3. Number One posts a one-time welcome message in your server's system channel with a **Set up** button.

The **Add bot** button asks for the Administrator permission. An all-in-one admin bot needs to manage roles, channels, messages and members, and asking for everything up front avoids features failing later. Each module page lists the exact permissions it uses, and so does [Permissions](/docs/permissions).

After adding the bot, drag **Number One's role** near the top of your role list (Server Settings → Roles). Discord only lets a bot give, take or act on roles that sit **below** its own role.

## Step 2: Run /setup

Type `/setup` in your server (you need **Manage Server**), or use the "What will you use Number One for?" card on the dashboard. Pick the categories that fit your server:

- 🛡️ Moderation & Safety
- 👥 Community Settings
- 🎭 Roles Management
- 📋 Logging & Auditing
- 🎉 Engagement & Fun
- 🛠️ Utilities & Automation
- 🎨 Cosmetics
- 🧩 Other

The recommended modules in each picked category switch on.

- Categories without modules yet are marked "coming soon". When a module ships in a category you picked, it switches on for your server automatically.
- Running setup again never switches off anything already in use. It only adds.
- The setup reply is only shown to you.

## Step 3: Configure on the dashboard

1. Go to the dashboard and click **Log in** (this uses "Log in with Discord").
2. Open **My servers** and pick your server. Only servers where you have **Manage Server** are listed.
3. Each module has its own page with an on/off switch and its settings. Change what you need and click **Save changes**.

You can also type `/dashboard` in Discord to get a direct link to your server's page.

## How modules work

- **Every module starts off** in every server until an admin switches it on (either by hand or through `/setup`).
- If someone uses a command from a module that's off, Number One tells them where to switch it on.
- Settings are checked before they're saved, so the dashboard can't store values Discord would reject.
- Every module page warns you about problems in plain words, such as a deleted channel or a missing permission.

## Where to get help

- Read [Troubleshooting & FAQ](/docs/troubleshooting) for the most common problems.
- Join the [support server](https://discord.gg/7GyveHcQdn) to ask the team.
