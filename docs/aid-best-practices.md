# AI Dungeon Best Practices

Updated: 2026-07-02

This is repo-local context for building AI Dungeon scenario packs, especially
when producing an AID opening prompt, token-conscious plot components, and Story
Card JSON that can be imported into AI Dungeon.

This guide is explicitly AI Dungeon-specific. Its Story Summary, Character
Creator, placeholders, field visibility, and trigger assumptions are not AI Story
Teller behavior. For AI Story Teller use [Fact ownership and overlap audit](./fact-ownership.md).

Primary references:

- Official AI Dungeon Plot Components guide:
  https://help.aidungeon.com/faq/plot-components
- Official AI Dungeon Plot Essentials guide:
  https://help.aidungeon.com/faq/plot-essentials
- Official AI Dungeon Author's Note guide:
  https://help.aidungeon.com/faq/what-is-the-authors-note
- Official AI Dungeon Story Cards guide:
  https://help.aidungeon.com/faq/story-cards
- Official AI Dungeon Character Creator guide:
  https://help.aidungeon.com/faq/whats-the-difference-between-scenarios-and-worlds
- Local BetterRepository summary:
  `docs/better-repository-context.md`

## Core Setup Shape

A reliable AID scenario pack should usually contain:

1. Opening prompt / starting prompt.
2. AI Instructions.
3. Plot Essentials.
4. Author's Note.
5. Story Cards JSON.

Use Story Summary only when there is a real running plot overview to preserve.
For a fresh scenario, do not include a Story Summary by default just because it
exists as an AID surface. A lean setup with custom AI Instructions, tight Plot
Essentials, a short Author's Note, and Story Cards is usually better.

## Player Variables / Placeholders

AID placeholders are player-facing variables written in `${...}` form, such as:

```text
${What is your name?}
${What kind of outsider are you?}
${What almost happened between you and Grushka before you both lost nerve?}
```

Use placeholders wherever player customization needs to be injected into the
setup text. They are not only for the opening prompt.

Good places to use placeholders:

- Opening prompt / starting prompt.
- Plot Essentials, when the customized fact should always matter.
- Author's Note, only if the variable affects recurring tone or framing.
- Story Card entries, especially relationship cards, player-role cards, and
  premise cards that need to adapt to the player's answers.
- Character Creator scenario text and option-connected setup.

The official Story Cards guide says placeholders work in Story Cards. The
Character Creator guide also says placeholders work there, and notes that
`${character.name}` and `${character.gender}` can reference the player's chosen
name and gender in Character Creator scenarios.

Use placeholders in Story Card entries like this:

```text
Grushka Mirekiss recently spent a dangerous storm-night with ${What is your name?}, a ${What kind of outsider are you?}. Their attraction is new but already charged by ${What almost happened between you and Grushka before you both lost nerve?}.
```

Do not rely on a Story Card title to carry a personalized fact. AID says the AI
does not see the card Name; it sees the Entry when the card triggers. Put the
subject name and the personalized fact in the Entry itself.

Prefer stable triggers over placeholder triggers. For example, trigger a card
with `Grushka,Mirekiss,Gloamfen,bathhouse`, not `${What is your name?}`. The
placeholder belongs in the Entry unless there is a strong reason to make the
player's custom answer part of trigger matching.

## Opening Prompt

The opening prompt should start the story, not describe the setup from a
distance. Begin in-scene, with immediate pressure, a clear location, and at
least one active NPC.

For romance scenarios, it is valid to skip the cold meet-cute. If the scenario
needs chemistry immediately, dramatize a small amount of shared recent history
in the opening. Choose one authoritative current-state owner, such as the
character card or a designated relationship card; do not copy the same
attraction into Plot Essentials as reinforcement. Story prose remains evidence.

Good opening prompt goals:

- Establish who the player is, using placeholders where useful.
- Put the player in a live scene with a concrete problem.
- Introduce the main love interest or central NPC fast.
- Show the tone through action and dialogue rather than explaining the tone.
- End on an invitation to act, not a finished summary.

