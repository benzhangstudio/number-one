# Custom commands

**Category:** 🛠️ Utilities & Automation · **Recommended:** yes

Make your own slash commands for your server, like `/faq`, `/ip` or `/socials`, with text or embed replies. Also includes **Rules**: a `/rule` command that posts any of your server's rules on demand.

## Quick setup

1. Switch on **Custom commands** on the dashboard.
2. Click **New command**, give it a name, a description and a reply.
3. Click **Save**. The command appears in your server within a few seconds.

## Making a command

| Part | Notes |
| --- | --- |
| Name | What members type after the slash. Lowercase letters, numbers, `-` and `_`. |
| Description | Shown in Discord's command list. Up to 100 characters. |
| Text reply | Up to 2,000 characters. |
| Embed reply | Optional: title, description, colour, image and footer. |
| Allowed roles | Optional. Only members with one of these roles (up to 10) can use it. Empty = everyone. |

A reply can be text, an embed, or both.

### Placeholders

| Placeholder | Becomes |
| --- | --- |
| `{user}` | A mention of the person who used the command |
| `{username}` | Their username, without a ping |
| `{server}` | The server's name |
| `{channel}` | The channel it was used in |
| `{memberCount}` | How many members the server has |

## How commands behave

- Replies are **public** in the channel where the command is used.
- Only the person who used the command can be pinged by the reply. Other mentions show but don't ping.
- Each command shows a **use count** on the dashboard.
- Up to **50** custom commands per server.
- Number One's own command names (like `/ban` or `/setup`) can't be reused.

## Rules (/rule)

On the **Rules** tab, write up to 25 numbered rules, each with a title and an optional description, plus a heading (default "Server rules") and a colour.

| Command | What it posts |
| --- | --- |
| `/rule 1` | Rule 1, publicly in the channel. Great for pointing someone at the rule they broke. |
| `/rule` | The full list of rules. |

- While typing, Discord suggests the rule titles.
- `/rule` only appears in the server once Rules is switched on with at least one rule.

## Staying in sync

Commands are registered in **your server only**, not globally. Number One keeps them in step with the dashboard: on save, when the module is switched on or off, and every time it restarts. Switching the module off removes them from the server.

## Permissions

- **Send Messages** in the channels where commands are used.
- Number One must have been added with the **commands** permission. The dashboard's **Add bot** button includes it.
