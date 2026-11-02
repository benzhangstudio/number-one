# Auto-moderation

**Category:** 🛡️ Moderation & Safety · **Recommended:** yes

Catches rule-breaking messages automatically, around the clock. Auto-moderation has eleven filters in three groups. Every filter is **off** until you switch it on, and each one has its own action, exceptions and limits.

## Quick setup

1. Switch on **Auto-moderation** on the dashboard.
2. Optionally pick an **alert channel** for staff.
3. Switch on the filters you want and adjust their limits.
4. Pick what happens when each filter catches something.
5. Click **Save changes**.

## How the filters run

| Type | Filters | How it works |
| --- | --- | --- |
| **Discord AutoMod** | Blocked words, Invite links, Links, Mass mentions | Turned into rules in Server Settings → AutoMod. Discord blocks the message **before anyone sees it**, and it keeps working while Number One is offline. |
| **Number One filters** | Excessive caps, Emoji spam, Zalgo text, Repeated messages | Number One reads each new or edited message and deletes it if it breaks a rule. Only works while the bot is online. |
| **Anti-spam** | Message rate, Attachment spam, Link spam | Number One watches for **bursts** of messages over a few seconds, the way spammers and hacked accounts behave. |

### Discord AutoMod rules

The Discord AutoMod filters appear in **Server Settings → AutoMod** with names starting "Number One · …".

- Number One keeps them in step with the dashboard: on save, when the module is switched on or off, and every time it restarts.
- It never touches AutoMod rules other people made.
- Switching the module off removes its rules.

## Discord AutoMod filters

### Blocked words

Words and phrases nobody can post.

| Setting | Default | Notes |
| --- | --- | --- |
| Blocked words | Empty | Up to 1,000 words or phrases, each up to 60 characters. |
| Never block | Empty | Up to 100 words that never trigger the filter, to stop false matches. |
| Discord's swearing list | Off | Discord's own maintained profanity list. |
| Discord's sexual content list | Off | Discord's own maintained list. |
| Discord's slurs list | Off | Discord's own maintained list. |

**Wildcards:** a plain word matches the whole word only. `bad*` matches words starting with "bad", `*bad` matches words ending with it, and `*bad*` matches it anywhere.

### Invite links

Blocks discord.gg and similar server invite links, so people can't advertise other servers.

### Links

Blocks any web link, except sites on the **allow list** (up to 100 sites, like `youtube.com`). Subdomains of allowed sites are allowed too, so allowing `youtube.com` also allows `m.youtube.com`.

### Mass mentions

| Setting | Default | Notes |
| --- | --- | --- |
| Limit | 5 | Most unique people and roles one message can ping (2 to 50). |
| Mention-raid protection | On | Lets Discord spot a sudden wave of mention spam across the server. |

## Number One filters

These need **Message Content Intent** (see [Troubleshooting](/docs/troubleshooting#message-content-intent)).

### Excessive caps

Catches messages that are mostly capital letters.

| Setting | Default | Range |
| --- | --- | --- |
| Capitals | 70% | 50% to 100% of letters |
| Minimum length | 10 letters | 5 to 200. Short messages like "OK" or "LOL" are never checked. |

### Emoji spam

Catches messages with more than a set number of emojis (default 10, range 3 to 100). Custom and normal emojis both count.

### Zalgo text

Catches glitchy text made of stacked accent marks. Normal accents and scripts like Thai or Hindi are never caught.

### Repeated messages

Catches the same message posted a set number of times within a set time, in any channels. **All copies are deleted**, not just the last one.

| Setting | Default | Range |
| --- | --- | --- |
| Copies | 3 | 2 to 10 |
| Within | 60 seconds | 5 to 600 seconds |

## Anti-spam filters

Anti-spam filters delete the **whole burst** (one request per channel), take **one** action and post **one** alert. If the member keeps going, each new message is deleted straight away until they slow down. These filters default to **Delete and time out**.

### Message rate

Catches someone sending too many messages too fast, or posting in several channels at once (how hacked accounts spread scam links). This filter works **without** Message Content Intent.

| Setting | Default | Range |
| --- | --- | --- |
| Messages | More than 7 | 3 to 30 |
| Within | 5 seconds | 2 to 60 seconds |
| Different channels | 3 | 0 (off) to 20 |

### Attachment spam

Catches more than a set number of files, images or stickers within a set time.

| Setting | Default | Range |
| --- | --- | --- |
| Attachments | 8 | 2 to 50 |
| Within | 15 seconds | 2 to 120 seconds |

### Link spam

Catches more than a set number of links within a set time, even when they're spread over many messages.

| Setting | Default | Range |
| --- | --- | --- |
| Links | 6 | 2 to 50 |
| Within | 15 seconds | 2 to 120 seconds |

## What happens when a filter catches something

Each filter has its own action:

| Action | What it does |
| --- | --- |
| Delete only | Removes the message. No case is recorded. (Default for most filters.) |
| Delete and warn | Also gives a warning, which counts towards [warning steps](/docs/moderation#warning-steps). |
| Delete and time out | Also times the member out. Default 10 minutes, up to 28 days. |
| Delete and kick | Also kicks the member. They can rejoin with an invite. |

- Warnings, timeouts and kicks go through [Moderation](/docs/moderation), so they get a numbered case, a mod log entry, a DM to the member, and count towards warning steps.
- A burst of spam leads to **one** action, not one per message.

## Exceptions

- Each filter can skip up to **50 channels or categories** and up to **20 roles**.
- Like Discord's AutoMod, admins and people with **Manage Server** are never filtered.

## Alerts

Pick an alert channel and staff get a short note with the caught message every time something is caught.

## Privacy

- Message text is checked in memory and never saved.
- Repeated-message checks keep only a short fingerprint of each message, for up to 10 minutes.
- Anti-spam checks keep only message IDs and times, for up to 2 minutes.

## Permissions

- **Manage Server** to create the Discord AutoMod rules.
- **Manage Messages** to delete messages.
- **Timeout Members** and **Kick Members** for those actions.
- **Message Content Intent** in the Developer Portal for the Number One filters (except Message rate). If it's off, the dashboard lists which filters are paused, and everything else keeps working.
