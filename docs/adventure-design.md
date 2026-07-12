# Designing a Durable Adventure

This is the distilled design theory behind AI Story Teller's arc, brain, and
component systems — what actually makes an adventure stay fun for hundreds or
thousands of turns, and how the app's features map onto it. Written from a
post-mortem of the adventures that worked (a 3,000-action supers/dispatch run,
a long-running Avatar game, a supers-academy game) and the ones that went flat.

The short version:

> **Good adventure = a backdrop you like + a socially volatile cast +
> a repeatable scene loop + an arc that climbs out of that loop and is
> allowed to *break*.** Everything else is decoration, and decoration loves
> pretending it's structure.

---

## The four pillars (in priority order)

1. **Fun social dynamics** — the motor. The cast has standing stakes with each
   other, and the loop keeps poking the same nerves. This is what stops a great
   world from decaying into strangers in a room.
2. **A repeatable scene loop** — the engine. A cycle where each phase
   *manufactures the input to the next*, so the AI never needs the player to
   become unpaid story-management staff.
3. **A backdrop you enjoy inhabiting** — the gravity. A place you *want* to
   return to. Necessary but not sufficient: a beautiful world with no loop is
   sightseeing.
4. **Light arc pressure that climbs and breaks** — the direction. Not a big
   plot you administer; an arc that grows *out of* the loop and eventually
   comes to a head.

Active Pressure is the small live version of that pressure: exactly one sentence
about the external force pressing on the player character right now. It is not a
plot summary and not the next action; durable facts live in Plot Essentials,
climbing conflict lives in Current Story Arc, and one-turn steering lives in
Next Output Bias.

Power fantasy is **not** a separate pillar and it is **not** subordinate to
social friction. If your taste is being OP and having NPCs largely accept it,
that's valid — the power is a clean flex, and the reaction-fuel comes from the
cast and the arc, not from the power causing accidents. Dial social friction up
or down to taste. The four pillars stand regardless.

---

## Social dynamics: behavioral, not adjectival

Character material must describe **what a character does in a room**, not what
they are.

- ✗ Adjectival: "Nyx is reckless and funny."
- ✓ Behavioral: "Nyx encourages Seth's worst brave ideas and expects him to
  keep up; needles anyone who hesitates."

The second one is *playable* — the model can act on it. The first is a label
the model has to guess how to perform.

This is exactly what **Brains** are for. A Brain is a character with interior
state that **accumulates** (Inner Self style — thoughts append, they don't get
overwritten) and a behavioral voice contract. The loop pokes; the Brain reacts
*with continuity*. That continuity is what makes the social dynamics *persist*
across the loop instead of resetting every scene.

> Relationships, bonds, and pacts between known characters live **on the
> characters' Brains**, never as their own standalone Story Cards. A card title
> is always the proper name of a single entity, never "Dynamic between X and Y."

### The Voice Contract

Trait lists ("sarcastic, loyal, brave") *describe* a character but don't
*demonstrate* them — the model flattens descriptions into generic helpful-
assistant prose. A **Voice Contract** demonstrates. Put one at the bottom of
every non-player character's Story Card:

```
VOICE CONTRACT
Rhythm: how they speak — pace, sentence structure
Default move: what they reach for under pressure
Emotional defense: how they deflect or armor up
Never sounds like: what to avoid — generic, "I feel…", offering choices
Example lines: "…" / "…" / "…"
```

The **Example lines** are the load-bearing part — two to four direct quotes in
the character's actual voice. They give the model something to match instead of
interpret, and they hold the voice steady across hundreds of turns. The
"Draft a Story Card with AI" builder produces this shape automatically for
character cards, and card auto-updates preserve it. Skip the contract for the
player character — the model never writes their lines.

---

## The scene loop: why it self-feeds

The loop that ran 3,000 actions looked like:

```
mission → aftermath → social scene → training → progression → next mission
```

It ran forever not because the grand plot was brilliant, but because **each
phase naturally creates the next**:

- A mission produces injuries, mistakes, wins, rivalries, reputation shifts.
- The social scene *processes* that fallout.
- Training *responds* to the failure.
- Progression *changes* the team.
- The next mission *tests* the change.

