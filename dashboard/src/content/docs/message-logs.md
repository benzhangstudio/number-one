# Message logs

**Category:** 📋 Logging & Auditing · **Recommended:** yes

Posts edited and deleted messages to a staff channel, so you can see what was said even after someone changes or removes it.

## Quick setup

1. Create a log channel that only staff can see.
2. Switch on **Message logs** and pick that channel.
3. Click **Save changes**.

Nothing is logged until a log channel is picked.

## What's logged

| Event | Default | What the log shows |
| --- | --- | --- |
| Edits | On | What the message said before and after, the author, the channel and a link to the message. |
| Deletes | On | What it said, the author, files and stickers it had, and when it was sent. |
| Bulk deletes | On | Purges and mass deletes are posted as **one** log with a text file of every deleted message. |

Link previews loading aren't counted as edits, so they don't spam the log.

## Skipping things

| Setting | Default | Notes |
| --- | --- | --- |
| Skip bots and webhooks | On | Messages from bots and webhooks aren't logged. |
| Skipped channels | None | Up to 50 channels or whole categories. |
| Skipped roles | None | Up to 20 roles. Members with any of them aren't logged. |

The log channel itself is never logged.

## Good to know

- The "before" text of edits and the text of deleted messages comes from Number One's memory of recent messages. Messages sent before the bot last restarted are logged **without their text**.
- Showing message text needs **Message Content Intent** (see [Troubleshooting](/docs/troubleshooting#message-content-intent)). Without it, logs still show the author, channel and time, and the dashboard tells you text is missing.

## Permissions

**View Channel**, **Send Messages**, **Embed Links** and **Attach Files** (for bulk-delete transcripts) in the log channel.