Avoid:

- A lore essay before anything happens.
- A first scene that repeats all Story Card content.
- Solving the first problem before the player can respond.
- Overdefining the player character's personality, thoughts, or choices.

## AI Instructions

AI Instructions are global behavior rules. They influence how the model writes
the adventure. They are included early in context.

Use AI Instructions for:

- Point of view and player agency rules.
- Genre behavior.
- Pacing.
- Tone.
- NPC initiative.
- Romance boundaries and consent framing.
- Comedy/drama balance.
- How to handle player actions.
- Instructions about avoiding summaries, meta-commentary, or stale loops.

Do not use AI Instructions as lore storage. Character biographies, relationship
status, location details, secrets, mission state, and backstory usually belong
in Plot Essentials or Story Cards.

Keep instructions scenario-specific and self-contained. Do not paste a generic
mega-prompt unless every line solves a real problem.

Strong instruction style:

```text
Write in second person.
Keep the player character's choices, speech, and inner reactions under player control.
Let NPCs initiate, interrupt, flirt, lie, escalate, and make mistakes.
Keep the tone mature, funny, sensual, and dangerous without turning serious threats into jokes.
```

## Plot Essentials

Plot Essentials are always-on key facts. They should stay dense and short
because they are part of the context every turn.

Use Plot Essentials for:

- The player's role or current status.
- The core premise.
- Current operating truth.
- Immediate companions who matter every scene.
- Central constraints.
- Active conflicts that should shape most scenes.
- Important customized player variables that must always matter.

AID notes that Plot Essentials can prime the AI to bring up what they contain,
so only include details you actually want recurring. Details that only matter
when a person, place, faction, secret, or object is mentioned usually belong in
Story Cards instead.

Write one topic per line when possible. Use direct subject names. If mentioning
past events, label them as past tense so the model does not replay them as
current action.

Bad Plot Essentials:

```text
Gloamfen is a swamp town with politics, bathhouses, frogs, a church, a fake guild, old magic, Grushka, Mayor Vellum, tax ledgers, romance, and many different conspiracies.
```

Better Plot Essentials:

```text
${What is your name?} is a ${What kind of outsider are you?} investigating Gloamfen's swamp-tax irregularities.
The investigation requires the player to remain in Gloamfen until the permits are audited.
Someone is poisoning Gloamfen's swamp leylines and framing ogres for it.
The conspiracy uses forged permits, corrupt officials, and staged monster attacks to seize the swamp.
```

## Author's Note

Author's Note is short near-end steering. AID sends it toward the end of player
input and formats it as bracketed descriptive guidance. It has strong immediate
influence, so do not overload it.

Use Author's Note for:

- Genre tags.
- Style.
- Current tone.
- Short-term scene emphasis.
- A correction the model keeps missing.

Keep it to roughly 3 or 4 sentences at most. If the note grows into lore,
move the lore to Plot Essentials or Story Cards.

Example:

```text
Mature swamp-noir romantic comedy. Use sharp banter and atmospheric scene framing. Let the conspiracy create absurd complications without undercutting real stakes or chemistry.
```

## Story Cards

Story Cards are triggered dynamic lore. AID adds a card's Entry to context when
one of its Triggers appears in the player's input or AI output. The card may not
affect the same output if it is first triggered mid-response; it can affect later
outputs while active.

AID field behavior:

- Type can help organize cards and Character Creator options, but is not the
  main text the AI sees.
- Name is for creator reference. The AI does not see it.
- Entry is the important field. The AI sees this when the card triggers.
- Triggers determine when the Entry is included.
- Notes are not seen by the AI, except as player-facing option descriptions in
  Character Creator.

Entry best practices:

- Use plain English.
- Be concise.
- Put important facts near the beginning; do not repeat them just for emphasis.
- Repeat the subject name in the Entry body.
- Avoid excessive physical description unless it matters.
- Use placeholders in the Entry when the card should adapt to player choices.
- Write relationship and current-status cards in present tense.
- Write completed events in past tense.

