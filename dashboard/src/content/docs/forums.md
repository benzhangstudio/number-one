# Forums

**Category:** 🛠️ Utilities & Automation · **Recommended:** yes

Manage your server's forum channels from the dashboard: create forums, set their tags and guidelines, and pin, lock, close or delete posts. Number One can also welcome new posts, let people mark posts as solved, and close posts that have gone quiet.

Forum channels need Discord's **Community** features switched on. You can turn them on in [Community tools](/docs/community-tools).

## Quick setup

1. Switch on **Forums** on the dashboard.
2. Click **New forum**, or press **Manage** on a forum you already have.
3. Set up its tags and guidelines, then pick its helpers.

## Posts

Each forum lists its open posts, with pinned posts first, followed by the 10 most recently closed ones. For each post you can see who made it, its tags, how many messages it has and when it was last active.

| Action | What it does |
| --- | --- |
| Pin / Unpin | Keeps the post at the top of the forum. One pinned post per forum. |
| Lock / Unlock | Only staff can reply while it's locked. |
| Close / Reopen | Closes the post. Anyone can reopen it by sending a message. |
| Delete | Deletes the post and all its messages. |

## Forum settings

These are saved in Discord itself, so they're the same as in Discord's own settings.

| Setting | Notes |
| --- | --- |
| Name and category | Where the forum sits in your channel list. |
| Post guidelines | Shown at the top of the forum, up to 4,096 characters. |
| Tags | Up to 20, each with an emoji. **Staff only** tags can only be added by staff. |
| Require a tag | People must pick at least one tag when posting. |
| Default reaction | Shown under every post for a quick reaction. |
| Sort posts by | Recent activity or newest first. |
| Layout | List, or gallery for picture-heavy forums. |
| Wait between new posts | Slowmode for new posts, per member. |
| Hide quiet posts after | Discord tucks quiet posts away after 1 hour, 1 day, 3 days or 1 week. |

New forums start with Question, Idea and Solved tags, which you can change before creating.

## Number One helpers

Set per forum, under **Number One helpers**.

| Helper | Default | What it does |
| --- | --- | --- |
| 👋 Welcome new posts | Off | Number One replies in every new post with your message. `{user}` mentions whoever made the post. |
| ✅ /post solved | On | The person who made the post, or staff, can mark it as solved. It gets a **Solved** tag, which is made for you if the forum doesn't have one. |
| Close once solved | On | Closes the post after it's marked as solved. |
| 💤 Close quiet posts | Never | Closes posts with no new messages for 1 to 30 days, with a short note. Pinned posts stay open. |

## Commands

Used inside a forum post.

| Command | Who | What it does |
| --- | --- | --- |
| `/post solved` | Who made the post, or staff | Adds the Solved tag, and closes the post if that's switched on. |
| `/post close` | Who made the post, or staff | Closes the post. |
| `/post lock` / `/post unlock` | Staff | Locks or unlocks the post. |
| `/post pin` / `/post unpin` | Staff | Pins or unpins the post. |

Staff means anyone with **Manage Threads** in the forum.

## Permissions

- **Manage Channels** to create and edit forums and to add the Solved tag.
- **Manage Threads** to pin, lock, close, reopen and tag posts.
- **Send Messages in Threads** for welcome messages and quiet-post notes.
