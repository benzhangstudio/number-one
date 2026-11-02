# Reaction roles

**Category:** 🎭 Roles Management · **Recommended:** yes

Role menus that let members pick their own roles: colours, pronouns, games, ping opt-ins and more. Members pick with an emoji reaction, a button or a dropdown, and Number One gives or takes the role straight away. Managed entirely from the dashboard.

## Quick setup

1. Switch on **Reaction roles** on the dashboard.
2. Click **New role menu**. Start blank or from a template (Number One picks your existing roles whose names match).
3. Pick a channel, a style and a mode, then add a row for each role.
4. Click **Save**. Number One posts the menu.

## Styles

| Style | Most roles | How members pick |
| --- | --- | --- |
| Emoji reactions | 20 | React with an emoji. Removing the reaction undoes it. |
| Buttons | 25 | A button for each role, with its own label, emoji and colour. |
| Dropdown menu | 25 | One menu listing every role. Tidy for long lists. |

Each row has a role plus:

- **Emoji:** required for reactions, optional for buttons and dropdowns. Pick from the server's custom emojis or common emojis.
- **Label:** the button text or dropdown option name. Defaults to the role's name.
- **Description:** small grey text under a dropdown option.
- **Button colour:** blurple, grey, green or red.

Rows can be reordered. Roles the bot can't give (at or above its own role) are greyed out.

## Modes

| Mode | Styles | What picking does |
| --- | --- | --- |
| Normal | All | Pick to get a role, un-pick to lose it. Members can have several. |
| One only | All | Members can hold just one role from this menu. Picking another swaps it (and clears the old reaction). |
| Verify (add only) | All | Picking gives the role. Un-picking doesn't remove it. Good for accepting rules. |
| Remove only | All | Picking **removes** the role. Lets members leave a role on their own. |
| Reversed | Reactions | Reacting removes the role, un-reacting gives it back. Good for opt-out pings. |
| Permanent choice | All | Members pick once and can't change it. Staff can still change roles by hand. |

## The message

- **Text above the embed:** up to 2,000 characters.
- **Embed:** title, description, colour, image and footer.
- **List roles:** adds an "emoji @Role" line for each role under the description (on by default).
- **Dropdown placeholder:** the grey text shown before anything is picked.
- **Internal name:** shown only on the dashboard, to tell menus apart.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| Most roles | No limit | Most roles a member can hold from this menu (Normal mode). |
| Allowed roles | Everyone | Members need at least one of these roles to use the menu. |
| Ignored roles | None | Members with any of these roles can't use the menu. |
| Remove reaction after use | Off | Reactions only. Takes the member's reaction away, so reacting again toggles the role. |
| Confirm privately | On | Buttons and dropdowns. Tells the member privately what changed. |
| Temporary roles | Forever | Takes roles from this menu away again after 10 minutes up to 30 days. |

## Using an existing message

Instead of posting a new menu, you can paste the link to **any message** in your server and Number One adds emoji reactions to it. The message's own text isn't changed. This only works with emoji reactions.

## Managing menus

- **Edit** a menu any time. Changing the channel reposts it there.
- **Duplicate** a menu to make a similar one quickly.
- **Delete** removes the menu, and its message if Number One posted it.
- Up to 50 role menus per server.

## Reliability

- Number One adds the reactions itself and keeps working on old menus after restarts.
- Bot reactions are ignored. Custom emojis are supported.
- If someone clears the reactions on a menu, the bot puts its own back.
- When a menu's message, its channel or one of its roles is deleted, the menu is cleaned up automatically.
- Temporary role timers are saved, so roles are still taken away on time after a restart.

## Permissions

- **Manage Roles**, with Number One's role above every role in the menu.
- In the channel: **View Channel**, **Send Messages**, **Embed Links**, **Add Reactions** and **Read Message History**.
- Admins can only set up roles below their own highest role.

Problems are explained when you save.
