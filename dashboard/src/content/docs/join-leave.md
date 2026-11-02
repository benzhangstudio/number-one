# Join & leave messages

**Category:** 👥 Community Settings · **Recommended:** yes

Welcomes new members in a channel or by DM, and posts a goodbye when someone leaves.

## Quick setup

1. Switch on **Join & leave messages** on the dashboard.
2. The welcome message is already on and posts in your server's **system channel**. Pick another channel if you like.
3. Edit the text, then click **Save changes**.

## The three messages

| Message | Default | What it does |
| --- | --- | --- |
| Welcome message | On, system channel | Posts in a chosen channel when someone joins. |
| Welcome DM | Off | Also sends the new member a private welcome. |
| Goodbye message | Off, system channel | Posts in a chosen channel when someone leaves. |

### Welcome message

- **Channel:** any text channel. Leave it empty to use the server's system channel (Server Settings → Overview → System Messages Channel).
- **Style:** a pink card (embed) or plain text. The card is the default.
- **Text:** up to 1,800 characters, with placeholders.

### Welcome DM

A private message to the new member, up to 1,800 characters. Useful for links and first steps you don't want cluttering the welcome channel. If the member has DMs closed, it's skipped quietly.

### Goodbye message

Posts when someone leaves, is kicked or is banned. Up to 1,800 characters.

## Placeholders

Use these anywhere in the three messages:

| Placeholder | Becomes |
| --- | --- |
| `{user}` | A mention of the member, like @Alex |
| `{username}` | Their username, without a ping |
| `{server}` | The server's name |
| `{memberCount}` | How many members the server has now |

For example: `Welcome to {server}, {user}! You're member #{memberCount}.`

## Good to know

- Bots joining or leaving are skipped.
- Nothing is posted while [Anti-raid](/docs/anti-raid)'s raid mode is on, so a raid can't flood the welcome channel.
- The dashboard warns you if a chosen channel was deleted or Number One can't post there.

## Permissions

**View Channel**, **Send Messages** and **Embed Links** in the chosen channels.
