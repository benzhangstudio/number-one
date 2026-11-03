# Levels

**Category:** 🎉 Engagement & Fun · **Recommended:** yes

Members earn XP by chatting and level up. They can check their rank and the leaderboard, and you can give roles at the levels you pick.

## Quick setup

1. Switch on **Levels** on the dashboard. It works straight away with the defaults.
2. Optional: add **reward roles**, like a "Regular" role at level 10.
3. Click **Save changes**.

## Earning XP

| Setting | Default | What it does |
| --- | --- | --- |
| XP per message | 15 to 25 | Each message gives a random amount in this range. |
| Cooldown | 1 minute | After earning XP, messages give nothing until the cooldown ends. This stops spam from paying off. |
| No XP in these channels | None | Chatting here gives no XP. Pick a category to cover every channel in it. Threads follow their channel. |
| No XP for these roles | None | Members with any of these roles never earn XP. |

Bots, webhooks and system messages never earn XP.

## How much XP each level needs

Each level needs a bit more than the last: 100 XP for level 1, then 155 more for level 2, 220 more for level 3, and so on. The dashboard shows the total XP needed next to each reward role.

| Level | Total XP | Messages, roughly |
| --- | --- | --- |
| 5 | 1,150 | 58 |
| 10 | 4,675 | 234 |
| 20 | 23,850 | 1,193 |
| 30 | 67,525 | 3,376 |
| 50 | 268,375 | 13,419 |

## Level-up message

Choose where it goes: the channel the member was chatting in (default), a channel you pick, a DM, or nowhere.

| Placeholder | Becomes |
| --- | --- |
| `{user}` | A mention of the member |
| `{username}` | Their name, without a ping |
| `{level}` | The level they reached |
| `{server}` | The server's name |

## Reward roles

Give a role when members reach a level. Up to 25 rewards, one role per level.

- **Keep earlier reward roles** (on by default): members keep every reward they've reached. Turn it off to keep only their highest one; earlier ones are taken away as they level up.
- Members who leave and come back get their reward roles again, since their XP is kept.
- When staff lower someone's XP with `/xp`, reward roles above their new level are taken away.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/rank [member]` | Everyone | Shows a member's level, progress bar, rank and total XP. |
| `/leaderboard [page]` | Everyone | Shows the members with the most XP, 10 per page. |
| `/xp give member amount` | Manage Server | Gives a member XP. |
| `/xp take member amount` | Manage Server | Takes XP away. |
| `/xp set member amount` | Manage Server | Sets a member's total XP. |
| `/xp reset member` | Manage Server | Sets a member's XP back to zero. |

## Good to know

- XP is kept when members leave, so they pick up where they left off.
- **Reset everyone's XP** at the bottom of the dashboard section wipes the whole leaderboard. Reward roles members already have are kept.
- The dashboard warns you if a reward role was deleted or sits above Number One's role.

## Permissions

- **Manage Roles** to give reward roles, and Number One's role must be **above** them in Server Settings → Roles.
- **View Channel** and **Send Messages** where level-up messages are posted.
