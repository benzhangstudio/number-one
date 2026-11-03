# Commands

Every slash command Number One has, who can use it, and what it does. Commands only show up for people with the right Discord permission. Server owners can fine-tune who sees each one in **Server Settings → Integrations → Number One**.

> Replies are public so staff can see who did what. Only `/setup` and a member's own walkthroughs (onboarding steps, role menu clicks) are private.

## Core

| Command | Who | What it does |
| --- | --- | --- |
| `/setup` | Manage Server | Asks what the server will use Number One for and switches on the right modules. See [Getting started](/docs/getting-started#step-2-run-setup). |
| `/dashboard` | Manage Server | Gives a direct link to this server's dashboard page. |
| `/ping` | Everyone | Checks the bot is online and how fast it responds. |

## Moderation

Part of the [Moderation](/docs/moderation) module.

| Command | Who | What it does |
| --- | --- | --- |
| `/warn user [reason]` | Timeout Members | Warns a member. Repeat warnings can trigger automatic steps. |
| `/timeout user duration [reason]` | Timeout Members | Times a member out (up to 28 days). They can't chat, react or join voice. |
| `/untimeout user [reason]` | Timeout Members | Ends a timeout early. |
| `/kick user [reason]` | Kick Members | Removes a member. They can rejoin with an invite. |
| `/ban user [duration] [delete_messages] [reason]` | Ban Members | Bans someone for good, or for a while (up to a year). Works on people who already left. |
| `/unban user [reason]` | Ban Members | Lifts a ban. Suggests names from the ban list as you type. |
| `/purge amount [user] [contains]` | Manage Messages | Bulk-deletes up to 100 recent messages in the channel. |
| `/case history user [type]` | Timeout Members | Shows a member's moderation history, optionally only one kind of case. |
| `/case view number` | Timeout Members | Shows one case, as it appears in the mod log. |
| `/case note user note` | Timeout Members | Adds a private staff note to a member's history. They aren't told. |
| `/case reason number reason` | Case author or Manage Server | Changes a case's reason and updates the mod log. |
| `/case delete number` | Manage Server | Deletes a case, for example a warning given by mistake. |

## Anti-raid

Part of the [Anti-raid](/docs/anti-raid) module.

| Command | Who | What it does |
| --- | --- | --- |
| `/raidmode on [minutes]` | Manage Server | Starts raid mode now: pauses invites, raises verification and deals with new joiners. |
| `/raidmode off` | Manage Server | Ends raid mode and puts everything back. |
| `/raidmode status` | Manage Server | Shows whether raid mode is on, and until when. |

## Levels

Part of the [Levels](/docs/levels) module.

| Command | Who | What it does |
| --- | --- | --- |
| `/rank [member]` | Everyone | Shows your level, XP and rank, or someone else's. |
| `/leaderboard [page]` | Everyone | Shows the members with the most XP. |
| `/xp give/take/set member amount` | Manage Server | Changes a member's XP. |
| `/xp reset member` | Manage Server | Sets a member's XP back to zero. |

## Tickets

Part of the [Tickets](/docs/tickets) module. Used inside a ticket channel.

| Command | Who | What it does |
| --- | --- | --- |
| `/ticket add member` | Ticket staff | Lets someone see and talk in this ticket. |
| `/ticket remove member` | Ticket staff | Removes someone who was added. |
| `/ticket close [reason]` | Ticket staff, or the member who opened it | Closes the ticket and saves a transcript. |

## Rules and custom commands

Part of the [Custom commands](/docs/custom-commands) module. These only exist in servers that set them up.

| Command | Who | What it does |
| --- | --- | --- |
| `/rule [number]` | Everyone | Posts one numbered rule publicly, or the full list with no number. |
| Your own commands | Everyone, or chosen roles | Replies with the text or embed the admins wrote, like `/faq` or `/ip`. |

## Durations

Commands that take a duration (`/timeout`, `/ban`) understand plain text and suggest matches as you type:

- `10m`, `1h`, `1d`, `1w`, `30d`, `1y`
- Combinations like `1h30m` or `2 days 6 hours`
- A bare number means minutes, so `15` is 15 minutes.
- Leave `/ban`'s duration empty (or pick **Permanent**) for a permanent ban.