Nobody writes "what happens next" — the previous scene already did. When you
design a loop, the test is: **does each phase manufacture the input to the next
one?** If yes, it prints scenes indefinitely.

The loop is also a **thread-dropper**: every cycle leaves a thread (a rival, a
mystery, a faction). In AIST those threads already have a home — they're the
Story Cards and Brains the loop spawns anyway. That existing cast *is* the arc's
raw material. There is no separate ledger to manage.

---

## The arc: climb, then break

This is the part that kills adventures, and the failure is always the same.

**The bleed-in is easy. The break is hard.** Models are naturally good at slow,
low-commitment foreshadowing — a background antagonist "slightly showing up"
across hundreds of turns. They are structurally *bad* at the climax, because a
real climax requires four things RLHF training pushes against:

- **Commitment** — it happens and stays happened, no take-backs.
- **Loss** — named characters the player likes can die.
- **Briefly saying no to the power fantasy** — real stakes need the possibility
  of cost.
- **Stopping the deferral** — bringing it to a point instead of keeping the big
  bad a cozy perpetual background threat.

So a model will seed an arc beautifully and then *never cash it*. It keeps the
leader at arm's length forever because the confrontation risks a "bad" outcome.

### The lesson from the post-mortem

In the 3,000-action run, every authored instruction about the antagonist was a
**simmer** instruction — "appear rarely and briefly," "the hand behind
operations, not monologuing every mission," "recur through traps and hostage
plays, connected to the larger plan." That apparatus was flawless for the
build-up and ran happily for thousands of turns.

It died at the break — and it died *for a reason you could fix with a card*:
**there was no instruction that licensed the break.** Nothing said when the
antagonist stops hiding, nothing licensed the cost. So when it was time for the
confrontation, the model did exactly what it was told — kept simmering — and the
player had to seize the wheel and direct the climax by hand. That's the moment
the magic died.

### Two rules that fix it

1. **OP in the loop, costly in the climax.** Day-to-day you're the strongest and
   the cast accepts it — clean flex, that's the texture. The arc climax doesn't
   take that away; it makes victory *expensive*. You still win, you're still the
   strongest, but an ally dies, or ground is lost. The cost is paid by **the
   world and the cast, never by your competence.**
2. **The antagonist forces the timing, not a clock and not the player.** The
   climax is when the big bad finally *acts on the world* instead of lurking —
   makes a move you can't walk away from. A villain who only appears when you go
   looking will never climax. "Have this character take an aggressive action
   now" is something the model does well; "sense that the arc should peak now"
   is not.

### Convergence (the anime rule)

When something big is needed, it should **connect to what already exists** — the
new threat is related to, or a return of, an old one. Never spawn a fresh big
bad from nowhere; that reads as cheap. Big baddies in good serial fiction are
related, recur, and converge. The arc that gets promoted to "big" should be
**the thread the player keeps touching** — that makes it meaningful by
construction and convergent by nature.

---

## Pacing belongs in code, not in the prose

A break instruction written as plain standing text is fragile: it sits in
context *every turn*, the model re-evaluates it against a fuzzy condition every
turn, and — having no persistent sense of arc-time — it fires the first turn it
can rationalize. You'd get the climax at turn 30.

