# Member onboarding

**Category:** 👥 Community Settings · **Recommended:** yes

Discord-style onboarding **without turning on Community settings**. Give new members roles when they join, walk them through rules and questions that hand out roles, and optionally keep the server hidden until they finish. Every part is optional, so use as much or as little as you need.

## The three parts

| Part | Default | What it does |
| --- | --- | --- |
| [Join roles](#join-roles) | None | Roles given right away when someone joins. |
| [Onboarding steps](#onboarding-steps) | Off | A private walkthrough: rules, then questions that give roles. |
| [Access gate](#access-gate) | Off | Hides the server until members finish onboarding. Owner only. |

## Join roles

- **Join roles** are given to every new member straight away.
- **Bot roles** are given to bots that join instead. Bots skip onboarding.
- People who joined while Number One was offline get their starting roles when it's back.

## Onboarding steps

A **Start** button posted in a channel you pick opens a private walkthrough, only visible to that member:

1. **Rules:** the member reads your rules and presses **I agree**.
2. **Questions:** up to 5 questions. Each can be single or multiple choice, required or optional, and each answer can give up to 5 roles. For example "What games do you play?" with answers that give game roles.
3. **Finish:** the last step lists the roles the member will get. All roles are applied in **one update** at the end.

With no rules or questions, members just press **Finish**.

### What members see

- The Start card explains each step ("Answer 3 questions · 2 required, 1 optional"), what members get, and roughly how long it takes.
- The walkthrough shows "Step 2 of 5" with a progress bar.
- Progress is saved, so members resume where they left off, even after restarts.
- Members can come back later and change their answers.

## Access gate

The access gate makes the rest of the server visible only to members who've finished onboarding. It's **owner only** because it changes channel permissions across the server.

### Setting it up

1. Pick your **staff categories**. These are never touched.
2. Pick any **whitelisted channels** that everyone should still see. They're left exactly as they are.
3. Click **Set it up for me** and confirm twice.

Number One then:

- Creates a **Start here** category with a read-only **#start-here** channel for the Start button.
- Creates a **New member** role and a **Verified** role (or uses a verified role you pick).
- Gives **Verified** to everyone already in the server, so nobody loses access.
- Makes every other channel visible only to Verified.

Finishing onboarding gives Verified, which opens the server.

### What it changes, exactly

- Only the **View Channel** permission is changed, and only for @everyone, the New member role and the Verified role.
- Channels that are already private are left alone.
- The original @everyone setting of each channel is recorded before it's changed, so it can always be restored.
- New channels follow the same rules automatically.

### Turning it off

Turning the gate off puts every channel back exactly as it was. Switching onboarding off also turns the gate's channels back to normal, so nobody is ever locked out.

### Removing members who don't finish

Optionally, members who don't finish onboarding within a set time are removed (kicked), so the server doesn't fill up with inactive accounts.

## Nobody gets stuck

- The gate can't be on without onboarding steps.
- Switching onboarding off takes the New member role off everyone still holding it.
- The dashboard warns you if a join role is **allowed** into a channel the gate hides. In Discord an allow beats a deny, so new members would still see that channel.
- The dashboard also warns if Discord's own Community onboarding is on, since the two would overlap.

## The dashboard

A live card shows members, verified members, people still at the gate, and how many joined and finished this week.

## Permissions

- **Manage Roles**, with Number One's role above every role it gives.
- **Manage Channels** for the access gate.
- **Kick Members** for removing members who don't finish.
