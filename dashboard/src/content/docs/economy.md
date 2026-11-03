# Economy

**Category:** 🎉 Engagement & Fun · **Recommended:** yes

Your server's own currency. Members earn it by chatting, with `/daily` and `/work`, and when they level up. They can send it to each other with `/pay` and compare with `/richest`.

## Quick setup

1. Switch on **Economy** on the dashboard. It works straight away with 🪙 coins.
2. Optional: rename the currency, like 💎 gems or 🌸 petals.
3. Click **Save changes**.

## Your currency

| Setting | Default | What it does |
| --- | --- | --- |
| Name for one | coin | Used for "1 coin". |
| Name for many | coins | Used for everything else, like "250 coins". |
| Emoji | 🪙 | Shown before amounts. Any emoji, or one of your server's own (type its code, like `<:gem:123456789012345678>`). |
| Starting balance | 0 | What members have before they earn anything. |

## Ways to earn

| Way | Default | How it works |
| --- | --- | --- |
| Chatting | 1 to 5 per message, once a minute | Pick channels or categories where nothing is earned. |
| `/daily` | 100, +10 per streak day, up to +100 extra | Once every 20 hours. Claim again within 2 days to keep the streak; miss it and the streak starts over. |
| `/work` | 20 to 80, once an hour | A quick made-up job, like walking the server's dogs. |
| Level-ups | 50 per new level | Needs the [Levels](/docs/levels) module. The level-up message mentions the reward. |

Each one can be switched off or changed on the dashboard.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/balance [member]` | Everyone | Shows a balance, rank and daily streak. For yourself, also when `/daily` and `/work` are ready. |
| `/daily` | Everyone | Collects the daily reward. |
| `/work` | Everyone | Does a quick job for some money. |
| `/pay member amount` | Everyone | Sends some of your money to another member. |
| `/richest [page]` | Everyone | Shows the members with the most money, 10 per page. |
| `/economy give member amount` | Manage Server | Gives a member money. |
| `/economy take member amount` | Manage Server | Takes money away (never below zero). |
| `/economy set member amount` | Manage Server | Sets a member's balance. |
| `/economy history member` | Manage Server | Shows a member's latest balance changes. |

## History

Every balance change is recorded for 90 days: daily rewards, work, level-ups, payments and staff changes. Chatting isn't recorded, because there's far too much of it. Staff can see a member's history with `/economy history`, and the dashboard shows the latest activity in the server.

## Good to know

- Balances can't go below zero. A payment only goes through if the sender has enough.
- Balances are kept when members leave.
- **Reset everyone's coins** on the dashboard sets every balance back to zero and deletes the history.
- Coming soon: a shop to spend your currency on, and mini games.
