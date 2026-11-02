# Moderation

**Category:** 🛡️ Moderation & Safety · **Recommended:** yes

Warn, time out, kick and ban members with slash commands. Every action becomes a numbered **case**, so each member has a complete history that staff can review, edit and clean up. Cases are posted to a mod log, members get a DM explaining what happened, and repeat warnings can trigger automatic steps.

## Quick setup

1. Switch on **Moderation** on the dashboard (or pick Moderation & Safety in `/setup`).
2. Pick a **mod log** channel that only staff can see.
3. Choose whether members get a DM, and add an appeal message if you have an appeal process.
4. Optionally add **warning steps**, like "3 warnings → 1 hour timeout".
5. Click **Save changes**.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/warn user [reason]` | Timeout Members | Records a warning and checks the warning steps. |
| `/timeout user duration [reason]` | Timeout Members | Mutes a member for up to 28 days. |
| `/untimeout user [reason]` | Timeout Members | Ends a timeout early. |
| `/kick user [reason]` | Kick Members | Removes a member. They can rejoin with an invite. |
| `/ban user [duration] [delete_messages] [reason]` | Ban Members | Permanent or temporary ban (up to one year). |
| `/unban user [reason]` | Ban Members | Lifts a ban. Pick from the ban list or paste a user ID. |
| `/purge amount [user] [contains]` | Manage Messages | Bulk-deletes recent messages in the channel. |
| `/case …` | Timeout Members | Looks up and manages cases. See [Managing cases](#managing-cases). |

Each command only appears for staff with the matching Discord permission. Reasons can be up to 500 characters and show in the member's DM, the mod log and Discord's audit log.

## Cases

Every action creates a case with a number that counts up per server (`#1`, `#2`…). A case records:

- **What happened:** warn, note, timeout, timeout removed, kick, ban or unban.
- **Who** it happened to, and **which moderator** did it.
- **The reason**, the **duration** (for timeouts and temporary bans) and when it ends.
- Whether the member was sent a DM.
- Whether it was **automatic** (a warning step or a temporary ban running out) or **external** (done directly in Discord, see below).

| Action | Emoji | Notes |
| --- | --- | --- |
| Warn | ⚠️ | Counts towards warning steps. |
| Note | 📝 | Private staff note. The member isn't told. |
| Timeout | ⏳ | A new timeout replaces the old one. |
| Timeout removed | 🔈 | Ends an active timeout. |
| Kick | 👢 | The member can rejoin. |
| Ban | 🔨 | Permanent or temporary. A new ban replaces the old one. |
| Unban | 🕊️ | Ends any temporary ban too. |

### Actions taken directly in Discord

With **Record actions taken directly in Discord** on (the default), bans, unbans, kicks and timeouts done through Discord's own menus (right-click → Ban, and so on) are picked up from the audit log and recorded as cases too. This keeps every member's history complete no matter how staff took action. Actions Number One took itself are never recorded twice. This needs the **View Audit Log** permission.

## The mod log

Pick a channel and every case is posted there as a card with the action, member, moderator, reason and duration. When a case's reason is changed or the case is deleted, its card in the mod log is updated to match. `/purge` also posts a small note saying how many messages were deleted, where, and by whom.

## Messaging members

| Setting | Default | What it does |
| --- | --- | --- |
| Message members | On | DMs members when they're warned, timed out, kicked or banned. |
| Say who took the action | Off | Adds the moderator's name to the DM. Off keeps staff anonymous. |
| Appeal message | Empty | Extra text added to ban DMs, such as how to appeal. Up to 500 characters. |

- Kicked and banned members can't be messaged afterwards (they no longer share a server with the bot), so their DM is sent **first**. If the kick or ban then fails, the DM is taken back.
- If a member has DMs closed, the action still goes ahead. The case shows that no DM was sent.

## Warning steps

Warning steps take an action automatically when someone collects a number of warnings, like a ladder:

| Example | Warnings | Step |
| --- | --- | --- |
| First strike | 3 | Timeout for 1 hour |
| Second strike | 5 | Kick |
| Last strike | 7 | Ban (permanent or temporary) |

- Each step fires **once**, at the moment a member's warning count reaches exactly that number.
- Up to 10 steps. Each step can time out (5 minutes to 28 days), kick, or ban (permanent, or 5 minutes to 90 days from the dashboard).
- **Warnings stop counting** after a set time (or never, the default). Older warnings stay in the history but no longer count towards steps.
- Automatic steps become their own cases, marked as automatic, with Number One as the moderator.
- Timeouts and kicks need the member in the server. Bans work either way.
- Warnings given by [Auto-moderation](/docs/automod) count towards these steps too.

## Temporary bans and timeouts

- Timeouts use Discord's own timeout, so they end by themselves even if Number One is offline.
- **Temporary bans** are saved in the database. Number One checks once a minute and right after it starts, so bans that ran out while it was offline are lifted as soon as it's back.
- If someone unbans the member by hand first, the temporary ban is just marked as ended.
- If the module is switched off, temporary bans keep waiting instead of being dropped, and are lifted once it's back on.
- The dashboard shows how many temporary bans are running.

## /purge

`/purge amount [user] [contains]` bulk-deletes recent messages in the current channel.

- **amount:** how many recent messages to check, from 1 to 100.
- **user:** only delete messages from this person.
- **contains:** only delete messages containing this text (not case-sensitive).
- Pinned messages are always kept. Messages older than 14 days are skipped, because Discord doesn't allow bulk-deleting them.
- Needs Manage Messages and Read Message History in the channel.

## Managing cases

| Command | What it does |
| --- | --- |
| `/case history user [type]` | A member's full history, optionally filtered to one kind of case. |
| `/case view number` | One case, shown as its mod-log card. |
| `/case note user note` | Adds a private note to a member's history. They aren't told. |
| `/case reason number reason` | Changes a case's reason. Only the moderator who made it, or someone with Manage Server, can do this. |
| `/case delete number` | Deletes a case, such as a warning given by mistake. Needs Manage Server. |

Deleting a case removes it from the history and from warning counts, but it **doesn't** lift an active ban or timeout. Use `/unban` or `/untimeout` for that.

On the dashboard, the **Cases** list shows everything Moderation has recorded, newest first. Search by name, user ID, moderator or reason, filter by type, edit reasons and delete cases there too. The top of the page shows total cases, cases this week, warnings in the last 30 days and temporary bans running.

## Other settings

| Setting | Default | What it does |
| --- | --- | --- |
| Always require a reason | Off | Moderators must give a reason for every action. |
| /ban deletes messages from the | Don't delete | Default for `/ban`'s delete messages option: none, or up to the previous 7 days. |
| Warnings stop counting | Never | How long warnings count towards warning steps. |

## Safety checks

Number One refuses an action, and explains why, when:

- The moderator doesn't have the Discord permission for it.
- The target is the moderator themselves, the server owner, or Number One.
- The target's highest role is equal to or higher than the moderator's (the server owner can always act).
- The target's highest role is equal to or higher than Number One's role.
- Someone tries to time out a member with Administrator (Discord doesn't allow it).
- The target isn't in the server for a timeout or kick.
- The server requires a reason and none was given.

Discord's audit log shows which moderator used Number One for each action.

## Permissions

- **Timeout Members** for warns, timeouts and notes.
- **Kick Members** and **Ban Members** for those actions (including temporary bans being lifted).
- **Manage Messages** for `/purge`.
- **View Audit Log** to record actions taken directly in Discord.
- **View Channel**, **Send Messages** and **Embed Links** in the mod log channel.
- Number One's role must be above the roles of the members it acts on.

The dashboard lists anything missing under **Needs attention**.
