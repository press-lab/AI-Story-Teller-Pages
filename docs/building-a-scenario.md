# Building a Scenario

Authoring reference: [Fact ownership and overlap audit](./fact-ownership.md).

The hands-on recipe for authoring an adventure that runs long and well. This is
the *how*; for the *why* behind every choice, read
[`adventure-design.md`](./adventure-design.md). The worked example throughout is
the dev scenario **Heir of the Dragon Throne**
([`src/dev/developmentAdventure.ts`](../src/dev/developmentAdventure.ts)) — study
its shape as a worked example. Its authored Arc Director is optional; the current
default is a designated Play Loop plus post-generation story-state evaluation.
See [Story-led progression and canon reconciliation](./story-director.md).

> **Model first.** Author and play these on **DeepSeek V3.2 (`deepseek-chat`)**
> or better. The whole design assumes a model that honours long rule blocks and
> voice contracts and will *spend the cost* at a climax. Flash-tier models skim
> the prompt, fake the stakes, and ignore the length target — the scenario will
> feel broken through no fault of the setup.

---

## The shape of a scenario

A scenario draws on these parts as needed:

| Piece | Component / object | Job |
|---|---|---|
| **Current truth + premise** | Plot Essentials | What is happening now + always-on constraints |
| **The cast** | Story Cards (`character`) **+ Voice Contracts** | Who's fun in a room |
| **Interior life** | Brains | Event-specific thoughts, reactions, and situational intentions |
| **The engine** | the designated Play Loop custom component | Ordinary sandbox rhythm, temporarily omitted during earned progression or closure |
| **The active thread** | Current Story Arc when used | The larger conflict actually underway and its current consequences |
| **Optional authored pacing** | Arc Director on Current Story Arc | A separately authored simmer/break instruction for scenarios that want it |
| **The hook** | Opening Scene + Author's Note | Where it starts, what is pressing now, how it sounds |

Build only the pieces the scenario needs. A dormant possibility does not need an
active Current Story Arc or an Arc Director. Active Pressure is a separate older
compatibility component for immediate pressure, not an active-thread owner.

---

## If you use Generate with AI

The New Adventure generator asks for outcome choices before it drafts the setup.
Pick the result you want; the app routes the details into AI Instructions, Plot
Essentials, Author's Note, Story Cards, and Brains.

| Want | Choose | What it changes |
|---|---|---|
| Open-ended exploration | Sandbox | Lighter AI Instructions, broader factions/locations, looser hooks, lean PE |
| Jobs and team fallout | Mission loop | Tailor the existing Play Loop after creation; place current truth where nearly always needed and team/enemy facts on cards |
| Investigation | Mystery | Current known question in PE only when nearly always needed, clues/suspects/secrets on cards, earned answers allowed |
| Power games | Faction politics | Public pressure in PE, faction leverage and secrets on cards |
| Relationship heat | Romance drama | Choice-driven tension, one relationship owner plus event-specific Brain reactions, no forced commitment |
| Danger and dread | Survival / horror | Threat rules, scarcity, safe places, consequences |

Prose mode is separate from story shape. Minimalist is fast and lean; novelistic
is richer and slower; cinematic focuses on visible action and blocking;
dialogue-heavy prioritizes voice, interruption, and social pressure.

Player control is also separate. Strict control means the model never writes the
player character's words, thoughts, actions, choices, or reactions. Minor-action
mode lets it bridge tiny implied motions. Cinematic flow lets it write small
player-character beats while keeping major choices player-owned.

Adult / NSFW setup is explicit opt-in. "Romance only" keeps attraction and
intimacy without explicit adult content. "Explicit adult opt-in" adds a separate
adult-content section, consenting-adult framing, and any boundaries you type. Do
not mix adult preferences into generic prose rules; keep them visible and
separable.

The generator should still keep Plot Essentials tight. Relationship trackers,
voice guides, quest logs, secrets, and recurring locations usually belong in
the appropriate Story Card, enrolled relationship state, or event-specific Brain thoughts, not in PE. Review generated setup against the ownership reference; generators do not enforce every boundary.

---

## Step 1 — The spine (backdrop, fantasy, premise)

Pick a **backdrop you actually want to live in** and a **power fantasy you
enjoy**. Decide the one-line premise *and* the slow-burn arc it builds toward.

*Heir of the Dragon Throne:* post-war Avatar world (backdrop), an overpowered
dragon-fire crown prince (fantasy), and a premise where the antagonist is
**personal and convergent** — the conspiracy is run by the love interest's
father. Give **Plot Essentials** only the premise and compact operating truth
needed in nearly every plausible next response. Put the conspiracy's active
progress in **Current Story Arc**, character secrets and power mechanics on
their character cards, and faction lore on its own card. Importance alone
does not justify repeating those facts in PE.

Two rules from experience:
- **Let the player be OP.** State the behavioral rule once in Narration Rules or optional AI Instructions: *"NPCs respect, fear,
  court, and test his power — do not nerf him. Stakes are political, social, and
  personal, not a power-level problem."* The cost lands in the arc, never on the
  player's competence.
