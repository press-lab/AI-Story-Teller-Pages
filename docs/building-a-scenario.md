# Building a Scenario

The hands-on recipe for authoring an adventure that runs long and well. This is
the *how*; for the *why* behind every choice, read
[`adventure-design.md`](./adventure-design.md). The worked example throughout is
the dev scenario **Heir of the Dragon Throne**
([`src/dev/developmentAdventure.ts`](../src/dev/developmentAdventure.ts)) — copy
its shape.

> **Model first.** Author and play these on **DeepSeek V3.2 (`deepseek-chat`)**
> or better. The whole design assumes a model that honours long rule blocks and
> voice contracts and will *spend the cost* at a climax. Flash-tier models skim
> the prompt, fake the stakes, and ignore the length target — the scenario will
> feel broken through no fault of the setup.

---

## The shape of a scenario

A scenario is six things working together:

| Piece | Component / object | Job |
|---|---|---|
| **Current truth + premise** | Plot Essentials | What is happening now + always-on constraints |
| **The cast** | Story Cards (`character`) **+ Voice Contracts** | Who's fun in a room |
| **Interior life** | Brains | Hidden agendas that simmer and persist |
| **The engine** | a custom "missions" component | The repeatable loop that prints scenes |
| **The spine** | Current Story Arc + **Arc Director** | The conflict that climbs and breaks |
| **The hook** | Opening Scene + one-sentence Active Pressure + Author's Note | Where it starts, what is pressing now, how it sounds |

Build them in that order.

---

## If you use Generate with AI

The New Adventure generator asks for outcome choices before it drafts the setup.
Pick the result you want; the app routes the details into AI Instructions, Plot
Essentials, Active Pressure, Author's Note, Story Cards, and Brains.

| Want | Choose | What it changes |
|---|---|---|
| Open-ended exploration | Sandbox | Lighter AI Instructions, broader factions/locations, looser hooks, lean PE |
| Jobs and team fallout | Mission loop | A custom loop component, current assignment pressure, team/enemy cards |
| Investigation | Mystery | Current known question in PE, clues/suspects/secrets on cards, no early answer |
| Power games | Faction politics | Public pressure in PE, faction leverage and secrets on cards |
| Relationship heat | Romance drama | Choice-driven tension, living relationship cards/Brains, no forced commitment |
| Danger and dread | Survival / horror | Threat rules, scarcity, safe places, active pressure, consequences |

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
Story Cards or Brains, not in PE.

---

## Step 1 — The spine (backdrop, fantasy, premise)

Pick a **backdrop you actually want to live in** and a **power fantasy you
enjoy**. Decide the one-line premise *and* the slow-burn arc it builds toward.

*Heir of the Dragon Throne:* post-war Avatar world (backdrop), an overpowered
dragon-fire crown prince (fantasy), and a premise where the antagonist is
**personal and convergent** — the conspiracy is run by the love interest's
father. Write this into **Plot Essentials** (always-on, protected) as the
current operating truth: what is happening now, open tensions, obligations, and
major constraints that must shape every scene. Keep it tight; this is what the
model writes *toward*.

Two rules from experience:
- **Let the player be OP.** State it in AI Instructions: *"NPCs respect, fear,
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
  recurring subject.** Otherwise keep the fact on the character cards/brains.
  Do not make vague "Dynamic between X and Y" cards with both character names as
  broad triggers.
- **Pick the memory mode.** `static` = always-true present-tense facts,
  `living` = current evolving subject whose updates merge/archive, and
  `historical` = completed event or retired Plot Essentials fact in past tense.
- **Keep triggers narrow.** Character aliases belong on the character's identity
  card. Event, relationship, or subplot cards should use specific consequences,
  objects, locations, factions, or case names instead of broad character names.

The **"Draft a Story Card with AI"** builder and the in-play detector now emit
voice contracts for character cards automatically — so cards you mint mid-game
match. But hand-author the core cast for control.

---

## Step 3 — Brains: interior life that simmers

Give a Brain to every **major** player (protagonist's inner circle + the
antagonist). Not to every walk-on — major characters only. A Brain is private
narrator-only interior state that **accumulates** (thoughts append, they don't
overwrite).

