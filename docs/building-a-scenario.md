# Building a Scenario

The hands-on recipe for authoring an adventure that runs long and well. This is
the *how*; for the *why* behind every choice, read
[`adventure-design.md`](./adventure-design.md). The worked example throughout is
the dev scenario **Heir of the Dragon Throne**
([`src/dev/developmentAdventure.ts`](../src/dev/developmentAdventure.ts)) — copy
its shape when you want an arc-driven adventure. The arc recipe below is optional, not a requirement for sandboxes. See [shared authoring standards](../src/ai/authoringPolicy.ts) and the in-app Authoring Standards for agency, tone, cast presence, and optional narrator-only hidden rules.

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
| **Enduring premise** | Plot Essentials | Durable scenario foundations and persistent constraints |
| **The cast** | Story Cards (`character`) **+ Voice Contracts** | Who's fun in a room |
| **Interior life** | Brains | Hidden agendas that simmer and persist |
| **The engine** | a custom "missions" component | The repeatable loop that prints scenes |
| **The hook** | Opening Scene | Where it starts, what is pressing now, how it sounds |

Build them in that order.

---

## If you use Generate with AI

The New Adventure generator asks for outcome choices before it drafts the setup.
Pick the result you want; the app routes the details into AI Instructions, Plot
Essentials, named Custom components, and Story Cards. It does not generate Narration Rules or Brains.

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
enjoy**. Decide the one-line premise and, if wanted, a slow-burn arc.

*Heir of the Dragon Throne:* post-war Avatar world (backdrop), an overpowered
dragon-fire crown prince (fantasy), and a premise where the antagonist is
**personal and convergent** — the conspiracy is run by the love interest's
father. Write this into **Plot Essentials** (always-on, protected) as the
enduring premise and persistent scenario-wide constraints. NEVER include NOW,
CURRENTLY, CURRENT SITUATION, active story dates, current positions, or temporary
state. Put the starting moment in the Opening Scene. The story clock and gameplay
history handle ongoing time and continuity. Historical dates may establish durable
background. Record durable developments in Lore when appropriate.

Two rules from experience:
- **Let the player be OP.** State it in AI Instructions: *"NPCs respect, fear,
  court, and test his power — do not nerf him. Stakes are political, social, and
  personal, not a power-level problem."* The cost lands in the arc, never on the
  player's competence.
- **Make the antagonist personal.** A conspiracy run by a stranger is forgettable;
  one run by your lover's father is an arc.

---

Use AI Instructions to let NPC relationships change through credible interactions
and events, independently of the player. NPCs, factions, institutions, and
communities also act off-screen. Reveal developments through conversations,
news, rumors, encounters, or observable consequences. These developments can
stay in the background without becoming player objectives or advancing the main
story. Let their timing follow the story.

## Step 2 — The cast: Story Cards + Voice Contracts

When creating an NPC Character Card, state a personal ambition in the card content. Describe what the NPC wants to achieve independently of the player. Ground it in the NPC’s identity, circumstances, personality, and beliefs. Keep it distinct from personality traits, temporary objectives, and relationship status. Use it to guide independent decisions, activities, and character development.

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
- **Write triggers people would say.** Write Lore as a factual record. In the
  single comma-delimited trigger field, use phrases such as `our first date`,
  `first date with Kori`, or `Founder's Circle date`. Avoid artificial phrases
  such as `Kori Seth first date`. Use character names and aliases primarily on
  Character cards and place names primarily on Location cards.
- **Choose a scope that fits the card.** A concise occasion card can use
  `Thanksgiving` or `Thanksgiving 2018`. A specific event card can use
  `Thanksgiving bonfire` or `Kori meets Seth's parents`. Use the same field for
  both styles. Add an occasion card only when a shared summary is useful.
  Repeating `Thanksgiving` across every event card can load unrelated details.
- **Check actual matches.** Aim for 3–6 useful keys on new cards, up to eight.
  Try likely lines such as “Remember our first date?” and “What happened at the
  Thanksgiving bonfire?” Check which cards match and which activate by mistake.
  A line such as “When did Kori meet my parents?” may need narrator context if it
  does not match the stored keys. Prefer stable references such as
  `Thanksgiving 2018` over changing references such as `Thanksgiving last year`.

The **"Memory → Suggestions → Create suggestion with AI"** builder and the in-play detector now emit
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

## Immediate scene information

Active Pressure is retired. Use the Opening Scene for the starting moment,
Recent Messages for unfolding scenes, and Next Output Bias for one-turn steering.
Keep durable foundations in Plot Essentials.

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