The fix is **not** to teach the model pacing (it can't perceive the sequence).
The fix is to **gate the context by phase**: the model literally never sees a
"break" instruction until external, deterministic state opens the gate. It can't
fire early on what isn't in context — the same reason a pure-simmer setup is
stable.

Design constraints for the pacing layer:

- **It owns timing, never outcome.** What the break costs (bloodless ↔ lethal)
  is authored in the break card's text. The pacing code only decides *when* that
  card enters context.
- **It advances on a countable signal, never an LLM verdict.** Tier climbs on
  measurable player *engagement* with a thread (how often its cards trigger),
  not on the model judging "is this dramatic yet." The moment pacing depends on
  model judgment, you've rebuilt the ledger you were trying to delete.
- **Fidelity to the cost policy is the model, not the code.** A capable model
  (DeepSeek V3.2 / `deepseek-chat`) spends the authored cost where it hurts. A
  weaker model honors the *letter* — kills a redshirt, gives a heroic wound —
  and the climax feels fake. Use V3.2 or better for any adventure that has a
  break. Flash-tier models skim long rule blocks and revert to helpfulness
  defaults; they are not suitable here.

This is what the **Arc Director** (on a Current Arc component) implements:
phases **Simmer → Escalate → Break → Aftermath**, a thread set (the "baddie"),
a pace (the "timer"), a cost (the break instruction), and a trigger mode.

---

## The two orthogonal knobs

These get conflated; keep them separate.

- **Cost policy** — *what* the break costs. Bloodless ↔ real/lethal. Authored in
  the break card. "Everyone lives" → it's so. "Heavy, real costs" → it's so.
- **Trigger control** — *who* says it fires now. **Auto** (the AI springs it
  when the gate opens) ↔ **Ask** (the app asks you first — one yes/no, not a
  ledger). The leash.

All four combinations are valid. Note **Ask + lethal** — *you* decide when the
hammer falls, but when it does, it's real — is the configuration most long
character-driven arcs actually want.

---

## After the break: the next arc

When an arc resolves (Break → Aftermath), the next arc should grow from the
**highest-engagement unresolved thread** and *connect to what just happened*
(convergence). In Auto mode the Director can promote it itself; in Ask mode it
proposes the next arc to the Memory Inbox for you to accept, edit, or reject.
You are never handed a ledger — at most a single decision.

---

## Setup checklist

For a new or existing adventure that should have a climbing arc:

- [ ] **Backdrop** you actually like inhabiting.
- [ ] **Cast as Brains**, behavioral not adjectival, relationships on the Brains.
- [ ] A **loop** where each phase manufactures the next.
- [ ] **Active Pressure** as one sentence naming the external force pressing now.
- [ ] One **Current Arc** with an Arc Director:
  - [ ] **The Baddie** — which Story Cards / Brains are this arc's threads.
  - [ ] **The Timer** — pace (Short / Medium / Long / Epic).
  - [ ] **How it simmers** — recur, hint, stay off-screen, stay connected to the
        larger plan.
  - [ ] **How it breaks** — the cost policy. OP in the loop, costly in the
        climax.
  - [ ] **Who springs it** — Auto or Ask.
- [ ] Running on **DeepSeek V3.2 (`deepseek-chat`)** or better, so the break
      actually lands.
- [ ] Pure-loop adventures: skip the arc entirely. Infinite silliness is a valid
      choice — only add pressure if you want a lead-up.

---

## Where this lives in code (for contributors)

The theory above maps onto the **Arc Director**:

- `ArcPacingState` and the `arc*` fields (`arcThreadKeys`, `arcPace`,
  `arcTriggerMode`, `arcSimmerInstruction`, `arcBreakInstruction`, `arcState`)
  on `ComponentEntry` — `src/types/adventure.ts`.
- The phase gate that withholds the break instruction until `phase === "break"`
  — the `currentArc` block in `src/contextBuilder/contextBuilder.ts`.
- `ADVANCE_ARC_PACING` (counts engagement, advances phase) and `SET_ARC_PHASE`
  (manual override / confirm a pending break), plus the pace→threshold table —
  `src/state/adventureReducer.ts`.
- The engagement signal (which threads were active in-scene this turn) —
  `src/state/turnPipeline.ts`.
- The setup panel — the `ArcDirector` component in `src/pages/ComponentsPage.tsx`.
- Concept ↔ contract for reviewers: see `AGENTS.md` → "Arc Director" for the
  invariants.

```ts
interface ArcPacingState {
  phase: "simmer" | "escalate" | "break" | "aftermath";
  tier: number;                              // 0–5, derived from engagement
  threadEngagement: Record<string, number>;  // counted, never LLM-judged
  pendingBreak: boolean;                      // ask-mode: gate open, awaiting the player
  brokeAtTurn?: number;
}
```

The non-negotiable: **code owns timing, the break card's text owns outcome, and
a capable model (V3.2-class) owns whether the cost actually lands.**
