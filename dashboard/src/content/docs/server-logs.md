# Server logs

**Category:** 📋 Logging & Auditing · **Recommended:** yes

Posts changes to the server itself to a staff channel, with who made each one. Useful for spotting mistakes, rogue staff and compromised accounts.

## Quick setup

1. Create a log channel that only staff can see.
2. Switch on **Server logs** and pick that channel.
3. Click **Save changes**.

Nothing is logged until a log channel is picked.

## What's logged

| Group | Default | What's included |
| --- | --- | --- |
| Channels | On | Created, deleted, renamed, moved (up or down, or to another category), topic, age restriction, slowmode, voice settings, and whose permissions changed. |
| Roles | On | Created, deleted, and changes to name, colour, display, icon, and **exactly which permissions** were given or taken away. |
| Server settings | On | Name, icon, banner, verification level, image filter, notifications, two-factor requirement, system/rules/AFK channels, vanity invite and owner. |
| Emojis and stickers | On | Added, removed and renamed. |
| Invites | On | Created (channel, expiry, uses and who made it) and deleted. |

Each entry shows who made the change, taken from Discord's audit log.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Skip Number One's own changes | On | Changes Number One makes itself, like [Channel designs](/docs/channel-designs), aren't logged. |

Just moving channels or roles up and down the list isn't logged, to keep the log readable.

## Permissions

- **View Channel**, **Send Messages** and **Embed Links** in the log channel.
- **View Audit Log** to show who made changes.
- **Manage Server** to see invites.
