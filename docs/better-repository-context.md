# BetterRepository Context Notes

Source pass over BetterRepository for AI Story Teller authoring guidance.

Primary site: https://better-repository.netlify.app

Source files reviewed from the public BetterRepository repo:

- Guide registry: https://better-repository.netlify.app/guides and `src/pages/GuidesPage.vue`
- AI Instructions guide: https://better-repository.netlify.app/guides?tab=ai-instructions and `src/components/guides/AIInstructionsGuide.vue`
- Plot Components guide: https://better-repository.netlify.app/guides?tab=plot-components and `src/components/guides/PlotComponentsGuide.vue`
- Story Cards guide: https://better-repository.netlify.app/guides?tab=story-cards and `src/components/guides/StoryCardsGuide.vue`
- Symbols & Commands guide: https://better-repository.netlify.app/guides?tab=symbols-commands and `src/components/guides/SymbolsCommandsGuide.vue`
- Advanced Settings guide: https://better-repository.netlify.app/guides?tab=advanced-settings and `src/components/guides/AdvancedSettingsGuide.vue`
- Scripts guide: https://better-repository.netlify.app/guides?tab=scripts and `src/components/guides/ScriptsGuide.vue`
- Ultrascripts preview: https://better-repository.netlify.app/guides?tab=ultrascripts and `src/components/guides/UltrascriptsGuide.vue`
- AI Instructions library data: `src/data/aiInstructions.js`
- Plot Components library data: `src/data/plotComponents.js`
- Story Cards library data: `src/data/storyCards.js`
- Scripts library data: `src/data/scripts.js`
- Advanced Settings data: `src/data/advancedSettings.js`

## Site Coverage

The Guides page is a tabbed guide hub. Primary guide tabs are AI Instructions, Plot Components, Story Cards, and Scripts. Secondary guide tabs are Symbols & Commands, Ultrascripts (Preview), and Advanced Settings.

The standalone resource pages for AI Instructions, Plot Components, Story Cards, and Scripts are libraries/builders, but they are also authoring evidence. Their concrete components, templates, and presets are part of the site's practical guidance and should be consulted when reviewing or generating AI Story Teller scenarios.

## Detailed Resource Library Pass

Source: `src/data/aiInstructions.js`, `src/data/plotComponents.js`, and `src/data/storyCards.js`.

The guide articles explain the theory. The data files show the actual editorial standard BetterRepository applies.

### AI Instruction Library Structure

The AI Instructions library is not one generic prompt bank. It is structured around three layers:

- Directive templates: quick starts for the AI's role and narration frame.
- Complete instruction sets: curated packages with Lite, Standard, and Max variants.
- Individual components: single-purpose rules grouped by behavior category.

The internal component rules are specific:

- Every component should be one single-line dash instruction.
- Every component should cover one concept only.
- Components should be concise, direct, and actionable.
- Variants are meaningful strength/style alternatives, not simple rephrasings.
- Difficulty and impact metadata matter.
- Duplicate instructions should be merged or made variants, not repeated.

The complete-set rules are also important:

- Every set belongs to one set category: Essential, Playstyle, Model Optimized, or Specialized.
- Every set has Lite, Standard, and Max variants.
- Lite is short-context/minimal. Standard is the default with section headers. Max is long-context/thorough.
- Sets begin with a directive line that establishes AI identity and perspective.
- Player control is separated into dedicated variants and appended at copy time.
- NSFW control is separated into dedicated opt-in variants and appended at copy time.

AI Story Teller mapping:

- Scenario generators should not create one huge undifferentiated instruction block.
- Generated AI Instructions should have a directive/role first, then labeled sections if long.
- Player-control policy belongs in a clearly named setting/instruction, not buried in prose.
- Adult-content policy belongs in an explicit opt-in layer, not silently mixed into general style rules.

### AI Instruction Categories

BetterRepository's component categories and counts:

