# Rule verification

**Category:** 👥 Community Settings · **Recommended:** yes

Posts your server's rules with an **I agree** button. Agreeing gives a verified role, so you can keep channels hidden until members accept the rules. It works on its own, whether [Member onboarding](/docs/onboarding) is on or off.

## Quick setup

1. Create a **Verified** role (and optionally an **Unverified** role) in Server Settings → Roles. Keep them below Number One's role.
2. Switch on **Rule verification** on the dashboard.
3. Pick the rules channel, write your rules and pick the verified role.
4. Click **Save changes**. The rules message is posted.
5. Hide your other channels from people without the verified role (see [Hiding channels](#hiding-channels-until-people-agree)).

## The rules message

| Setting | Default | Notes |
| --- | --- | --- |
| Channel | None | Where the rules are posted. |
| Title | 📜 Server rules | Up to 256 characters. |
| Rules | Three starter rules | Up to 4,000 characters, with Discord formatting. |
| Colour | Pink | The card's side colour. |
| Image | None | Optional picture under the rules. |
| Button label | I agree | Up to 80 characters. |
| Button emoji | ✅ | Optional. |
| Button colour | Green | Blurple, grey, green or red. |

- Saving **updates the message in place**. Picking another channel moves it.
- The dashboard shows a live preview of the message as it will look in Discord.

## What happens when someone agrees

| Setting | Default | What it does |
| --- | --- | --- |
| Verified role | None | Given when someone presses the button. |
| Unverified role | None | Optional. Taken away when someone agrees. |
| Give unverified role on join | Off | New members get the unverified role, so they only see what it allows until they agree. |
| Reply | ✅ Thanks for agreeing to the rules. Welcome in! | Shown only to the person who agreed. Up to 500 characters. |

- The verified role goes on **first**, then the unverified role comes off, so nobody is ever left with neither.
- Pressing the button again just says they've already agreed.

## Hiding channels until people agree

Rule verification gives roles. Discord's channel permissions decide what each role can see. Either:

- Allow **View Channel** only for the verified role on each channel (and deny it for @everyone), or
- Deny **View Channel** for the unverified role on each channel, with "Give unverified role on join" switched on.

If you'd rather have Number One set up hidden channels for you, use [Member onboarding's access gate](/docs/onboarding#access-gate) instead.

## Switching it off

Switching the module off takes the rules message down. Saving again, or switching it back on, posts it again. Roles members already have are kept.

## The dashboard

Shows a link to the posted message, how many members have the verified role, and how many still have the unverified role.

## Permissions

- **Manage Roles**, with Number One's role above both the verified and unverified roles.
- **View Channel**, **Send Messages** and **Embed Links** in the rules channel.
