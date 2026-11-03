# Polls

**Category:** 🎉 Engagement & Fun · **Recommended:** yes

Ask your server a question with up to 10 answers. Members vote with buttons, the results update live, and Number One posts the winner when the poll ends.

## Quick setup

1. Switch on **Polls** on the dashboard.
2. Click **New poll**, write the question and answers, and pick a channel.
3. Click **Post poll**.

Or type `/poll create` in Discord, like `/poll create question: What should we play? answers: Minecraft | Among Us | Fortnite`.

## Poll options

| Option | Notes |
| --- | --- |
| Question and details | The question is the poll's title. Details are optional and show under it. |
| Answers | 2 to 10, up to 80 characters each. Each one gets its own button. |
| Stays open for | From 1 hour to 2 weeks, or until someone ends it. |
| Allow more than one answer | Off by default, so members pick one. |
| Anonymous | On by default: nobody, not even staff, sees who voted for what. Turn it off to list voters under each answer. |
| Hide results until it ends | Members only see the results once the poll closes. |
| Who can vote | Only members with one of the roles you pick. Everyone, if you pick none. |
| Ping | None, @everyone, @here or chosen roles, sent once when it's posted (dashboard only). |

## Voting

- Press an answer to vote. Only you see the confirmation.
- Press it again to take your vote back.
- In a one-answer poll, pressing another answer changes your vote.
- The bars on the poll update every couple of seconds.

## When a poll ends

A poll ends at its end time, when someone presses **End now** on the dashboard, or with `/poll end`. Its buttons are removed, the winning answer gets a 🏆, and Number One replies with the result (you can switch this reply off in the settings). Deleting the poll message also ends the poll.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Who can use /poll create | Staff only | Staff means anyone with **Manage Messages**. You can also allow everyone, or chosen roles. |
| How long /poll polls stay open | 1 day | Used when nobody picks a duration. |
| Post the result when a poll ends | On | Replies to the poll with the winner. |

## Managing polls

The dashboard lists open polls and the last 20 ended ones, with live results. You can **open**, **copy**, **end** or **delete** any poll, and see who voted on polls that aren't anonymous. Up to 50 open polls per server.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/poll create question answers [duration] [multiple] [anonymous] [hide_results] [channel]` | See settings | Posts a poll. Split answers with `\|`. |
| `/poll end poll` | Who made it, or staff | Ends a poll now and posts the result. |

## Permissions

- **View Channel**, **Send Messages** and **Embed Links** in the poll channel.
- **Mention @everyone, @here and All Roles** for those pings.