- Role & Persona: 10 components. Defines narrator/GM identity, POV, tense, narrative drive, response scope, tone, genre flexibility, and whether the model should use "thinking mode."
- Writing Style: 29 components. Covers anti-repetition, show-don't-tell, natural interaction, tight prose, sentence variety, figurative language, description density, atmosphere, filtering, sentimentality, and action wording.
- Pacing & Flow: 13 components. Covers plot-over-description, natural pacing, vivid action, cliffhangers, complete actions, scene interruption, time compression, scene beats, and slow-burn development.
- Dialogue: 19 components. Covers personality-defined speech, more dialogue, conflict in dialogue, small talk, speech tags, paralanguage, no pauses, dialogue descriptors, direct emotion, `NAME:` formatting, no circular banter, cursing, natural interruptions, subtext, distinct voices, and concise dialogue.
- Characterization: 17 components. Covers complex personality, NPC autonomy, anti-sycophancy, blended traits, negative emotions, profession-not-identity, knowledge boundaries, tangible NPC reactions, character introductions, safe behavior rules, and dialogue reflecting identity.
- Emotion & Tone: 16 components. Covers romance as optional/player-choice, emotional moments, gentle concern, consistent tone, emotional restraint, dread, wonder, comedy, melancholy, hope, horror, tension/release, and mood through behavior/environment.
- Coherence & Memory: 15 components. Covers exact continuation, no recap, no ambient knowledge transfer, no new characters without need, preserving names, secrets and reveals, time passage, and specific state fixes.
- Gameplay & Control: 18 components. Covers player freedom, challenge, consequences, lethality, failure, player-control blocking, player dialogue protection, combat style, sandbox play, and decision ownership.
- Narrative Structure: 13 components. Covers narrative agency, consequences, conflict-driven scenes, rising tension, stakes, hooks, scene goals, no predetermined outcomes, foreshadowing, setup/payoff, organic plot, multiple story threads, and dramatic irony.
- World & Setting: 12 components. Covers living worlds, name consistency, environmental detail, location as backdrop, grounded fantasy, magic normalcy, magic detection limits, nonhuman worldview, low/high fantasy, hard/soft magic.
- Formatting & Output: 5 components. Covers plain text, metric system, 24-hour time, phone texts, and appearance-feature constraints.
- Meta & Technical: 12 components. Covers AI Dungeon `>` action token, narrative cue handling, OOC/bracket handling, `##` command handling, no meta commentary, no summaries, context awareness, no moralizing, no apologies, no disclaimers, instruction priority, and no unfounded assumptions.
- NSFW / Adult: 42 components. Covers adult-content enabling, pacing, vocabulary, consent dynamics, fade-to-black behavior, graphicness, sensory immersion, emotional connection, enthusiasm, optional romance, power dynamics, kink/fetish handling, scenario types, and boundaries.

These categories matter because BetterRepository's strongest guidance is not "write a good prompt." It is "separate each behavior lever so it can be selected, combined, tested, and removed."

### Concrete Narration And Style Patterns

Important narration/style patterns from the AI Instructions library:

- "Varying Novel" framing: the model continues a running novel about the main character.
- "Novelist" framing: clean literary prose and creative description.
- "Dungeon Master" framing: the model reacts to actions while naturally advancing the scene.
- "Collaborative Storyteller" framing: the user drives plot; the AI supplies prose.
- POV/tense variants include second-person present, third-person present, and first-person present.
- Narrative drive variants range from reactive, to balanced, to proactive.
- Response scope variants range from moment-by-moment, to scene segment, to full-scene response.
- Ending behavior warns the model not to summarize or wrap up the scene at the end of every response.
- Minimalist style favors short sentences, short paragraphs, dialogue, action, and no padding.
- Novelist style favors layered prose, emotional depth, careful atmosphere, and slower character work.
- Director style frames prose like a camera: visible/audible details, body language, dynamic action, no internal narration unless appropriate.
- Speech Only removes narration entirely and formats the story as dialogue/text conversation.
- Description Weeding removes action qualifiers, figurative padding, ambient mood, sensory overload, and overexplaining.
- Writing Direction balances plot/dialogue priority, subtle tone, sentence variety, emotion through cues, and speech formatting.

AI Story Teller mapping:

- "Narration Rules" should be treated as first-class style controls, not just a subset of AI Instructions.
- Scenario generation should choose a narration mode deliberately: minimalist, novelist, cinematic/director, dialogue-heavy, sandbox-reactive, proactive storyteller, etc.
- If the user asks for better narration, check whether the scenario has explicit instructions for response scope, dialogue ratio, action completion, and ending behavior.

### Complete AI Instruction Sets

The complete sets are meaningful examples of scenario tone and model behavior:

- The Essential: universal compatibility, role establishment, anti-repetition, character behavior, narrative flow, style control, and prohibited patterns.
- Long Form AI Instructions: DeepSeek-oriented thorough rules for anti-repetition, character behavior, clean flow, and style prohibitions.
- Raven: Raven model optimization with kinetic NPC reactions, strict anti-repetition, and clean action-focused prose.
- Light DeepSeek: lightweight DeepSeek 3.2 / Atlas / Dynamic Deep set emphasizing natural dialogue and character interaction with less explicit guidance.
- Compressed AIN: token-efficient coverage of character behavior, dialogue quality, and anti-repetition.
- Description Weeding: removes descriptive bloat, figurative language, atmospheric padding, and sensory overload.
- Writing Direction: dedicated style guide controlling description density, figurative language, scene focus, and prose behavior.
- Speech Only AIN: dialogue-only storytelling with no narration.
- NSFW Add-On: opt-in adult-content bundle intended to append after another playstyle set.
- The Minimalist: lean, fast, dialogue-driven, no padding.
- The Novelist: rich prose, atmospheric writing, emotional depth, literary pacing.
- The Director: cinematic, visual, action-focused, show-don't-tell.
- The Sandbox: maximum player agency, reactive world, real consequences.
- The Storyteller: proactive AI narration, plot hooks, NPC-driven story, rising tension.
- The Immersionist: deep characterization, distinct voices, emotional resonance.

AI Story Teller mapping:

- These are useful scenario-generation presets. We should not collapse them into one "good instructions" default.
- Different adventure types should bias toward different instruction sets: sandbox exploration, character drama, action/cinematic, literary slow burn, dialogue-only, minimal fast play, etc.
- Model-specific sets support this repo's existing warning that strong long-context models follow long rule blocks better than flash-tier models.

### Player Control Variants

BetterRepository separates player-control policy:

- Blocking: never write dialogue, actions, thoughts, or decisions for the player character; only describe events around/to the PC; wait for input before resolving choice-dependent outcomes.
- Neutral: no player-control instruction; model default handles it.
- Acting: AI may write minor actions, speech, and decisions for narrative flow, but major decisions and turning points should remain player choices.

AI Story Teller mapping:

- Do not make player-control policy ambiguous. It changes the play contract.
- If a scenario is meant to let the AI narrate the player's minor actions, say so explicitly. If not, use a blocking rule.

### NSFW And Adult Content Handling

BetterRepository has two separate adult-content layers:

- NSFW control variants appended to complete sets at copy time.
- Individual NSFW components and plot templates.

The control variants are:

- Off: no adult-content instructions.
- Softcore: adult/romantic content allowed, tasteful/literary language, slow tension, emotional connection, romance emerging from interaction and player choice.
- Explicit: adult content allowed with no fade-to-black, direct explicit treatment, dirty talk/vocal responses, graphic physicality, and explicit anatomy.
- Max: explicit plus extended sensory detail, longer scenes, varied acts, multiple rounds, mess/climax detail, and more intense dynamics.

The component categories include:

- Core settings: enabled, pacing, vocabulary, consent dynamics, no fade-to-black.
- Writing/detail: graphicness, anatomy, sensory immersion, physical arousal, vocal expression, fluids/mess, point-of-view immersion.
- Structure/pacing: prolonged scenes, teasing, variety, climax focus, multiple rounds.
- Emotional/relational: emotional connection, enthusiastic participation, optional romance/player-choice attraction.
- Intensity/dynamics: power dynamics, rough intensity, kink-friendly handling, fantasy/nonhuman partners.
- Specific acts/kinks/scenarios: oral, anal, dirty talk, ejaculation-focused variants, breeding themes, bondage, degradation/praise, edging, size difference, public/voyeurism/group/first-time/roleplay/tentacle/monster scenarios.

The plot-component side has adult templates too:

- NSFW Scene Note: immediate Author's Note style for explicit scenes.
- Romantic Erotica Note: balances explicit content with emotional connection.
- Intimate Partner Profile: recurring partner body/preferences/dynamic tracker.
- Scene Boundaries: green/yellow/red boundaries.

AI Story Teller mapping:

- Adult content must be an explicit opt-in scenario/style layer, not accidental default content.
- Keep adult preferences and boundaries separate from general AI Instructions.
- For romance-heavy but not explicit scenarios, use emotional/relationship guidance without enabling explicit adult components.
- The useful structural lesson is granularity: separate romance, consent/boundaries, vocabulary, pacing, and intensity rather than one vague "NSFW" flag.