Write brains **behavioral, not adjectival**, and — the lesson that made *Heir*
click — **preload each NPC's hidden agenda as starting thoughts so the story is
legible from turn one.** The player can read the Brains panel and immediately
understand what's really going on:

- *Lord Renzan:* `"The armory was a message, not a theft. Let the Fire Lord chase
  shadows while the real work moves. Nothing leads back to me."`
- *Mai:* `"Three shipments of 'ceremonial' steel rerouted through a
  Renzan-friendly broker. I haven't told Zuko yet."`
- *Nyxa:* `"My father wants the throne and I want Setu, and I'm not sure those are
  different wishes."`

Keep the **protagonist's** brain light — the player drives him. Give the
**antagonist** a rich brain: it's the will that drives the arc's simmer.

The **"Generate from name"** button on the Brains page drafts a behavioral brain
from just a name (it produces a brain, not a card — pair it with a character card
for the voice contract).

---

## Step 3.5 — Active Pressure: one sentence of now

Active Pressure is not a second plot summary. It is the single external force
pressing on the player character right now: the deadline, pursuit, debt, failing
system, public challenge, or visible consequence that keeps the next response
from floating.

Write it as exactly one sentence. If you need more than that, the durable part
belongs in Plot Essentials, the climbing part belongs in Current Story Arc, and
the live next beat belongs in Recent Messages or Next Output Bias.

Good:

```
The Fire Lord's messenger has arrived with news of another New Ozai Society strike, forcing Setu to leave training and answer the crisis now.
```

Bad:

```
Setu feels torn between duty, Nyxa, and the burden of being the Dragon's Heir.
```

That second one is emotion and theme. It can be true, but it is not pressure.

---

## Step 4 — The engine: a mission-loop component

Add one always-on `custom` component that defines the **repeatable loop** — the
thing that prints the next scene without you writing plot. From *Heir*'s "The
Crown's Missions":

> A job comes down → the player and crew run it → fallout is processed back home
> through banter, rivalry, romance, training, court politics → someone levels up,
> makes an enemy, or learns something → the next job arrives. **Always leave a new
> job, complication, or loose thread on the table when a scene resolves.** Let
> missions bleed fragments of the larger conspiracy into view over time.

The test of a good loop: **does each phase manufacture the input to the next?**
If yes, it runs forever. Add a dispatcher figure (a handler who hands down jobs)
so the loop has an in-world source.

---

## Step 5 — The spine: the Arc Director

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
mid-session steering wheel if a character drifts.

Set the **response length** to a target (slider on the Play page) — V3.2 writes
*to* it, so 300–500 gives substantive beats.

---

## Step 7 — Run it

- The arc **climbs on what you keep touching** — lean into the conspiracy thread
  and it builds; ignore it and it stays background.
- When you reach the real confrontation, **Arc Director → "Spring it now."** The
  cost instruction enters context and the model lands the climax with stakes.
  ("Reset to simmer" pulls it back if you sprang early.)
- After the break resolves (aftermath), the Director **drafts next-arc directions
  and offers them in the Arc Director.** Pick one → the finished arc is **banked
  as a Story Card** and the next arc seeds, simmering. That's how the story
  self-continues — a stranger never becomes the next villain; a surviving thread
  is promoted (e.g. *Azula takes the leaderless Society*).
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

- [ ] Backdrop you like + OP fantasy stated in AI Instructions.
- [ ] Plot Essentials: tight current operating truth, antagonist
      personal/convergent, no chronological log.
- [ ] Active Pressure: exactly one sentence naming the external force pressing
      right now.
- [ ] One `character` card per recurring figure; **Voice Contract on every NPC**,
      none on the PC; canon voices accurate; formal + nickname noted; memory
      mode and triggers chosen deliberately.
- [ ] Brains for the inner circle + antagonist; behavioral; **hidden agendas
      preloaded** so the story reads from turn one; PC brain light.
- [ ] A mission-loop component whose phases feed each other; a dispatcher figure.
- [ ] Current Story Arc + Arc Director: baddie threads, simmer + cost
      instructions, sensible pace, **Ask** mode, **starts simmering**.
- [ ] Opening scene = backdrop + power + relationship + hook.
- [ ] Author's Note for tone; response length set as a target.
- [ ] Running on DeepSeek V3.2 or better.
