# K-pop Cards

**Category:** 🎉 Engagement & Fun · **Recommended:** yes

Collect K-pop photo cards from 2nd gen to today, starring BLACKPINK. Open packs, build a team of 3 and battle Pokémon-style, and trade with friends.

## Quick setup

1. Switch on **K-pop Cards** on the dashboard.
2. Pick a mode: **With Economy** or **Cards only**.
3. Click **Save changes**. Members can start with `/cards daily`.

## Two modes

| Mode | How it works |
| --- | --- |
| 💰 With Economy | Packs cost your server's [Economy](/docs/economy) currency, duplicates sell for it, and beating Number One pays a reward. Members can bet on battles against each other. |
| 🃏 Cards only | No money at all. Members get a free daily pack, and a bonus card for beating Number One (a few times a day). |

With Economy needs the Economy module. While Economy is off, the game runs as Cards only.

## The cards

- **57 groups, 328 members, 1,972 cards**, from 2nd gen (TVXQ!, BIGBANG, Girls' Generation…) to 5th gen (RIIZE, ILLIT, BABYMONSTER…). Lineups are the current or final ones.
- Every member has six cards: **Debut Day** and **Practice Room** (Common), **Comeback** and **Live Stage** (Rare), **Award Night** (Epic) and **Legend** (Legendary).
- **BLACKPINK** members also have a **Pink Crown** card, the only Mythics in the game.
- Each card shows a photo, the member's name and group, HP, a type and a move with its power.
- Cards appear in packs once they have a photo. The number of ready cards is shown on the dashboard and in `/cards packs`.

| Rarity | Stars |
| --- | --- |
| Common | ★ |
| Rare | ★★ |
| Epic | ★★★ |
| Legendary | ★★★★ |
| Mythic | ★★★★★ |

## Packs

| Pack | Cards | Notes |
| --- | --- | --- |
| 🎁 Daily | 3 | Free every 20 hours, in both modes. |
| 📦 Standard | 5 | With Economy. 200 by default. |
| 💝 Premium | 5 | With Economy. 750 by default. Much better odds, and at least one Epic or better. |
| 🌟 Featured | 5 | With Economy. 500 by default. Every card is from the featured group (BLACKPINK by default). |

You can pick which generations are in packs. BLACKPINK is always in.

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
| `/cards collection [member] [group] [page]` | Shows a collection. |
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
| Featured pack group | BLACKPINK |
| Pack prices | 200 / 750 / 500 |
| Sell prices | Common 5, Rare 20, Epic 75, Legendary 300, Mythic 1,500 |
| Battles | On, 40 per win, 5 rewarded wins a day, bets on |
| Trading and gifts | On |
| Generations | All |

Collections are per server. Deleting the server's data deletes them too.
