# Tickets

**Category:** 🛠️ Utilities & Automation · **Recommended:** yes

Members open a private channel with your staff team from a **ticket panel**: a message with buttons or a dropdown. Staff can claim tickets, add people, and close them with a saved transcript.

## Quick setup

1. Switch on **Tickets** on the dashboard.
2. Pick your **staff roles**, a **category** for tickets and a **log channel**.
3. Click **New panel**, pick a channel and add at least one ticket type (like "Support").
4. Click **Save**. The panel is posted.

## Panels

A panel is the message members use to open tickets.

| Part | Default | Notes |
| --- | --- | --- |
| Title | 🎫 Need help? | Up to 256 characters. |
| Description | Press a button below to open a private ticket with the staff team. | Up to 4,000 characters. |
| Colour and image | Pink, no image | |
| Style | Buttons | **Buttons** (one per type) or **one dropdown** menu. |
| Dropdown placeholder | Pick a ticket type… | Only for the dropdown style. |
| Ticket types | | 1 to 10 per panel. |

- Up to **10 panels** per server, for example one for support and one for applications.
- Saving updates the panel in place. Picking another channel moves it.

## Ticket types

Each type is one button or dropdown option, like "Support", "Report a member" or "Partnership".

| Setting | Default | Notes |
| --- | --- | --- |
| Name | | Up to 80 characters. |
| Emoji | None | A standard emoji or one of your server's. |
| Button colour | Blurple | Or a description for the dropdown style. |
| Channel name start | ticket | `support` makes channels like `support-0001`. |
| Category | Server default | Opens this type's tickets in a different category. |
| Extra staff roles | None | Up to 10 roles that see this type only, on top of the main staff. |
| First message | Thanks for reaching out, {user}! … | Up to 2,000 characters. |
| Starter form | Off | Up to 5 questions the opener answers inside their new ticket. See below. |

### Starter form

Each ticket type can have its own form, like "Who are you reporting?" and "What happened?" for a Report type.

| Setting | Default | Notes |
| --- | --- | --- |
| Form title | Tell us about your ticket | Shown at the top of the pop-up. Up to 45 characters. |
| Questions | One: "What do you need help with?" | 1 to 5. Each has a label (up to 45 characters), a **short** (one line) or **long** (paragraph) answer, an optional hint and a **Required** tick box. |
| Lock the ticket until the form is sent | Off | The opener can read the ticket but can't type or upload until they send the form. Staff can always type. |

How it works:

1. When the ticket opens, the first message **mentions the opener** and has a **Fill in the form** button.
2. Only the opener can press it. The form opens as a pop-up.
3. When they send it, the answers are posted in the ticket as **Answers from @opener** (without pinging them again). The button goes away, and if the ticket was locked, the opener can now type.
4. The answers are kept with the ticket: shown on the dashboard's ticket list and included in the transcript.

Editing a form later doesn't change tickets that are already open. Ticket types that used the old "Ask a question first" option now have a one-question starter form.

### Placeholders for the first message

| Placeholder | Becomes |
| --- | --- |
| `{user}` | A mention of the member |
| `{username}` | Their username |
| `{server}` | The server's name |
| `{type}` | The ticket type's name |
| `{number}` | The ticket's number |

## Server-wide settings

| Setting | Default | Notes |
| --- | --- | --- |
| Staff roles | None | Up to 10 roles that see and handle every ticket. People with **Manage Channels** always can. |
| Category | None | Where new tickets go. None = the top of the channel list. |
| Log channel | None | Where opened and closed tickets are logged, with transcripts. |
| Open tickets per member | 1 | 1 to 5. |
| Channel names | Numbers | `support-0001` or `support-username`. |
| Ping staff | On | Mentions the staff roles in each new ticket. |
| Members can close their own | On | Lets the opener close their ticket. |
| DM the transcript | Off | Sends the member the transcript when their ticket closes. |

## Opening a ticket

When a member presses a button (or picks from the dropdown), Number One:

1. Creates a channel like `ticket-0001`, visible **only** to the member, the staff roles and Number One.
2. Posts the first message and pins it, mentioning the opener, with **Close** and **Claim** buttons (and **Fill in the form** if the type has a starter form).
3. Pings the staff roles (if switched on) and logs it.

Double-clicks never open two tickets, and members can't go over the open-ticket limit.

## Handling a ticket

| Action | Who | What it does |
| --- | --- | --- |
| **Claim** button | Staff | Shows which staff member is handling the ticket. |
| `/ticket add member` | Staff | Lets someone else see and talk in the ticket. |
| `/ticket remove member` | Staff | Removes someone who was added. |
| **Close** button or `/ticket close [reason]` | Staff, or the opener if allowed | Closes the ticket. |

## Closing a ticket

1. Number One asks to confirm.
2. A transcript file (the last 1,000 messages) is posted to the log channel, and DMed to the member if switched on.
3. The channel is deleted after 5 seconds.

If a ticket channel is deleted by hand, the ticket is marked closed.

## The dashboard

Lists the 50 most recent tickets, open and closed, with who opened, claimed and closed each one, and their form answers.

## Switching it off

Switching the module off takes panels down, but open tickets stay so conversations aren't lost. Switching it back on posts the panels again.

## Permissions

- **Manage Channels** to create and delete ticket channels.
- **View Channel**, **Send Messages** and **Embed Links** in the panel and log channels.
- **Attach Files** in the log channel for transcripts.