Trigger best practices:

- Use specific names, nicknames, place names, faction names, object names, case
  names, and unique phrases.
- Avoid generic triggers like `the town`, `romance`, `mission`, or `current`.
- Watch spaces around triggers. AID treats leading/trailing spaces as meaningful.
- Avoid tiny triggers that fire inside unrelated words.
- Add useful variants, but do not over-trigger.

Good Story Card JSON shape for import/export work:

```json
[
  {
    "title": "Grushka Mirekiss",
    "type": "Character",
    "keys": "Grushka,Mirekiss,ogre,bathhouse",
    "entry": "Grushka Mirekiss is a powerful ogre bathhouse owner in Gloamfen. Grushka is bold, funny, sensual, civic-minded, and dangerous when cornered. Grushka recently shared a charged storm-night with ${What is your name?}, and their attraction is new but already difficult to ignore."
  }
]
```

## Character Creator Notes

Character Creator scenarios let players choose from predefined options. AID
builds the opening around those choices. Options are connected to Story Cards,
and selected information is saved into Plot Essentials.

Use Character Creator when the scenario benefits from structured options like:

- Class / role.
- Race / species.
- Faction.
- Starting location.
- Relationship premise.
- Prior incident with a key NPC.

For looser scenarios, normal placeholders in a Story Scenario can be enough.

Character Creator references:

- The player is always asked for name and gender.
- `${character.name}` can reference the chosen name.
- `${character.gender}` can reference the chosen gender.
- Normal `${Question}` placeholders can still work.

## Token-Conscious Placement

Use each surface for one job:

- AI Instructions: how to write.
- Plot Essentials: what must always matter.
- Author's Note: immediate tone and scene steering.
- Story Cards: facts that matter only when triggered.
- Story Summary: broad plot recap, only when genuinely useful.

Avoid duplicating the same fact across every surface. Duplication costs tokens
and over-emphasizes the fact.

Good placement pattern for romance with prior history:

- Opening Prompt: dramatize the live scene; preserve it as story evidence.
- Character Story Card: identity, durable psychology, voice, and the relationship
  fact if this is its chosen owner.
- Optional relationship Story Card: use instead for relationship state only when
  it is a recurring subject; do not repeat the same state on the character card.
- Plot Essentials: only near-universal operating constraints, not reinforcement.
- Author's Note: tone and style, not another attraction or history assertion.

## Scenario Quality Rules

For this user's preferred AI Dungeon scenario style:

- Give the player a capable role.
- Put them under pressure immediately.
- Create multiple NPCs with competing agendas.
- Make romance a source of tension, leverage, banter, and consequence, not mush.
- Keep comedy active in the world but do not make the central emotions fake.
- Let systems be exploitable: laws, contracts, guild rules, warrants, taboos,
  debts, magical mechanics, noble protocol, or bureaucratic loopholes.
- Use absurd background events as pressure generators, not random noise.
- Seed the antagonist or conspiracy through recurring people and institutions,
  not a stranger who appears from nowhere.

## AID Pack Deliverable Checklist

When asked to make AID content, produce:

- Opening Prompt.
- AI Instructions.
- Plot Essentials.
- Author's Note.
- Story Cards JSON.
- Optional Story Summary only if requested or clearly needed.
- Optional Character Creator fields when structured choices are better than
  freeform placeholders.

Before finalizing, check:

- Placeholders are used anywhere personalization matters, including Story Card
  entries and relevant plot components.
- Story Card entries are self-contained and repeat the subject name.
- Story Card triggers are stable and specific.
- Plot Essentials is lean and always-on.
- Author's Note is short.
- AI Instructions do not store lore.
- Apply the [ownership overlap audit](./fact-ownership.md#overlap-audit) as an editorial check; AI Story Teller-only surfaces in that reference are not AI Dungeon features.
- The opening starts in-scene.
- Adult or mature content is opt-in, consensual, and framed around adult
  characters when romance or sexuality is involved.
