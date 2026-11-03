# Number One

An all-in-one Discord server administration bot with a web dashboard. Contributions are welcome, from typo fixes to whole new features.

## Contributing

### 1. Get the code

Fork this repository on GitHub, then:

```bash
git clone https://github.com/<your-username>/number-one.git
cd number-one
npm install        # also builds the bot and the dashboard
```

You need **Node.js 22.13 or newer**.

### 2. Make a test bot

Never use the real Number One token. Make your own test bot instead:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Under **Bot**, copy the token and turn on the **Server Members** and **Message Content** intents.
3. Under **OAuth2**, copy the client secret and add the redirect `http://localhost:5173/auth/callback`.
4. Invite the bot to a test server of your own.

Create a file called `.env` in the project folder (it's ignored by git, so it's never uploaded):

```bash
DISCORD_TOKEN=your-test-bot-token
DISCORD_CLIENT_SECRET=your-client-secret
PORT=3000
DEV_GUILD_ID=your-test-server-id   # optional: slash commands update instantly in this server
```

### 3. Run it

```bash
npm run dev              # the bot and its API, restarts when you save
npm run dev:dashboard    # the dashboard at http://localhost:5173, in a second terminal
```

Data is saved in a local `data/` folder. Delete it to start fresh.

### 4. Make your change

- Open an issue first for anything big, so we can agree on the idea before you build it.
- Keep each pull request to one fix or one feature.
- Write text that people see in plain English: short sentences, no jargon.
- New feature? Follow [How a feature is added](#how-a-feature-is-added) below.
- Changed the database tables in `src/server/db/schema.ts`? Run `npm run db:generate` and commit the new file in `drizzle/`.

### 5. Check and send it

```bash
npm run typecheck
```

Test your change with your test bot, then push to your fork and open a pull request. Say what it changes and how you tested it. Screenshots help for anything on the dashboard.

## How the project is organized

```
src/
  shared/features.ts      Every feature and its settings, used by both the bot and the dashboard
  features/<name>/        One folder per feature: its commands and what it reacts to in Discord
  server/
    bot/                  Connects to Discord, routes commands to features
    web/                  Dashboard login and the API the dashboard talks to
    db/                   Database tables, upgrades and backups
dashboard/                The website (React)
  src/content/docs/       The help pages shown at /docs
drizzle/                  Database upgrade files (generated, don't edit by hand)
```

Stack: TypeScript, discord.js v14, Fastify, SQLite (built into Node.js) with Drizzle ORM, React with Vite.

### How a feature is added

A feature ships as one pull request with all of its parts:

1. **Definition:** an entry in `src/shared/features.ts` with its name, description and settings. Every setting needs a sensible default.
2. **Bot side:** a folder in `src/features/` with its commands and event handlers, added to `src/features/index.ts`.
3. **Dashboard:** its settings panel in `dashboard/src/features/`, added to `dashboard/src/features/index.ts`.
4. **Docs page:** `dashboard/src/content/docs/<name>.md`, listed in `dashboard/src/content/docs/index.ts`.
5. **Database tables,** only if it stores records (like warnings or tickets). Add them to the lists in `src/server/guildData.ts` so a server's data can be deleted.

Features start **off** in every server until an admin turns them on.

## Security

Found a security problem? Please don't open a public issue. Report it privately in the [support server](https://discord.gg/7GyveHcQdn) instead.

## License

[MIT](LICENSE). You can use, change and share the code, as long as you keep the copyright notice.