- **Make the antagonist personal.** A conspiracy run by a stranger is forgettable;
  one run by your lover's father is an arc.

---

## Step 2 — The cast: Story Cards + Voice Contracts

One `character` Story Card per named figure who recurs. Bullet the durable facts
(role, appearance, allegiance, what they want), then **append a VOICE CONTRACT to
every non-player character.** This is the single biggest quality lever.

```
VOICE CONTRACT
Rhythm: how they speak — pace, sentence structure
Default move: what they reach for under pressure
Emotional defense: how they deflect or armor up
Never sounds like: what to avoid — generic, "I feel…", offering choices
Example lines: "…" / "…" / "…"
```

The **Example lines are load-bearing** — two to four real quotes in their voice.
They give the model something to *match* instead of *interpret*, and they hold
the voice steady across hundreds of turns. Trait lists ("sarcastic, loyal") get
flattened into helpful-assistant prose; example lines don't.

Rules learned the hard way:
- **Every NPC gets one. The player character gets none** — the model never writes
  the player's lines, and a PC contract just tempts it to.
- **Get canon voices right.** For known characters, write lines that actually
  sound like them (Toph: *"Well, if it isn't the royal hotpants."*; Mai: *"Wow.
  I'm thrilled."*).
- **Naming:** give a formal name and an intimate nickname, and say which is which
  on the card — e.g. *"Formally Lady Nyxa or Lady Renzan; called Nyx by those
  close to her."* Use the correct in-world title.
- **Relationship cards are living cards only when the relationship is its own
  recurring subject.** Otherwise choose one character card as the fact's owner. Enrolled directional
  relationship state owns the mutable pair facts it tracks; do not duplicate
  those on cards or in freeform thoughts.
  Do not make vague "Dynamic between X and Y" cards with both character names as
  broad triggers.
- **Pick the memory mode.** `static` = relatively stable present-tense facts (still revisable),
  `living` = current evolving subject whose updates merge/archive, and
  `historical` = useful completed events and consequences in past tense.
  Removing a PE assertion alone does not establish an event.
- **Keep triggers narrow.** Character aliases belong on the character's identity
  card. Event, relationship, or subplot cards should use specific consequences,
  objects, locations, factions, or case names instead of broad character names.

The **"Draft a Story Card with AI"** builder and the in-play detector now emit
voice contracts for character cards automatically — so cards you mint mid-game
match. But hand-author the core cast for control.

---

## Step 3 — Brains: event-specific interior responses

Give an opt-in Brain to major characters whose reactions matter. Keep identity,
enduring wants, values, beliefs, fears, motivations, secrets, and Voice Contract
on the character card. Seed only responses to the opening's actual circumstances:

- Lord Renzan: “Tonight's inspection may expose the broker. I need to divert it.”
- Mai: “Those three shipments look suspicious; I intend to ask about the broker.”
- Nyxa: “After that summons, I am unsure what my father expects me to say.”

These are interpretations and situational intentions, not proof of the underlying
facts. A durable ambition belongs on the card even if it is hidden. Brain thoughts
accumulate, are validated and may be condensed/archived; older thoughts are not
necessarily current beliefs. Use the reference's psychology/relationship example.

Keep the protagonist's Brain light and respect player-owned thoughts and choices.
“Generate from name” can draft broader material than this boundary recommends;
review the draft and put durable characterization on its character card. This
is authoring guidance, not a change to the generator or an automatic promotion rule.

---

## Step 4 — The engine: tailor the existing Play Loop when useful

New adventures already have a designated Play Loop custom component. Its normal
sandbox behavior can be tailored for a mission-oriented scenario. An older
version of *Heir* used the following always-on "The Crown's Missions" block:

> A job comes down → the player and crew run it → fallout is processed back home
> through banter, rivalry, romance, training, court politics → someone levels up,
> makes an enemy, or learns something → another assignment may arrive. Let
> missions occasionally expose fragments of the larger conspiracy.

The test of a useful mission rhythm is whether ordinary scenes remain enjoyable
between major developments. Tailor the existing designated Play Loop in Components
if a dispatcher or recurring assignment cycle helps the scenario. Do not create
a second always-on loop or require a new job after every resolution. Keep
assignments, profiles, and active-thread state with their respective owners.

---

## Step 5 — Optional active thread and authored Arc Director

Current Story Arc can hold the active larger thread. The post-story evaluator
can suspend the Play Loop on earned progression or closure and reconcile its
current state after accepted events. No authored phase, timer, or next beat is
required. The following Arc Director setup is an optional approach used by the
worked example; its deterministic engagement count remains separate from the
semantic story-state evaluator.

On a **Current Story Arc** component, open the Arc Director and set:

- **The Baddie** — the Story Cards / Brains that are this arc's threads (the
  antagonist + their faction; optionally a wildcard). *Heir:* the New Ozai
  Society, House Renzan, Lord Renzan, Azula.