## Step 5 — The hook: opening scene + author's note

Write an **Opening Scene** that does four jobs at once: establishes the backdrop,
shows the OP fantasy, introduces the central relationship, and drops the inciting
thread. *Heir* opens on the prince out-bending everyone, bantering with Nyxa,
then a summons about a New Ozai strike — world, power, romance, and hook in one
beat.

Set enduring tone in **AI Instructions**. Use **Next Output Bias** on the Play page for a short, scene-specific direction.

Set the **response length** to a target (slider on the Play page) — V3.2 writes
*to* it, so 300–500 gives substantive beats.

---

## Anti-patterns (don't)

- **The coffin.** Forty inert lore/location cards. Keep the cast tight; latent
  background is fine but it isn't structure.
- **Adjectival characters.** "Reckless and funny" instead of a voice contract.
- **PC voice contract.** Tempts the model to write the player.
- **A stranger as the next big bad.** Promote a seeded, surviving thread —
  convergence, not novelty.
- **Flash-tier model.** It will fake the climax and ignore the rules.

---

## Quick checklist

- [ ] Backdrop you like + OP fantasy stated in AI Instructions.
- [ ] Plot Essentials: enduring foundations only; no NOW or current-state anchor.
      A personal antagonist is optional, as is a central conflict.
- [ ] One `character` card per recurring figure; **Voice Contract on every NPC**,
      none on the PC; canon voices accurate; formal + nickname noted; memory
      mode and triggers chosen deliberately.
- [ ] Brains for the inner circle + antagonist; behavioral; **hidden agendas
      preloaded** so the story reads from turn one; PC brain light.
- [ ] A mission-loop component whose phases feed each other; a dispatcher figure.
- [ ] Opening scene = backdrop + power + relationship + hook.
- [ ] Enduring tone in AI Instructions and a response length target.
- [ ] Running on DeepSeek V3.2 or better.

## Tone, cast, and optional discoveries

The player controls meaningful actions, dialogue, thoughts, feelings, decisions,
and consent. Respect Strict, Minor Actions, and Cinematic Flow. Do not decide
consequential actions for the player. Honor authorized transitions, apply OOC
corrections naturally, preserve competence and knowledge boundaries, and avoid
unsolicited menus, announced decision points, manufactured misunderstandings,
apology preambles, and unnecessary meta-commentary.

NPCs have independent interests, relationships, routines, and obligations. They
can start conversations and plans. The Brakebills cottage ensemble illustrates
recurring residents sharing meals, study, and ordinary social life. Presence and
absences follow schedules and circumstances; every NPC need not join every scene.

Infer tone from explicit direction first, then identifiable source material,
then premise and language, then a coherent default. Honor alternate-universe
changes. Magicians-inspired Brakebills suggests irreverent adult humor, academic
magic, interpersonal drama, occasional danger, and complicated relationships.
Gothic horror suggests dread and consequences; a lighthearted magical school may
favor curiosity, humor, friendships, and discovery. These are examples, not templates.
AI Instructions establish enduring tone. Next Output Bias steers immediate mood during play.
Keep general narrator behavior in Narration Rules.

Optional capability handling can let player-described powers work within
established capabilities and world rules. Restrictive systems may instead use
failure, resources, and uncertainty. Neither permits arbitrary loss of earned
abilities to create difficulty.

**HIDDEN RULE — NARRATOR ONLY** is optional. Define the truth in AI Instructions.
Narration shows effects and incomplete evidence without explaining the mechanism.
Player characters and NPCs do not automatically know it. NPC theories may be
wrong, and the player may investigate, ignore, or misunderstand clues. Discovery
follows actions, experiments, and plausible events rather than turn counts.

In the Brakebills reference example, rune use changes Seth's relationship to magic;
inscriptions on his body accelerate it. Seth does not know this. He draws two
runes on his palm with an ordinary pen, feels subtle sensations, and notices
sensation after removing the ink. Historical Lore preserves the experience and
who knows it. The supplied authoring reference then describes casual browsing in
a small-town bookstore: an obscure nineteenth-century account mentions protective
inscriptions worn on the body, but dismisses them as superstition. This is evidence,
not an explanation. The narrator knows the truth. The world reveals evidence.
The player discovers the answer. Do not add a secret transformation or mystery
where the premise does not support one.

Quiet scenes need no external plot justification. Antagonists can act elsewhere;
relevant investigation, interference, or attention can bring them into play.
Frequent conflict also fits when requested. Follow scenario expectations, player
intent, and credible circumstances without mandatory encounters or artificial urgency.
