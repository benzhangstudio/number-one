# Member logs

**Category:** 📋 Logging & Auditing · **Recommended:** yes

Posts member activity to a staff channel: who joined, who left, and changes to nicknames, roles and profiles.

## Quick setup

1. Create a log channel that only staff can see.
2. Switch on **Member logs** and pick that channel.
3. Click **Save changes**.

Nothing is logged until a log channel is picked.

## What's logged

| Event | Default | What the log shows |
| --- | --- | --- |
| Joins | On | The member, their account age and the new member count. Young accounts are marked ⚠️ new. |
| Leaves | On | When they joined and the roles they had. |
| Nickname changes | On | Before and after, and who made the change. |
| Role changes | On | Roles given and taken, and who made the change. |
| Profile changes | On | Username, display name and avatar changes, including server avatars. |

"Who made the change" comes from Discord's audit log, so it can tell a member changing their own nickname apart from a moderator changing it.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Mark new accounts | 7 days | Joins from accounts younger than this are marked ⚠️ new. 0 to 90 days (0 = never). |
| Skip bots | Off | Bots joining, leaving and changing aren't logged. |

To act on new accounts automatically, use [Anti-raid's new-account filter](/docs/anti-raid#turn-away-new-accounts).

## Permissions

- **View Channel**, **Send Messages** and **Embed Links** in the log channel.
- **View Audit Log** to show who made changes.