Note: this repo note intentionally summarizes graphic adult instructions instead of embedding all raw explicit lines verbatim.

### Plot Component Template Details

BetterRepository's plot templates are not generic. They are named tools with specific jobs.

Author's Note templates:

- Basic Author's Note: setting/theme plus player-character speech control.
- Genre-Focused Note: genre, tone, pacing, and focus.
- Mood & Atmosphere: temporary mood, atmosphere, and focus.
- POV & Perspective Control: first/third/omniscient POV, narrator reliability, voice such as sardonic/lyrical/matter-of-fact.
- Scene Setup Note: current scene location, present characters, situation, tone.
- Combat/Action Scene Note: action style, fast beat-by-beat pacing, physical actions, positioning, consequences, injuries, and fatigue.

Plot Essentials templates:

- Basic Character Sheet: identity, species, age, gender, appearance, description, date/schedule.
- Detailed Character Profile: appearance, personality, values, abilities, limitations, goals, fears.
- Relationship Tracker: relation/status/recent changes for recurring characters.
- Party/Companion Tracker: current party, roles, condition, morale.
- Current Scene Anchor: location, present cast, current action, time.
- NPC Roster: quick reference for important NPCs.
- World State Tracker: season/weather, political climate, recent events, rumors.
- Schedule & Time Tracker: date/time and upcoming events.
- Secrets & Hidden Info: what the player knows, does not know, and which secrets are in play.
- Inventory Tracker: weapons, armor/clothing, consumables, valuables, key items.
- Quest/Mission Log: active quests, status, immediate next step.
- Location/Base Tracker: rooms/areas/status/notes.
- Glossary of Terms: setting-specific terms.
- Abilities & Powers: abilities, effects, limitations/costs.
- Rules & Constraints: hard world rules and consequences for breaking them.
- Character Voice Guide: speech style, verbal tics, dialogue personality, vocabulary.
- Reputation & Standing: reputation, group/place perceptions, reasons.
- Condition & Status Effects: health, active effects, needs.
- Travel & Journey Tracker: origin, destination, progress, terrain, hazards.
- Economy & Resources: currency, wealth, income, expenses, prices.
- Daily Routine & Habits: morning/day/evening/habits.

Story Summary templates:

- Basic Story Summary: story so far, recent events, current goal, main obstacle.
- Story Arc Tracker: active arcs and stages.
- Faction Relations: faction standing and reputation.
- Mystery Progress Tracker: central question, clues, theories.
- Character Growth Log: starting state, current state, growth direction, key moments.

AI Story Teller mapping:

- Many BetterRepository "Plot Essentials" templates are too broad for this repo's strict current-truth section if used wholesale.
- For AI Story Teller, split these into the right surfaces: current truth in Plot Essentials, short-term steering in Author's Note/Next Output Bias, recurring entities in Story Cards, internal character state in Brains, and long-term historical arc facts in proposals/cards.
- Templates like Relationship Tracker and Character Voice Guide should often become Story Cards or Brains here, not always-on Plot Essentials.
- Current Scene Anchor maps closely to this repo's active current situation/pressure concepts, but should stay short.

### Story Card Library Details

BetterRepository's story-card data has a stricter prose standard than my first note captured.

Internal Story Card rules:

- Every card has comma-separated triggers.
- Entries are natural prose, not bullet points, because the AI reads them as narrative context.
- Cards have categories: character, location, faction, item, creature, concept, event, culture, vehicle, role, rumor, relationship.
- Simple cards should aim for 3-6 sentences; complex cards 6-10.
- Cards describe what is, not what the AI should do.
- Merge cards for the same entity instead of duplicating them.

Example card coverage:

- Characters: eccentric merchant, mysterious stranger, companion scout, morally complex antagonist.
- Locations: tavern/social hub, dangerous crypt, major city with districts/factions.
- Factions: monastic order, criminal shadow guild.
- Creatures: hybrid beast, undead guardian.
- Items: legendary sword, cursed pendant.
- Concepts: magic system with rules/costs, aether-engine technology.

Template coverage:

- Basic and detailed character cards.
- Deity/god cards.
- Basic and detailed locations plus regions/nations.
- Factions and political parties.
- Items, creatures, concepts, magic systems, abilities/spells.
- Quests/missions, conflicts, major events, festivals.
- Cultures, vehicles, roles/titles, rumors.
- Basic and detailed relationship cards.