- **The Cost (break instruction)** — what the climax costs. *"The antagonist
  forces a confrontation that can't be deferred. Allowed to cost the cast — a
  named ally can die, loyalties tested. The player stays the strongest; the win
  is just expensive. No clean victory."* This is withheld from the model until
  the break phase.
- **The simmer instruction** — how the threat behaves while building: *"Stay
  off-screen. Surface through sabotage, intercepted orders, a masked agent who
  slips away, near-misses. Connect every move to a larger plan. Do not confront
  head-on yet — hint, recur, tighten."*
- **The Timer (pace)** and **Who springs it (trigger mode).**

**Pace reality check.** "Engagement" counts only the turns a thread actually
surfaces, not every turn — but the buckets are still tuned for normal sessions
(`epic` = break at 60 engagement). If you play thousands of turns per arc, that's
small. On **Ask** mode it barely matters: you ignore the meter and hit **"Spring
it now"** when the story is ripe. Use **Ask** for anything you're savouring;
**Auto** only if you want it to fire itself.

**Start it simmering.** Default the arc to the `simmer` phase with no preloaded
engagement so the conspiracy stays background and the loop runs in front. (The
dev scenario was briefly preloaded mid-climb *for feature testing* — that made it
race; the shipped version starts simmering. Don't ship a preloaded climb.)

---

## Step 6 — The hook: opening scene + author's note

Write an **Opening Scene** that does four jobs at once: establishes the backdrop,
shows the OP fantasy, introduces the central relationship, and drops the inciting
thread. *Heir* opens on the prince out-bending everyone, bantering with Nyxa,
then a summons about a New Ozai strike — world, power, romance, and hook in one
beat.

Set an **Author's Note** for tone (it loads near the recent messages, highest
steering weight): *"Blockbuster-sequel energy… keep the larger story serious, but
outside danger let the cast be sharp, funny, human."* Use it later as your
mid-session steering wheel if narration drifts. It persists until edited;
clear resolved direction and keep durable character traits on the card. Use
Next Output Bias for steering that normally expires after one successful generation.

Set the **response length** to a target (slider on the Play page) — V3.2 writes
*to* it, so 300–500 gives substantive beats.

---

## Step 7 — Run it

- In default play, a dormant thread can stay background indefinitely. Material
  investigation or confrontation can shift the post-story director into
  progression or closure without predetermining the next scene or answer.
- If using the optional authored Arc Director, its selected-card engagements
  advance its phase independently of the post-story semantic decision.
- With the authored Arc Director, when you reach the real confrontation, **Arc Director → "Spring it now."** The
  cost instruction enters context and the model lands the climax with stakes.
  ("Reset to simmer" pulls it back if you sprang early.)
- After an authored break resolves (aftermath), the Arc Director **drafts next-arc directions
  and offers them in the Arc Director.** Pick one → the finished arc is **banked
  as a Story Card** and the next arc seeds, simmering. That's how the story
  can continue when you choose. A resolved plot does not require a replacement;
  ordinary sandbox play can resume. If you want another authored arc, a surviving
  thread can be promoted (e.g. *Azula takes the leaderless Society*).
- Bank completed arcs with **"Complete Arc → Story Card"** (the next-arc chooser
  does this for you automatically).

---

## Anti-patterns (don't)

- **The coffin.** Forty inert lore/location cards. Keep the cast tight; latent
  background is fine but it isn't structure.
- **Adjectival characters.** "Reckless and funny" instead of a voice contract.
- **PC voice contract.** Tempts the model to write the player.
- **Shipping a preloaded climb.** Start simmering.
- **Tiny pace for a long player.** Bump it, or spring manually on Ask.
- **A stranger as the next big bad.** Promote a seeded, surviving thread —
  convergence, not novelty.
- **Flash-tier model.** It will fake the climax and ignore the rules.

---

## Quick checklist

- [ ] Backdrop you like; power facts on the character card; capability-preservation rule written once.
- [ ] Plot Essentials: tight operating truth needed nearly every response; no copied profiles or chronological log.
- [ ] One `character` card per recurring figure; **Voice Contract on every NPC**,
      none on the PC; canon voices accurate; formal + nickname noted; memory
      mode and triggers chosen deliberately.
- [ ] Brains for major characters: event-specific reactions and situational intentions; durable agendas stay on cards; PC brain respects player control.
- [ ] Run the [ownership overlap audit](./fact-ownership.md#overlap-audit), including enrolled relationship state and duplicate behavior rules.
- [ ] The existing designated Play Loop preserves enjoyable ordinary play; tailor it only if a mission rhythm helps.
- [ ] Current Story Arc for an active larger thread when needed; optional Arc Director only if authored simmer/break pacing is desired.
- [ ] Opening scene = backdrop + power + relationship + hook.
- [ ] Author's Note for tone; response length set as a target.
- [ ] Running on DeepSeek V3.2 or better.
