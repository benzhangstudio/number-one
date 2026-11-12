# Sticky messages

**Category:** 🛠️ Utilities & Automation · **Recommended:** yes

Keep a message at the bottom of a channel, like rules, a how-to or "please stay on topic". When people chat, Number One posts the message again and deletes the old copy, so it's always the last thing people see.

## Quick setup

1. Switch on **Sticky messages** on the dashboard.
2. Click **New sticky message**, pick a channel and write the message.
3. Click **Post sticky message**.

Or type `/sticky set` in the channel and fill in the form.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| Channel | | One sticky message per channel. Text and announcement channels, and threads (with `/sticky`). |
| Post as an embed | Off | A coloured box with an optional title. Plain messages can be up to 2000 characters, embeds up to 4000. |
| Repost after this many messages | 1 | 1 keeps it at the very bottom. Use a higher number in busy channels. |
| Wait between reposts | 10 seconds | 5 seconds to 10 minutes. Number One also waits for the chat to settle for a couple of seconds, so a burst of messages means one repost. |

Mentions in a sticky message never ping anyone.

## Pausing and removing

- **Pause** takes the sticky message down but keeps it saved. **Resume** posts it again.
- **Delete** removes it and its posted copy.
- If someone deletes the posted copy, it comes back after the next message.
- Switching the module off takes every sticky message down. Switching it back on posts them again.
- Deleting the channel deletes its sticky message.

Up to 50 sticky messages per server.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/sticky set [channel] [embed] [after] [wait]` | Manage Messages | Opens a form to add or change a channel's sticky message. |
| `/sticky pause [channel]` | Manage Messages | Takes it down for now, but keeps it saved. |
| `/sticky resume [channel]` | Manage Messages | Posts a paused sticky message again. |
| `/sticky remove [channel]` | Manage Messages | Deletes the sticky message. |
| `/sticky list` | Manage Messages | Lists the server's sticky messages. |

`channel` is the current channel if you leave it empty. You can let other roles use `/sticky` in **Server Settings → Integrations → Number One**.

## Permissions

- **View Channel** and **Send Messages** in the channel.
- **Embed Links** for embed sticky messages.