AI Story Teller mapping:

- Our Story Cards can use bullets where our app style expects them, but the BetterRepository lesson is that the entry must read as coherent context, not UI metadata.
- Relationship cards are present in BetterRepository, but this repo's architecture says relationships between known characters should usually live on Brains or living character cards. Do not import that BetterRepository pattern blindly.
- Quest/Mission templates are useful authoring references, but quest state is not part of default AI Story Teller context assembly.

## High-Level Lesson

BetterRepository's core claim is that context quality is the main lever for long-running AI Dungeon coherence. The model does not reason over "scenario structure" directly; it reacts to the actual text placed in context, its position, and its clarity.

For AI Story Teller, the matching rule is: every durable instruction or memory surface should have one job, be inspectable, and appear in the right context section. Do not hide mixed-purpose lore, instructions, scene state, and memory inside one opaque bucket.

## AI Instructions

Source: `AIInstructionsGuide.vue`.

AI Instructions are global behavior rules. They control how the model writes: role, prose style, pacing, perspective, player agency, NPC behavior, genre, tone, repetition avoidance, continuation behavior, and other always-on writing rules.

Key points learned:

- AI Instructions are not lore storage. Character facts, world facts, relationships, missions, and backstory belong in Plot Essentials or Story Cards.
- Custom instructions replace AI Dungeon defaults rather than stacking with them. The general lesson for this repo is that an instruction surface must be self-sufficient if it overrides another one.
- Start with the model's role/persona, then add core writing rules, then group topic-specific rules.
- Short sets should be only a handful of high-value lines. Long sets need labeled sections.
- Good instructions are direct, specific, and actionable. Use commands like "Write", "Avoid", "Make", "Never", and "Always".
- Prefer positive framing or replacement behavior over only saying what not to do.
- One idea per line makes instruction effects easier to test.
- Examples remove ambiguity.
- Do not paste a giant set without understanding each line. Add one instruction to solve one recurring problem, then test it.
- Duplicated or contradictory instructions confuse the model and make debugging harder.
- Context viewers matter. BetterRepository repeatedly recommends checking what the model actually sees before blaming the model.
- Instruction position matters: beginning-of-context rules shape global behavior, while near-end guidance has stronger immediate influence.
- The guide treats AI Instructions as a required context element, but still warns that they can crowd out dynamic story/history if too long.

AI Story Teller mapping:

- Keep AI Instructions in section B as global behavior and generation rules.
- Do not let autonomous AI memory updates mutate AI Instructions.
- Do not put plot facts, current mission state, character profiles, or relationship facts here.
- If a scenario needs voice stability, put per-character voice contracts on Story Cards or Brains, not in global AI Instructions.
- For scenario generation, make AI Instructions compact and scenario-specific. The right output is not a giant universal prompt.

## Plot Components And Plot Essentials

Source: `PlotComponentsGuide.vue`.

BetterRepository treats plot components as the main control layer for story coherence. The guide's component model is AI Dungeon-specific, but the placement logic is useful.

The guide distinguishes:

- AI Instructions: behavior rules.
- Plot Essentials: always-present key facts.
- Story Summary: running plot overview.
- Author's Note: short-term scene/tone guidance near the end of context.
- Third Person: a formatting/name-handling option, not a content surface.

### Plot Essentials

Plot Essentials are for information that should always matter. They are the current operating truth: protagonist identity/status, current situation, active world rules, central constraints, and always-present companions.

Key points learned:

- Plot Essentials prime the model to bring up whatever they contain. Include only facts you actively want influencing most scenes.
- Update Plot Essentials when facts change. Stale PE is worse than missing PE because it actively steers the model toward old truth.
- Use clear subject names and one topic per line for strong word association.
- Past events should be written in past tense so the model does not replay them as current.
- Avoid negation-heavy phrasing. Prefer positive or behaviorally clear claims.
- If a detail is only relevant when a person, place, item, faction, or secret is mentioned, it belongs in Story Cards instead.
- If the fact is plot history rather than current truth, it belongs in summary/history rather than PE.
- Duplicating the same fact across PE, Author's Note, Story Cards, and AI Instructions wastes tokens and over-emphasizes the fact.

AI Story Teller mapping:

