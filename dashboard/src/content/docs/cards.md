# BLACKPINK Poker

**Category:** 💖 K-pop · **Recommended:** yes

Collect BLACKPINK photo cards from Common to Mythic. Open packs, build a team of 3 and battle Pokémon-style, and trade with friends.

## Quick setup

1. Switch on **BLACKPINK Poker** on the dashboard (under **K-pop**).
2. Pick a mode: **With Economy** or **Cards only**.
3. Click **Save changes**. Members can start with `/cards daily`.

## Two modes

| Mode | How it works |
| --- | --- |
| 💰 With Economy | Packs cost your server's [Economy](/docs/economy) currency, duplicates sell for it, and beating Number One pays a reward. Members can bet on battles against each other. |
| 🃏 Cards only | No money at all. Members get a free daily pack, and a bonus card for beating Number One (a few times a day). |

With Economy needs the Economy module. While Economy is off, the game runs as Cards only.

## The cards

There are **28 cards**: seven for each of Jisoo, Jennie, Rosé and Lisa.

| Card | Rarity |
| --- | --- |
| Debut Day, Practice Room | ★ Common |
| Comeback, Live Stage | ★★ Rare |
| Award Night | ★★★ Epic |
| Legend | ★★★★ Legendary |
| Pink Crown | ★★★★★ Mythic |

Each card shows a photo, the member's name, HP, a type and a move with its power.

## Packs

| Pack | Cards | Notes |
| --- | --- | --- |
| 🎁 Daily | 3 | Free every 20 hours, in both modes. |
| 📦 Standard | 5 | With Economy. 200 by default. |
| 💝 Premium | 5 | With Economy. 750 by default. Much better odds, and at least one Epic or better. |

## Battles

Each member has a **team of 3**, picked with `/cards team`. Empty spots are filled with their strongest cards.

- Cards take turns using their move. Damage is the move's power, with a little luck.
- **Types** beat each other in a cycle: 🔥 Fierce › 🌿 Fresh › 🌙 Dreamy › 🍬 Sweet › 💎 Elegant › 🔥 Fierce. A strong match does 1.5× damage, a weak one 0.75×.
- When a card's HP runs out, the next one steps in. The last team standing wins.
- Battle **Number One** for rewards (5 rewarded wins a day by default), or challenge a member. They have 2 minutes to accept.

## Commands

| Command | What it does |
| --- | --- |
| `/cards daily` | Opens your free daily pack. |
| `/cards open pack` | Buys and opens a pack (With Economy). |
| `/cards packs` | Shows the packs and prices. |
| `/cards collection [member] [page]` | Shows a collection. |
| `/cards view card` | Shows a card up close. |
| `/cards team [first] [second] [third]` | Shows or sets your battle team. |
| `/cards battle [opponent] [bet]` | Battles Number One, or challenges a member. |
| `/cards trade member give get` | Offers to swap one of your cards for one of theirs. |
| `/cards gift member card` | Gives a card away. |
| `/cards sell card [quantity]` | Sells a card (With Economy). |
| `/cards sell-duplicates [up_to]` | Sells every extra copy, keeping one of each (With Economy). Epic and below by default. |
| `/cards top` | Shows the top collectors. |

## Settings

| Setting | Default |
| --- | --- |
| Mode | With Economy |
| Daily pack | On |
| Pack prices | Standard 200, Premium 750 |
| Sell prices | Common 5, Rare 20, Epic 75, Legendary 300, Mythic 1,500 |
| Battles | On, 40 per win, 5 rewarded wins a day, bets on |
| Trading and gifts | On |

Collections are per server. Deleting the server's data deletes them too.
