# Troubleshooting & FAQ

Quick fixes for the most common problems. The dashboard's **Needs attention** box on each module page usually names the exact problem, so check there first.

## Number One can't give a role

Discord only lets bots give roles **below** their own highest role.

1. Open **Server Settings → Roles**.
2. Drag **Number One's role** above the role it needs to give.
3. Make sure the role isn't managed by another bot or integration (those can't be given by anyone).

Admins can also only set up roles below their own highest role on the dashboard.

## "Their highest role is above or equal to mine"

[Moderation](/docs/moderation) can't act on members whose highest role is at or above Number One's role. Move Number One's role higher. Members can't moderate people with roles equal to or higher than their own either, except the server owner.

## A command doesn't show up

- Check the module is **switched on** on the dashboard. Commands from switched-off modules tell you where to switch them on.
- Each command is limited to staff with the matching permission (see [Commands](/docs/commands)). Check **Server Settings → Integrations → Number One** for overrides.
- [Custom commands](/docs/custom-commands) and `/rule` are registered in your server only and can take a moment to appear after saving. Restarting Discord (Ctrl+R) refreshes the command list.
- If you added Number One without the commands permission, add it again with the dashboard's **Add bot** button.

## Message Content Intent

Some modules need to read what messages say:

- [Auto-moderation](/docs/automod): Excessive caps, Emoji spam, Zalgo text, Repeated messages, Attachment spam and Link spam. (Message rate works without it.)
- [Message logs](/docs/message-logs): showing the text of edited and deleted messages.

This is set by whoever runs the bot, in the **Discord Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent**, followed by a restart. If it's off, the bot still logs in, everything else keeps working, and the dashboard lists which filters are paused.

## Deleted messages show no text

[Message logs](/docs/message-logs) gets old text from its memory of recent messages. Messages sent before Number One last restarted are logged without their text. Message Content Intent must also be on.

## A Discord AutoMod rule came back after I deleted it

Number One keeps its own AutoMod rules (named "Number One · …") in step with the dashboard and recreates them on save and on restart. Switch the filter off on the dashboard instead. Rules made by other people are never touched.

## Channel designs are taking a long time

Discord only lets each channel be renamed twice every 10 minutes. Switching designs several times quickly can take a few minutes to finish. The dashboard shows progress.

## Members can still see hidden channels

In Discord, an **allow** on a channel beats a deny. If a role a new member has (like a join role) is allowed into a channel, they'll see it even with the [access gate](/docs/onboarding#access-gate) on. The onboarding page warns you about this.

## Scheduled things after a restart

Scheduled announcements, temporary bans, temporary roles, event reminders and raid mode are all saved in the database, so they still happen on time after Number One restarts. Anything that came due while it was offline happens as soon as it's back.

## Does Number One store message text?

Not in its database. Auto-moderation checks messages in memory and never saves their text. Message logs uses Number One's short-term memory of recent messages and only posts text to your own log channel. See the [Privacy Policy](/privacy) for everything Number One stores.

## Still stuck?

Ask in the [support server](https://discord.gg/7GyveHcQdn).