- Keep Plot Essentials in section C as compact current truth.
- Do not append a chronological log to Plot Essentials.
- Remove resolved or outgoing facts; route historical durable facts into Story Card proposals where appropriate.
- Active Pressure belongs beside current truth as one sentence about what is pressing now, not as a summary.
- Immediate Momentum remains disabled legacy compatibility and should not be revived as a new always-on context surface.

### Author's Note

Author's Note is short-term scene setup and tonal steering. It belongs near the end of context because it should shape the next output more strongly than global rules.

Key points learned:

- Use Author's Note when the current scene differs from the main premise, when a temporary mood or genre focus is needed, or when a scene is entering a special mode.
- Keep it short: roughly a few sentences or tags/keywords.
- It is suitable for immediate upcoming pressure, but not long-range planned events. If the model sees future events too early, it tends to spend them now.
- Technical/tone metadata works better here than long prose.

AI Story Teller mapping:

- Keep Author's Note in section D as tone/mood layer.
- Do not let autonomous AI memory updates mutate it.
- Use Next Output Bias for one-turn steering when the user wants a temporary nudge that should expire.

### Memory And Summary

BetterRepository's Memory Bank and Story Summary are AI Dungeon features, not this repo's architecture. Still, the guide's warning is directly relevant: automatic memory can misphrase events and needs review. Automated retrieval complements manual surfaces; it does not replace them.

AI Story Teller mapping:

- Adventure Chronicle remains the full transcript and should not be directly emitted as full context.
- Rolling Summary is retained for compatibility but is no longer emitted as its own context section.
- Pending Memory Inbox proposals should be visible and excluded from the model payload until approved.
- Do not add an opaque Memory Bank retrieval layer unless it is inspectable, source-linked, token-counted, and user-controlled.

### Scene Transitions

The Plot Components guide recommends longer user input and explicit scene-break markers when switching scenes so the model stops clinging to the previous moment.

AI Story Teller mapping:

- Scenario openings and generated setup should establish scene, mood, location, stakes, and cast in concrete terms.
- `---` or other hard separators can help separate blocks, but they should be used deliberately and not as a substitute for sectioned context.

## Story Cards

Source: `StoryCardsGuide.vue`.

Story Cards are triggered dynamic lore: facts about characters, places, factions, objects, concepts, secrets, or completed events that the model should see only when relevant.

Key points learned:

- Story Cards are optional, but they are the main tool for prebuilt worldbuilding and durable situational facts.
- Manual Story Cards are precise and author-controlled. Automatic memory is effortless but can misphrase or misclassify events.
- In AI Dungeon, only the Entry is visible to the model when triggered; titles, triggers, and notes are not. The general rule still applies here: card content must stand alone.
- Triggered cards are dynamic context and are among the first things to lose space when context is tight.
- Player input triggers cards for the current response; model output triggers them for the next response.
- Triggered text is not magic. The model just sees the card text as lore/context.

### Entry Best Practices

- Use plain, natural language.
- Keep entries concise.
- Put important facts at the beginning and end.
- Repeat the subject name in the entry body. Do not rely on the title alone.
- Avoid long physical-description dumps unless the appearance detail matters to play.
- Split complex subjects into parent/child cards when needed.
- Card networks can work: one active card can mention another card's trigger, causing likely later activation. Do not depend on this for critical facts unless the current card also contains enough context by itself.

### Trigger Best Practices

- False triggers are harmful because irrelevant lore can hijack context.
- Spaces around triggers matter in AI Dungeon. The broader lesson is that trigger matching must be deliberate, not broad.
- Avoid tiny triggers that appear inside unrelated words.
- Add irregular plurals or variants where needed.
- Word stubs can be useful for related forms, but they increase false-positive risk.
- Punctuation and apostrophe variants matter.
- Hyphenated names can prevent simple sub-word triggers.
- Use specific names, phrases, nicknames, object names, faction names, and unique case names over generic terms.

AI Story Teller mapping:

- Keep Story Cards in section F.
- Make every Story Card self-contained even if the UI labels it.
- Avoid broad character-name triggers on event, relationship, location, and subplot cards when a character identity card already owns that name.
- Use living cards for evolving relationship/status/current arrangements; merge/archive instead of creating sibling cards for the same evolving subject.
- Use historical cards for completed events and retired Plot Essentials facts.
- If a character has a Brain, put evolving internal state there. If no Brain exists, route durable character facts to a Story Card or Story Card proposal, not a new Brain by default.

