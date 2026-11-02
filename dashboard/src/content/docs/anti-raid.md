# Anti-raid

**Category:** 🛡️ Moderation & Safety · **Recommended:** yes

Stops raids: waves of accounts joining at once to spam or cause chaos. When too many people join too fast, Number One starts **raid mode**, locks the server down, deals with the raiders, and puts everything back when it's over.

## Quick setup

1. Switch on **Anti-raid** on the dashboard.
2. Pick an **alert channel** and a role to ping (like Moderators).
3. Check the join limit and what should happen to raiders.
4. Click **Save changes**.

## How raid mode starts

Raid mode starts automatically when more people join than the **join limit** allows. Staff can also start it by hand with `/raidmode on` or the dashboard's button.

| Setting | Default | Range |
| --- | --- | --- |
| Join limit | More than 10 joins… | 3 to 100 joins |
| …within | 10 seconds | 5 to 300 seconds |

Admins, people with Manage Server, and bots are never treated as raiders.

## What raid mode does

| Setting | Default | What it does |
| --- | --- | --- |
| Raiders | Kick | Everyone in the wave, and anyone who joins while raid mode is on, is kicked, timed out (default 1 hour) or banned. Bans also delete their last hour of messages. Pick **Lock down only** to just lock the server. |
| Pause invites | On | Uses Discord's own "Pause invites". Discord lifts the pause by itself, even if Number One is offline. |
| Raise verification | On | Sets the verification level to **High**, so new members wait 10 minutes before chatting. |
| Raid mode lasts | 15 minutes | 5 minutes to 24 hours. Raid mode lasts longer while joins keep coming too fast. |

While raid mode is on, [Join & leave messages](/docs/join-leave) skips welcome and goodbye messages, so those channels aren't flooded.

## Alerts

- **One alert** when raid mode starts, pinging the chosen role.
- **One summary** when it ends, with how many accounts were dealt with.
- Raiders are dealt with one at a time in the background, without a case or DM each, so a big raid doesn't flood the mod log.

## Ending raid mode

Raid mode ends when its time runs out, with `/raidmode off`, or with the dashboard's button. When it ends:

- Invites are unpaused.
- The verification level is put back, **only if nobody changed it** during the raid.
- Everything raid mode changed is also put back if Anti-raid is switched off, or if the server's data is deleted.

Raid mode is saved, so a restart still ends it on time.

## Turn away new accounts

Separate from raids, this filter works **at any time**. It deals with accounts younger than a set age as they join, which stops throwaway accounts made for trolling or ban evasion.

| Setting | Default | Range |
| --- | --- | --- |
| Turn away new accounts | Off | |
| Younger than | 3 days | 1 to 90 days |
| Action | Kick | Kick, time out (default 1 hour) or ban |

Each account turned away becomes a [Moderation](/docs/moderation) case, and the member gets a DM saying why.

## /raidmode

| Command | What it does |
| --- | --- |
| `/raidmode on [minutes]` | Starts raid mode now. Uses the dashboard's length unless you give one (5 to 1,440 minutes). |
| `/raidmode off` | Ends raid mode and puts everything back. |
| `/raidmode status` | Shows whether raid mode is on, and until when. |

All three need **Manage Server**.

## The dashboard

The Anti-raid page shows whether raid mode is on (and who or what started it), joins in the last minute, how many accounts were dealt with, and young accounts turned away since the bot last started. It also lists permission problems in plain words.

## Permissions

- **Manage Server** to pause invites and change the verification level.
- **Kick Members**, **Ban Members** or **Timeout Members** for the chosen action.
- **View Channel**, **Send Messages** and **Embed Links** in the alert channel.
