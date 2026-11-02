# Permissions

What Number One needs from Discord, module by module. If you added the bot with the dashboard's **Add bot** button, it has Administrator and you only need to check [role order](#role-order) and any channel-level overrides.

## Role order

Discord only lets a bot manage roles and members **below its own highest role**. Drag **Number One's role** near the top of the list in **Server Settings → Roles**, above:

- Every role it gives out (reaction roles, onboarding, rule verification).
- The roles of members it moderates.

Admins using the dashboard can also only set up roles below **their own** highest role.

## Channel overrides

If Number One doesn't have Administrator, a channel's own permission settings can block it even when its role allows something. Each module checks the channels it uses and tells you on the dashboard exactly what's missing and where.

## By module

| Module | Server permissions | In its channels |
| --- | --- | --- |
| [Moderation](/docs/moderation) | Timeout Members, Kick Members, Ban Members, Manage Messages, View Audit Log | View Channel, Send Messages, Embed Links (mod log) |
| [Auto-moderation](/docs/automod) | Manage Server, Manage Messages, Timeout Members, Kick Members | View Channel, Send Messages, Embed Links (alerts) |
| [Anti-raid](/docs/anti-raid) | Manage Server, plus Kick, Ban or Timeout Members | View Channel, Send Messages, Embed Links (alerts) |
| [Join & leave messages](/docs/join-leave) | | View Channel, Send Messages, Embed Links |
| [Rule verification](/docs/rule-verification) | Manage Roles | View Channel, Send Messages, Embed Links |
| [Member onboarding](/docs/onboarding) | Manage Roles, Manage Channels (gate), Kick Members (removing unfinished) | View Channel, Send Messages, Embed Links |
| [Reaction roles](/docs/reaction-roles) | Manage Roles | View Channel, Send Messages, Embed Links, Add Reactions, Read Message History |
| [Message logs](/docs/message-logs) | | View Channel, Send Messages, Embed Links, Attach Files |
| [Member logs](/docs/member-logs) | View Audit Log | View Channel, Send Messages, Embed Links |
| [Server logs](/docs/server-logs) | View Audit Log, Manage Server | View Channel, Send Messages, Embed Links |
| [Voice logs](/docs/voice-logs) | | View Channel, Send Messages, Embed Links |
| [Events](/docs/events) | Manage Events, Mention @everyone | View Channel, Send Messages, Embed Links |
| [Embed messages](/docs/embeds) | | View Channel, Send Messages, Embed Links |
| [Announcements](/docs/announcements) | Mention @everyone | View Channel, Send Messages, Embed Links |
| [Custom commands](/docs/custom-commands) | The applications.commands scope | Send Messages |
| [Tickets](/docs/tickets) | Manage Channels | View Channel, Send Messages, Embed Links, Attach Files |
| [Channel designs](/docs/channel-designs) | Manage Channels | |
| [Guides](/docs/guides) | | View Channel, Send Messages, Embed Links, Read Message History |

## Who can use what

- **Dashboard:** anyone with **Manage Server** in that server.
- **Access gate** (onboarding): the server owner only.
- **Slash commands:** each needs the matching Discord permission by default (see [Commands](/docs/commands)). Change this in **Server Settings → Integrations → Number One**.

## Message Content Intent

Some modules need to read what messages say. This is a setting in the Discord Developer Portal, not a server permission. See [Troubleshooting](/docs/troubleshooting#message-content-intent).