## Symbols And Commands

Source: `SymbolsCommandsGuide.vue`.

The guide is about community-discovered prompt-shaping syntax. It argues that language models carry learned associations from markdown, code, and structured text.

Key points learned:

- `##` works as a strong direct command because models associate it with headings and high-level directives.
- `[ ]` works as author-note-like metadata: something to keep in mind without necessarily narrating it.
- `{ }` works as a structured information container and can reduce bleeding between multiple facts or entities.
- `>` marks player input/action in AI Dungeon's UI convention.
- Single quotes emphasize a term.
- `** **` strongly emphasizes text.
- `*text*`, list markers, and horizontal rules also carry learned markdown meaning.
- Combining symbols can strengthen guidance, but overuse can confuse the model.
- The guide explicitly warns that these are community techniques and model-dependent.

AI Story Teller mapping:

- Use markdown structure when it improves clarity, especially headings, bullets, and separators.
- Do not depend on symbolic tricks as a substitute for correctly placed context sections.
- In generated scenario content, prefer readable headings and bullets over dense magic syntax.
- Curly-brace object blocks can be useful for compact structured cards, but plain English remains safer for durable story facts.

## Advanced Settings

Source: `AdvancedSettingsGuide.vue`.

Advanced settings alter sampling and token budgets, not the underlying quality of context.

Key points learned:

- Context Length controls how much text can be sent to the model. More context generally improves continuity, but response tokens become part of the next turn's budget.
- Response Length is preference-dependent: shorter is more interactive, longer is more immersive.
- Temperature controls randomness. Lower is more predictable; higher is more surprising and can become incoherent.
- Top-K limits the candidate token count.
- Top-P filters by cumulative probability and works together with Top-K.
- Presence and frequency penalties can reduce repetition but can also distort common words, names, and grammar if overused.
- Before using penalties, check whether repetition is caused by repeated context.
- Adjust one setting at a time and treat presets as starting points, not truth.

AI Story Teller mapping:

- When output quality is poor, inspect the assembled context before changing provider settings.
- Repetition can come from duplicated Plot Essentials, Story Cards, Brains, or recent messages.
- Provider/model settings are a separate diagnosis layer from authoring best practices.

## Scripts And Ultrascripts

Sources: `ScriptsGuide.vue` and `UltrascriptsGuide.vue`.

The Scripts guide is AI Dungeon-specific, but the design lessons are relevant:

- Scripts can modify input, model context, output, story cards, and persistent state.
- Context modification is powerful and risky because it can hide what the model actually received.
- Persistent state must be initialized carefully and not reset every turn.
- Debugging requires logs and inspecting the exact context sent to the model.
- Script-set memory/context can take precedence over UI values in AI Dungeon, which is a cautionary example for hidden overrides.

The Ultrascripts preview emphasizes clean separation between narrative text and transport/control data:

- Do not leak transport junk into the visible story.
- Player-facing UI should be trustworthy enough to build mechanics around.
- Players should control which capabilities a scenario can use.
- Background automation should support the story rather than pollute it.

AI Story Teller mapping:

- Runtime state changes must continue to flow through `adventureReducer`.
- AI-generated memory writes must go through `applyAIMemoryUpdate` and reducer actions.
- Context Preview must match provider payload.
- Do not add hidden context modifiers that bypass inspectable sections or logging.
- Any future richer scripting or automation layer needs explicit UI, source visibility, and user controls.

## Practical Checklist For Scenario Review

Use this checklist when reviewing or generating AI Story Teller scenarios:

- AI Instructions are global behavior only, not lore.
- Plot Essentials contain compact current truth and always-relevant constraints.
- Active Pressure is one sentence about the current external force pressing on the player character.
- Author's Note is short scene tone, not a long plan.
- Next Output Bias is one-turn steering, not durable memory.
- Story Cards are self-contained triggered facts with specific triggers.
- Living Story Cards track current evolving status; historical Story Cards track completed facts.
- Brains are for major characters' internal evolving state, not random NPCs or locations.
- Do not duplicate the same fact across PE, Story Cards, Brains, and Author's Note.
- Prefer positive, behavioral wording over vague adjectives or negation-heavy rules.
- Put key facts at the beginning and end of compact context entries.
- Check the assembled context before blaming model quality.
- Keep every token attributable to a named, inspectable section.
