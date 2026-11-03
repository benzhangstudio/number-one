# Economy

**Category:** 🎉 Engagement & Fun · **Recommended:** yes

Your server's own currency. Members earn it by chatting, with `/daily` and `/work`, and when they level up. They can send it to each other with `/pay`, spend it in your server's shop, bet it on games, and compare with `/richest`.

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

## The shop

Add items on the dashboard under **Shop**. Members see them with `/shop`, buy with `/buy` and check what they own with `/inventory`.

| Item setting | Notes |
| --- | --- |
| Name, emoji and description | Shown in `/shop`. |
| Price | What it costs. |
| Gives a role | Optional. Buying it gives the role straight away, and each member can only buy it once. If Discord won't give the role, the member gets their money back. |
| Stock | How many can be sold in total. Empty means unlimited. |
| Most per member | How many one member can own. Empty means no limit. |
| Hidden | Hidden items aren't shown and can't be bought. |

Items without a role are things like "Custom nickname" or "Pick the next movie night". When a member uses one, staff take it from their inventory with `/economy take-item`. Up to 50 items per server.

Role items need Number One's **Manage Roles** permission, and Number One's highest role has to be above the role it gives.

## Games

Members bet their money. The bet is taken first and winnings are paid back.

| Game | How it works |
| --- | --- |
| `/coinflip bet side` | Pick heads or tails. Right guess wins your bet again. |
| `/slots bet` | Three reels. Three in a row pays ×5 (🍒) up to ×100 (7️⃣). Two in a row gives your bet back. |
| `/blackjack bet` | Play against Number One with **Hit**, **Stand** and **Double**. Number One draws to 17. Blackjack pays 3 to 2, a tie gives your bet back. After 2 minutes with no move, it stands for you. |

| Setting | Default |
| --- | --- |
| Smallest bet | 10 |
| Biggest bet | 1,000 |
| Wait between games | 5 seconds |

Each game can be switched off on its own.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/balance [member]` | Everyone | Shows a balance, rank and daily streak. For yourself, also when `/daily` and `/work` are ready. |
| `/daily` | Everyone | Collects the daily reward. |
| `/work` | Everyone | Does a quick job for some money. |
| `/pay member amount` | Everyone | Sends some of your money to another member. |
| `/richest [page]` | Everyone | Shows the members with the most money, 10 per page. |
| `/shop [page]` | Everyone | Shows what's for sale. |
| `/buy item [quantity]` | Everyone | Buys an item from the shop. |
| `/inventory [member]` | Everyone | Shows what you, or someone else, bought. |
| `/coinflip bet side` | Everyone | Bets on heads or tails. |
| `/slots bet` | Everyone | Spins the slot machine. |
| `/blackjack bet` | Everyone | Plays blackjack against Number One. |
| `/economy give member amount` | Manage Server | Gives a member money. |
| `/economy take member amount` | Manage Server | Takes money away (never below zero). |
| `/economy set member amount` | Manage Server | Sets a member's balance. |
| `/economy history member` | Manage Server | Shows a member's latest balance changes. |
| `/economy take-item member item [quantity]` | Manage Server | Takes a shop item from a member, like when they use it. Taking the last one of a role item also removes the role. |

## History

Every balance change is recorded for 90 days: daily rewards, work, level-ups, payments, shop purchases, games and staff changes. Chatting isn't recorded, because there's far too much of it. Staff can see a member's history with `/economy history`, and the dashboard shows the latest activity in the server.

## Good to know

- Balances can't go below zero. A payment only goes through if the sender has enough.
- Balances are kept when members leave.
- **Reset everyone's coins** on the dashboard sets every balance back to zero and deletes the history and inventories. Shop items stay, and so do roles members bought.
- Deleting a shop item removes it from every inventory. Roles already bought are kept.
