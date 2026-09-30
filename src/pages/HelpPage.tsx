import { useMemo, useState, type ReactNode } from "react";

interface DocTopic {
  id: string;
  title: string;
  category: string;
  summary: string;
  tags: string[];
  body: ReactNode;
}

const topics: DocTopic[] = [
  {
    id: "overview",
    title: "Overview",
    category: "Getting Started",
    summary: "Local-first architecture, provider keys, persistence model, and the main operating loop.",
    tags: ["local-first", "indexeddb", "provider", "browser"],
    body: (
      <>
        <p>
          AI Story Teller is a browser-only interactive fiction system. Adventure data is stored in
          IndexedDB. Tiny runtime preferences, including the provider API key, live in localStorage.
          There is no backend service.
        </p>
        <pre>{`npm.cmd test
npm.cmd run build
npm.cmd run test:live   # optional, uses .env.test.local`}</pre>
        <p>
          The application is designed around inspectable context. If text consumes model tokens, it must
          appear in Context Preview with item IDs, title, reason, priority, pinned/protected state, and
          generated-by source.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-library",
    title: "Library",
    category: "Side Menu",
    summary: "Create, open, duplicate, and delete local adventures.",
    tags: ["adventures", "library", "create", "open", "delete"],
    body: (
      <>
        <p>
          Library is the adventure picker. Use it to create a fresh adventure, reopen a saved IndexedDB
          adventure, duplicate an existing adventure, or delete one from local storage.
        </p>
        <p>
          New Adventure includes optional setup before play: an opening scene, starter World Blocks, manual
          Story Cards, and Story Cards parsed from uploaded or pasted JSON. Generate with AI drafts the title,
          opening scene, tight Plot Essentials, one-sentence Active Pressure, optional scenario-specific
          AI Instructions or Author's Note, and recurring Story Cards for review. Native DeepSeek generation uses
          structured JSON output with thinking disabled for this schema-driven setup call.
        </p>
        <p>
          Library also contains Personal Cloud Sync. For a private single-user setup, it can push and pull
          all adventures through a private GitHub repo so a phone and computer can continue the same story.
        </p>
        <p>
          API keys are not stored in adventure records, so exporting, duplicating, or deleting an adventure
          does not move provider secrets around.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-dashboard",
    title: "Dashboard",
    category: "Side Menu",
    summary: "The main cockpit for playing while keeping key adventure state visible.",
    tags: ["dashboard", "cockpit", "play", "overview"],
    body: (
      <>
        <p>
          Dashboard is the default home screen for an open adventure. It shows the current scene, active
          objective, context budget, character state, Memory Suggestions status, and latest evaluation log.
        </p>
        <p>
          It also includes the AID-style turn controls, so you can play from the cockpit without opening
          editor pages.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-play",
    title: "Play",
    category: "Side Menu",
    summary: "The focused story screen for taking turns and editing the transcript.",
    tags: ["play", "turn", "continue", "retry", "undo", "redo"],
    body: (
      <>
        <p>
          Play is the focused story surface. Use Story, Do, and Author modes to submit turns, continue,
          retry the last model response, erase the latest section, and undo or redo story text edits.
        </p>
        <p>
          Transcript entries are editable inline. Changes go through the reducer and persist with the
          adventure.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-chronicle",
    title: "Chronicle",
    category: "Side Menu",
    summary: "The complete local transcript of the adventure.",
    tags: ["chronicle", "transcript", "history", "messages"],
    body: (
      <>
        <p>
          Chronicle is the full user-readable story and message history. It is stored persistently and is
          not compressed.
        </p>
        <p>
          Chronicle is source material for summaries and memory proposals, but it does not automatically
          flood the model context. Recent Messages and active memory surfaces are the model-facing versions.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-inbox",
    title: "Memory Suggestions",
    category: "Side Menu",
    summary: "Review pending AI-suggested memories before they become active context.",
    tags: ["memory suggestions", "inbox", "proposals", "approve", "reject"],
    body: (
      <>
        <p>
          Memory Suggestions holds AI-suggested durable memories as proposals with source
          text, proposed type, rationale, confidence, and suggested triggers.
        </p>
        <p>
          Pending proposals are not active context. Approving a proposal routes it to a Story Card, Brain
          update, Plot Essentials update, Active Pressure update, or legacy Rolling Summary update through reducer-backed paths.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-story-cards",
    title: "Story Cards",
    category: "Side Menu",
    summary: "Durable triggered facts that enter context only when relevant or pinned.",
    tags: ["story cards", "memory", "triggers", "durable facts"],
    body: (
      <>
        <p>
          Story Cards store durable facts: names, promises, secrets, recurring places, rules, relationships,
          and important objects.
        </p>
        <p>
          Use <strong>Draft a Story Card with AI</strong> to choose a card focus, memory mode, optional living
          auto-updates, and the thing that should be remembered. The AI compares the brief with existing cards
          and creates a pending Memory Suggestion. It does not change active memory until you approve the proposal.
        </p>
        <p>
          Active cards enter context when their triggers match the current input, latest output, or recent
          history. Pinned cards are prioritized; protected cards cannot be dropped by token truncation.
        </p>
      </>
    ),
  },
  {
    id: "best-practices-character-cards",
    title: "Character Cards — Voice Contract",
    category: "Best Practices",
    summary: "How to write character story cards that actually control voice, not just describe traits.",
    tags: ["character cards", "voice", "voice contract", "npc", "story cards", "best practices"],
    body: (
      <>
        <p>
          A character card that only describes traits — "witty, guarded, dangerous" — tells the model what
          kind of character to generate. It fills the voice in from its defaults, which produces generic
          "interesting NPC" behavior. To control how a character actually sounds, the card needs a{" "}
          <strong>Voice Contract</strong>.
        </p>
        <p>
          Append a Voice Contract section to any character card that matters. The existing descriptive
          content stays — the Voice Contract goes below it:
        </p>
        <pre style={{ background: "var(--surface-2, #1e1e1e)", padding: "0.75rem", borderRadius: "4px", fontSize: "0.85em", overflowX: "auto" }}>{`VOICE CONTRACT
Rhythm: [sentence length, pacing, speech patterns]
Default move: [what they do first when speaking or entering a scene]
Emotional defense: [how they protect vulnerability — deflection, humor, aggression, pivot to task, silence]
Never sounds like: [specific behaviors the AI must not give this character — be concrete]
Example lines: "[line in their actual voice]" / "[another line]" / "[a third line]"`}</pre>
        <p><strong>The example lines carry the most weight.</strong> The model pattern-matches prose style from examples far more reliably than it follows trait descriptions. Three lines in the character's actual voice do more than three paragraphs of personality description.</p>
        <p><strong>"Never sounds like"</strong> is the second most important field. Negative constraints are strong — "never warm, never offers choices, never says what she's feeling directly" is harder for the model to ignore than "emotionally guarded."</p>
        <p><strong>What not to put in AI Instructions.</strong> Per-character voice belongs on the character's card, not in AI Instructions. AI Instructions apply to every turn globally — character-specific rules dilute them and create two sources of truth. If Nyx needs to sound a specific way, that goes on Nyx's card.</p>
        <p><strong>Auto-generated cards</strong> from "Generate with AI" and inline memory tagging automatically use Voice Contract format for character cards. For existing cards, paste the Voice Contract section in below the existing content — don't overwrite it.</p>
      </>
    ),
  },
  {
    id: "side-menu-characters",
    title: "Characters",
    category: "Side Menu",
    summary: "Opt-in Brain entries for major character inner state.",
    tags: ["characters", "brains", "brain entries", "inner state"],
    body: (
      <>
        <p>
          Characters manages Brain entries. Brains are opt-in and intended for major characters whose
          internal state, emotional interpretation, relationship pressure, or recent developments should
          evolve.
        </p>
        <p>
          The system does not automatically create Brains for random characters. AI may update only
          BrainEntries that already exist, unless the user approves creating one from a proposal.
        </p>
      </>
    ),
  },
  {
    id: "current-story-arc",
    title: "Current Story Arc",
    category: "Side Menu",
    summary: "Auto-updating arc log that tracks what's happening in the active story arc.",
    tags: ["current arc", "story arc", "arc log", "plot", "auto-update", "graduate"],
    body: (
      <>
        <p>
          <strong>Current Story Arc</strong> is a World Block component (type: Current Story Arc) that maintains a
          running log of meaningful events in the active arc. Unlike Plot Essentials — which holds static world
          constants — Current Story Arc grows as the story unfolds and gets retired when the arc resolves.
        </p>
        <p>
          <strong>Arc Premise (required for auto-update):</strong> Seed the component with a one-line premise
          describing what this arc is about. Example: <em>"Kira is building toward deserting the Fire Nation,
          but hasn't decided yet."</em> The semantic engine uses this premise as a filter — it only fires when
          a story event meaningfully advances or complicates that specific premise. Without a premise, no
          auto-updates fire.
        </p>
        <p>
          <strong>Arc Log:</strong> Each auto-update appends 1–3 sentences capturing a specific arc
          development. The log grows freely — no size limit — because it's designed to be completed and
          moved out, not trimmed.
        </p>
        <h4>Best Practices</h4>
        <ul>
          <li>
            <strong>Keep the premise tight.</strong> "Kira is building toward desertion" fires on relevant
            arc beats. "The adventure continues" fires on everything — useless.
          </li>
          <li>
            <strong>Leave it alone during play.</strong> Don't direct it. The point is that arc events
            accumulate without your involvement. If the log fills with noise, tighten the premise.
          </li>
          <li>
            <strong>Plot Essentials ≠ Current Arc.</strong> PE holds the overarching premise and persistent story-wide constraints. Active Pressure holds immediate external threats and obligations. The arc holds the active conflict's running log and pacing gate.
          </li>
          <li>
            <strong>Graduate when the arc resolves.</strong> When the arc has run its course, click
            "Complete Arc → Story Card." This creates a permanent Story Card (type: plot) from the arc log
            and clears the component for the next arc. The graduated card stays in context when triggered
            by relevant keywords — keeping the resolved arc as referenced backstory.
          </li>
          <li>
            <strong>Auto-approval is on by default.</strong> Arc updates go through Memory Inbox but are
            auto-approved, so they apply without you touching them. If you want to review each entry,
            turn off "currentArcUpdate" in Memory Auto-Approve settings.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "side-menu-world-blocks",
    title: "World Blocks",
    category: "Side Menu",
    summary: "Manage AI Instructions, Plot Essentials, Current Story Arc, Author's Note, and custom components.",
    tags: ["world blocks", "components", "plot essentials", "current arc", "author note", "ai instructions"],
    body: (
      <>
        <p>
          World Blocks are context components. Narration Rules are the primary per-adventure behavior contract.
          AI Instructions are optional: use them only when you deliberately want scenario-specific rules separated
          from Narration Rules. Both load every turn, so duplicating the same rules wastes context and can create
          competing wording. AI Instructions, Plot Essentials, and Author's Note are protected by default.
          Custom components can be active, pinned, protected, prioritized, or manual.
        </p>
        <p>
          AI-generated updates may only touch component content when the component type is Plot Essentials,
          and only through approved mutation paths.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-context-preview",
    title: "Context Preview",
    category: "Side Menu",
    summary: "Inspect exactly what text will be sent to the provider and why.",
    tags: ["context preview", "provider payload", "tokens", "inspect"],
    body: (
      <>
        <p>
          Context Preview shows every context section, included item, excluded item, token estimate,
          priority decision, pinned/protected state, and generated-by source.
        </p>
        <p>
          The provider payload preview must match the actual messages sent to the model. There should be
          no hidden adventure-memory bucket.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-automations",
    title: "Automations",
    category: "Side Menu",
    summary: "Edit trigger rules and inspect keyword, regex, and semantic evaluation logs.",
    tags: ["automations", "triggers", "semantic", "logs"],
    body: (
      <>
        <p>
          Automations manages trigger rules. Keyword and regex triggers run synchronously around the turn.
          Semantic triggers run asynchronously after the model response and log their evaluation results.
        </p>
        <p>
          Trigger actions must dispatch typed reducer actions. They should not mutate adventure state
          directly.
        </p>
        <p>
          Automatic memory discovery and approval controls are on the Memory page. Its inline categories filter
          new Story Card proposals in the narrator's response; they do not control background discovery or
          updates to existing memory. The inline path uses the story request, while missing-output recovery and
          background discovery can make additional requests.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-import-export",
    title: "Import / Export",
    category: "Side Menu",
    summary: "Move AIST adventure JSON backups in or out of the browser.",
    tags: ["import", "export", "aist", "backup"],
    body: (
      <>
        <p>
          Import / Export handles full AIST adventure JSON backups. Full backups keep the playable
          save together, while partial exports are for reuse and editing.
        </p>
        <p>
          Invalid or ambiguous imported data should be preserved as raw text instead of silently discarded.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-settings",
    title: "Settings",
    category: "Side Menu",
    summary: "Configure provider, model, UI, semantic evaluation, and token budget behavior.",
    tags: ["settings", "provider", "model", "dark mode", "budget"],
    body: (
      <>
        <p>
          Settings stores tiny app preferences in localStorage, including provider API key, selected model,
          and dark mode. Adventure-specific settings control token budgets, semantic evaluation, memory
          detection, and background update behavior.
        </p>
        <p>
          The Provider section includes an API throttle. Enable it to enforce a minimum delay between
          provider calls and an optional maximum number of calls per minute across turns, summaries,
          Remember This, semantic evaluation, and generated memory updates.
        </p>
        <p>
          Provider keys must never be written into adventure JSON or IndexedDB records.
        </p>
      </>
    ),
  },
  {
    id: "side-menu-documentation",
    title: "Documentation",
    category: "Side Menu",
    summary: "The searchable technical reference for the system.",
    tags: ["documentation", "help", "reference", "topics"],
    body: (
      <>
        <p>
          Documentation is this page. It is organized like a small technical manual: searchable topics,
          sidebar entries, architecture contracts, memory rules, and testing commands.
        </p>
        <p>
          When a new sidebar surface is added, it should get a matching Documentation topic so users can
          inspect what it is for.
        </p>
      </>
    ),
  },
  {
    id: "turn-pipeline",
    title: "Turn Pipeline",
    category: "Runtime",
    summary: "The reducer-driven path from submitted input to provider payload, model response, memory, and save.",
    tags: ["turn", "pipeline", "provider", "reducer"],
    body: (
      <>
        <ol>
          <li>Flush queued semantic updates.</li>
          <li>Add the user message through <code>adventureReducer</code>.</li>
          <li>Run keyword and regex automations synchronously.</li>
          <li>Build deterministic context with <code>buildContext</code>.</li>
          <li>Send <code>ContextBuildResult.messages</code> to the provider.</li>
          <li>Add assistant output through the reducer.</li>
          <li>Create Memory Suggestions proposals when classifier output is significant.</li>
          <li>Run output-side keyword and regex automations.</li>
          <li>Increment the turn, persist, and start async semantic evaluation.</li>
        </ol>
        <p>
          The smoke tests in <code>src/state/turnPipeline.smoke.test.ts</code> exercise this path with a
          mocked provider.
        </p>
      </>
    ),
  },
  {
    id: "context-contract",
    title: "Context Contract",
    category: "Context",
    summary: "The exact named sections and provider payload matching rules.",
    tags: ["context", "payload", "preview", "tokens"],
    body: (
      <>
        <p>Context is assembled in this fixed section order:</p>
        <ol>
          <li>System Shell</li>
          <li>AI Instructions</li>
          <li>Plot Essentials</li>
          <li>Components</li>
          <li>Story Cards</li>
          <li>Brains</li>
          <li>Author's Note</li>
          <li>Next Turn Note</li>
          <li>Continuity Challenge</li>
          <li>Recent Messages</li>
        </ol>
        <p>
          Context Preview must match the provider payload. Non-message sections are joined into the first
          system message. Recent messages are shown newest-first in preview but sent chronologically in
          the chat payload.
        </p>
        <p>
          There is no hidden "adventure memory" bucket. Memory Proposals are visible in preview, but they
          are not sent to the model until approved into an active memory surface.
        </p>
      </>
    ),
  },
  {
    id: "priority-budget",
    title: "Priority and Budgeting",
    category: "Context",
    summary: "Protected, pinned, priority, inclusion policy, and memory priority modes.",
    tags: ["budget", "priority", "protected", "pinned"],
    body: (
      <>
        <dl>
          <dt>protected</dt>
          <dd>Cannot be dropped by token truncation.</dd>
          <dt>pinned</dt>
          <dd>Loaded before ordinary triggered memory and dropped later, but not automatically protected.</dd>
          <dt>priority</dt>
          <dd>Relative ordering within a context tier.</dd>
          <dt>inclusionPolicy</dt>
          <dd>Controls whether the item is always loaded, trigger-gated, manually included, or system-suggested.</dd>
        </dl>
        <p>
          Only the system shell and user-marked protected context are absolutely non-droppable. AI
          Instructions, Plot Essentials, and Author's Note are protected by default, but the model is
          intentionally explicit so protection can be inspected and tested.
        </p>
      </>
    ),
  },
  {
    id: "memory-surfaces",
    title: "Memory Surfaces",
    category: "Memory",
    summary: "Chronicle, legacy Rolling Summary, Next Turn Note, Story Cards, Brains, Plot Essentials, and Memory Suggestions roles.",
    tags: ["memory", "chronicle", "summary", "next turn note", "story cards", "brains"],
    body: (
      <>
        <dl>
          <dt>Adventure Chronicle</dt>
          <dd>The complete transcript. Stored locally, not compressed, not automatically dumped into context.</dd>
          <dt>Rolling Summary</dt>
          <dd>Legacy save-compatible continuity data. Retained in adventures, but not emitted as a default context section.</dd>
          <dt>Next Turn Note</dt>
          <dd>Short-term user-written steering for the next generation. It is visible, token-counted, and expires after use by default.</dd>
          <dt>Story Cards</dt>
          <dd>Approved durable facts triggered by keywords, phrases, or regex configuration.</dd>
          <dt>Brains</dt>
          <dd>Opt-in state for major characters only. AI may update a Brain only if it already exists.</dd>
          <dt>Plot Essentials</dt>
          <dd>Overarching premise, long-term conflict, and persistent story-wide constraints.</dd>
          <dt>Memory Suggestions</dt>
          <dd>Pending proposals. Nothing in the inbox becomes active context until approved.</dd>
        </dl>
      </>
    ),
  },
  {
    id: "memory-routing",
    title: "Memory Routing Policy",
    category: "Memory",
    summary: "Where new facts should go and when details should be ignored.",
    tags: ["classification", "routing", "policy"],
    body: (
      <>
        <p>Default routing rules:</p>
        <ul>
          <li>Durable recurring facts go to Story Cards.</li>
          <li>Character-specific evolving internal state goes to Brains only for existing BrainEntries.</li>
          <li>Tiny always-on current constraints go to Plot Essentials.</li>
          <li>Current external pressure goes to Active Pressure; active arc history goes to Current Arc.</li>
          <li>Ephemeral scenery, one-off room layouts, movement, and throwaway details are ignored.</li>
        </ul>
        <pre>{`"Margo calls Seth hedge prince" -> storyCard
"Margo feels jealous but hides it" -> brainUpdate only if Margo Brain exists
"The couch is against the west wall" -> ignore
"Magic cannot cross the warded threshold" -> storyCard
"The Beast is actively hunting Seth tonight" -> plotEssentialsUpdate`}</pre>
      </>
    ),
  },
  {
    id: "authoring-best-practices",
    title: "Authoring Best Practices",
    category: "Best Practices",
    summary: "Where AI Instructions, Plot Essentials, and Story Cards belong, based on the BetterRepository guide.",
    tags: ["betterrepository", "ai instructions", "plot essentials", "story cards", "triggers", "best practices"],
    body: (
      <>
        <p>
          These defaults follow the BetterRepository authoring guide: use AI Instructions for behavior, Plot Essentials
          for the overarching premise, and Story Cards for durable triggered memory. The executable copy of these
          rules lives in <code>src/ai/authoringBestPractices.ts</code> so generators and docs stay aligned.
        </p>
        <dl>
          <dt>AI Instructions</dt>
          <dd>
            Global behavior rules only: genre contract, drift prevention, scene loop, prose style, model behavior, and
            scenario-specific writing constraints. Do not store character facts, lore facts, current scene state,
            backstory, or per-character voice here.
          </dd>
          <dt>Plot Essentials</dt>
          <dd>
            The overarching premise, central long-term conflict, and persistent story-wide constraints. PE rarely changes. Automatic suggestions require review; replaced text stays in component history.
          </dd>
          <dt>Story Cards</dt>
          <dd>
            Durable triggered records for one subject: character, location, faction, object, relationship, secret, rule,
            or completed event. Static cards use present tense for always-true facts, living cards track current evolving
            subjects, and historical cards use past tense for completed events.
          </dd>
        </dl>
        <p><strong>Trigger rule:</strong> character aliases belong on character identity cards. Event, relationship, and subplot cards should use specific trigger phrases, not broad character names that already belong to other cards.</p>
        <p><strong>Generator rule:</strong> generated cards should avoid temporary details, be concise and self-contained, repeat the subject in the body, and use the correct memory mode and tense.</p>
      </>
    ),
  },
  {
    id: "new-adventure-generator-recipes",
    title: "New Adventure AI Generator - Setup Recipes",
    category: "Best Practices",
    summary: "How to choose generator options based on the kind of adventure you want.",
    tags: ["new adventure", "generate with ai", "ai instructions", "plot essentials", "nsfw", "setup"],
    body: (
      <>
        <p>
          Generate with AI asks what kind of story you want, then routes the setup into the right surfaces. You choose
          outcomes; the app decides whether the result belongs in AI Instructions, Plot Essentials, Active Pressure,
          Author's Note, Story Cards, or Brains.
        </p>
        <dl>
          <dt>Sandbox</dt>
          <dd>Lighter AI Instructions, broader factions and locations, loose hooks, and lean Plot Essentials.</dd>
          <dt>Mission loop</dt>
          <dd>A repeatable custom loop component, current assignment pressure, team cards, handler/enemy cards, and fallout hooks.</dd>
          <dt>Mystery</dt>
          <dd>The current known question goes in Plot Essentials. Clues, suspects, secrets, and locations go on Story Cards.</dd>
          <dt>Faction politics</dt>
          <dd>Active Pressure names the current public pressure. Factions, leaders, alliances, leverage, and secrets go on cards.</dd>
          <dt>Romance drama</dt>
          <dd>Relationship pressure stays choice-driven. Living relationship cards and Brains carry evolving state instead of bloating PE.</dd>
          <dt>Survival / horror</dt>
          <dd>Active Pressure tracks the current external threat. Story Cards hold threat rules, safe places, recurring dangers, and costs.</dd>
        </dl>
        <p><strong>Prose mode is separate.</strong> Minimalist is fast and lean; novelistic is richer and slower; cinematic focuses on visible behavior and blocking; dialogue-heavy prioritizes distinct voices and social pressure.</p>
        <p><strong>Player control is separate.</strong> Strict mode never writes your character. Minor-actions mode may bridge tiny implied motions. Cinematic flow may write small player-character beats, but major choices stay yours.</p>
        <p><strong>Adult content / NSFW is explicit opt-in.</strong> Romance-only creates attraction and intimacy without explicit adult content. Explicit adult mode adds a separate adult-content section, consenting-adult framing, and your boundary notes. Keep adult preferences visible and separate from generic prose rules.</p>
        <p><strong>Plot Essentials stays small.</strong> Do not let setup templates turn PE into a quest log, relationship tracker, inventory, or character voice guide. Those usually belong in Story Cards or Brains.</p>
      </>
    ),
  },
  {
    id: "best-practices-brain",
    title: "Brain Thoughts — Best Practices",
    category: "Best Practices",
    summary: "What to put in a character brain and how to write thoughts that steer the story.",
    tags: ["brain", "character", "thoughts", "inner state", "best practices"],
    body: (
      <>
        <p>
          Brains store a character's private, evolving inner state — what they are thinking, feeling, suspecting, or planning. The model reads brains but never quotes them directly to the player.
        </p>
        <p><strong>What belongs in a brain thought:</strong></p>
        <ul>
          <li>A specific reaction to something that just happened, in first person and in the character's voice.</li>
          <li>A private suspicion or plan the character hasn't revealed.</li>
          <li>A shift in how the character now sees another person or situation.</li>
          <li>Something the character is hiding or suppressing.</li>
        </ul>
        <p><strong>What does NOT belong:</strong></p>
        <ul>
          <li>Generic emotional states: "feeling anxious", "excited", "uneasy". These give the model nothing actionable.</li>
          <li>Scene descriptions or location tracking — keep that in Recent Messages unless it becomes durable.</li>
          <li>Permanent character traits — those belong in a Story Card.</li>
          <li>Things the character has already said or done openly — that's in the transcript.</li>
        </ul>
        <p><strong>Good:</strong> <code>margo_on_setu_ward_question: "She asked about the ward the same way she asked about the knife last winter. She already knows. I need to decide before the delegation arrives whether to tell her or redirect."</code></p>
        <p><strong>Bad:</strong> <code>mood: "Margo is anxious and protective."</code></p>
        <p>
          Thoughts are captured inline during story generation at zero extra API cost. Each thought should have a descriptive snake_case key. Old thoughts are automatically archived when the brain grows long.
        </p>
      </>
    ),
  },
  {
    id: "best-practices-story-cards",
    title: "Story Cards — Best Practices",
    category: "Best Practices",
    summary: "What Story Cards are for, how to write them, and what to exclude.",
    tags: ["story cards", "memory", "durable facts", "best practices"],
    body: (
      <>
        <p>
          Story Cards store durable, recurring facts. They enter context only when their trigger keys appear — so they stay dormant and cost no tokens when off-topic.
        </p>
        <p><strong>What belongs in a Story Card:</strong></p>
        <ul>
          <li>A character's permanent traits, history, relationships, and rules of behavior.</li>
          <li>A location's sensory details, layout, and significance.</li>
          <li>A recurring object, secret, promise, or rule the story keeps returning to.</li>
          <li>Canon facts that must stay consistent regardless of scene.</li>
        </ul>
        <p><strong>What does NOT belong:</strong></p>
        <ul>
          <li>Current location or scene presence — keep that in Recent Messages unless it becomes durable.</li>
          <li>Temporary mission status or current assignments.</li>
          <li>Emotional reactions to specific events — that's a Brain thought.</li>
          <li>One-off scenery or room details that won't recur.</li>
        </ul>
        <p><strong>Format:</strong> Bullet points, one per line, using •. Each bullet is one self-contained fact. Lead with what is always true, then add specific constraints or rules.</p>
        <p><strong>Memory mode:</strong> Static cards are always-true facts in present tense. Living cards are current evolving subjects that updates merge/archive. Historical cards are completed events or retired PE facts in past tense.</p>
        <p><strong>Trigger keys:</strong> Use specific names, places, nicknames, objects, factions, and consequences. Character aliases belong on character identity cards; avoid putting broad character names on event, relationship, or subplot cards.</p>
        <p><strong>Good card:</strong></p>
        <pre>{`• Margo uses teasing to deflect when she's afraid.
• She has a long-running private joke calling Seth "hedge prince."
• She knows more about the ward than she has admitted.
• She will not act against Seth directly, but she will redirect him.`}</pre>
      </>
    ),
  },
  {
    id: "best-practices-pe",
    title: "Plot Essentials — Best Practices",
    category: "Best Practices",
    summary: "How to use Plot Essentials effectively without cluttering it with scene state.",
    tags: ["plot essentials", "world blocks", "canon", "best practices"],
    body: (
      <>
        <p>
          Plot Essentials is an always-on context component for the story's overarching premise, central long-term conflict, and persistent story-wide constraints. It loads every turn and costs tokens every turn — keep it tight.
        </p>
        <p><strong>What belongs:</strong></p>
        <ul>
          <li>The overarching premise: who the story follows and its enduring central conflict.</li>
          <li>Long-term stakes that remain relevant across scenes and arcs. Put immediate threats and obligations in Active Pressure.</li>
          <li>Major constraints: power rules, public stakes, faction pressure, or canon limits that remain globally relevant.</li>
        </ul>
        <p><strong>What does NOT belong:</strong></p>
        <ul>
          <li>Current scene position or who is present — keep that in Recent Messages unless it becomes a durable constraint.</li>
          <li>Character emotional states or internal goals.</li>
          <li>Temporary mission status that changes every few turns — use Current Arc or Active Pressure.</li>
          <li>Lore that only matters when a specific character or place comes up — use a Story Card instead.</li>
        </ul>
        <p><strong>Format:</strong> 4-7 tight bullets or short labeled lines. PE updates replace the full block. Change PE only when its foundations change. Replaced text stays in component history; removal does not create an event card.</p>
        <p><strong>Good PE entry:</strong> <code>• Seth is an exile whose unstable bond with the ward threatens both his freedom and the sanctuary he seeks.</code></p>
        <p><strong>Bad PE entry:</strong> <code>• Seth and Margo are currently standing near the threshold discussing the ward.</code> (scene state, not a permanent truth)</p>
      </>
    ),
  },
  {
    id: "best-practices-summary",
    title: "Durable Summary — Best Practices",
    category: "Best Practices",
    summary: "What the legacy Rolling Summary field is for and what replaced it in active context.",
    tags: ["rolling summary", "summary", "continuity", "best practices"],
    body: (
      <>
        <p>
          Rolling Summary is a legacy save-compatible field. It is retained on the adventure object for old saves, but it is not emitted as a default model context section. Use Current Arc, Plot Essentials, Active Pressure, Story Cards, Brains, and Recent Messages for active continuity.
        </p>
        <p><strong>What belongs:</strong></p>
        <ul>
          <li>Arc beats — the key moments that moved the story forward.</li>
          <li>Permanent changes — decisions made, things revealed, bridges burned.</li>
          <li>Open plot threads — unresolved problems, active threats, things the player character still needs to do.</li>
          <li>Relationship shifts — changes in how characters relate to each other.</li>
        </ul>
        <p><strong>The most important rule:</strong> If the summary fills with emotional beats and relationship milestones without any external threat, unresolved problem, or active obligation, the model will write a relationship story. Keep at least one external arc, unresolved problem, or active threat visible here alongside personal developments.</p>
        <p><strong>What does NOT belong:</strong></p>
        <ul>
          <li>Scene descriptions or current location.</li>
          <li>Character inner thoughts — those belong in Brains.</li>
          <li>Permanent world facts that belong in Story Cards or Plot Essentials.</li>
        </ul>
        <p>For current adventures, keep external stakes visible through Active Pressure and Current Arc instead of relying on auto-summary settings.</p>
      </>
    ),
  },
  {
    id: "best-practices-active-pressure",
    title: "Active Pressure — Best Practices",
    category: "Best Practices",
    summary: "What Active Pressure tracks and how to write it so the model stays in external-stakes mode.",
    tags: ["active pressure", "pressure", "threat", "obligation", "best practices"],
    body: (
      <>
        <p>
          Active Pressure is one sentence describing the external threat, obligation, or force currently bearing on the player character at the story level. It tells the model "this is what is pushing or threatening right now" — and it should replace the previous value entirely when the pressure changes.
        </p>
        <p><strong>Active Pressure answers:</strong> <em>What is currently threatening, pressing, or obligating the player character from the outside?</em></p>
        <p><strong>Good Active Pressure:</strong></p>
        <ul>
          <li>"The delegation arrives at dawn. Setu has until then to decide whether to reveal what she knows."</li>
          <li>"The Beast has scented the group and is circling the ward's outer edge."</li>
          <li>"Kael has issued a public challenge. Not responding by nightfall reads as surrender."</li>
        </ul>
        <p><strong>Bad Active Pressure:</strong></p>
        <ul>
          <li>"Setu feels the weight of her choices pressing in." (character emotion, not external pressure)</li>
          <li>"There is tension between Margo and Seth." (relationship state, not a story-level threat)</li>
          <li>"Setu is uncertain about what to do next." (internal state, not external force)</li>
        </ul>
        <p>Active Pressure is auto-updated by the semantic engine. You can also edit it directly if the model's version misses the real threat.</p>
      </>
    ),
  },
  {
    id: "best-practices-momentum",
    title: "Immediate Momentum — Disabled",
    category: "Best Practices",
    summary: "Immediate Momentum is a disabled legacy component.",
    tags: ["immediate momentum", "momentum", "direction", "next action", "best practices"],
    body: (
      <>
        <p>
          Immediate Momentum is disabled and no longer generated, auto-updated, or assembled into model context. Use Recent Messages for live scene direction and Next Output Bias for one-turn steering.
        </p>
      </>
    ),
  },
  {
    id: "best-practices-narration-rules",
    title: "Narration Rules — Best Practices",
    category: "Best Practices",
    summary: "How the default Narration Rules work and how to customize them without breaking immersion.",
    tags: ["narration rules", "scene transitions", "prose", "agency", "best practices"],
    body: (
      <>
        <p>
          Narration Rules are the primary per-adventure behavior contract. They load every turn at the top of the system prompt and control perspective, agency, continuity, character behavior, and prose style. The defaults cover the most common failure modes out of the box — read them before adding a separate AI Instructions component to avoid duplicating rules.
        </p>
        <p><strong>Key rules in the default and why they exist:</strong></p>
        <ul>
          <li><strong>END OPEN</strong> — prevents option-menu endings ("Want to X, or Y?"). Models trained on human approval data default to presenting choices; this explicitly forbids it.</li>
          <li><strong>NARRATOR STANCE</strong> — forbids lines like "the choice is yours." The player always has options; the narrator never needs to announce it.</li>
          <li><strong>SCENE TRANSITIONS</strong> — the rule is "don't resolve decisions the player hasn't made," not "never move." If the player's action implies movement, the scene carries through. The camera only stalls if the player hasn't committed.</li>
          <li><strong>CONTINUITY</strong> — locks out outside canon. If you're using a fandom setting, the model must not import biography, relationships, or events that aren't in the active context.</li>
          <li><strong>PROSE</strong> — varied sentence rhythm, sensory detail over exposition. Scenes should feel like they're happening, not being described.</li>
        </ul>
        <p><strong>When to customize Narration Rules.</strong> The defaults work for most adventures. Customize when your adventure has a fundamentally different agency model — e.g., "DO NOT SPEAK OR TAKE ACTIONS FOR [player name]" for a strict interactive fiction setup, or second-person present tense lock when the default is flexible.</p>
        <p><strong>What not to add to Narration Rules.</strong> Scenario-specific constraints (bending rules, faction politics, setting-specific tone) belong in AI Instructions, not Narration Rules. Narration Rules are structural mechanics; AI Instructions carry premise-specific contracts.</p>
        <p><strong>Existing adventures.</strong> Untouched stock Global Generation Rules are upgraded automatically when an adventure loads. If you edited that component yourself, your version is preserved.</p>
      </>
    ),
  },
  {
    id: "best-practices-ai-instructions",
    title: "AI Instructions — Best Practices",
    category: "Best Practices",
    summary: "How to write AI Instructions that produce consistent narrative style without breaking character immersion.",
    tags: ["ai instructions", "narration", "options", "choices", "voice", "immersion", "best practices"],
    body: (
      <>
        <p>
          AI Instructions are optional always-on context sent every turn after Narration Rules. Use them for scenario-specific contracts: setting rules, power-level handling, story behavior drift prevention, and prose style guidance that is particular to this adventure. If your Narration Rules already cover stable behavior, agency, and tone, you can leave AI Instructions absent.
        </p>
        <p><strong>Structure AI Instructions with named ALL-CAPS sections.</strong> Each section should be 2–5 tight bullet points. Common sections for a well-built adventure:</p>
        <ul>
          <li><strong>SETTING</strong> — canon source, what's altered by the premise, adult-only or other hard constraints.</li>
          <li><strong>STORY BEHAVIOR</strong> — what the story should be driven by (jobs, infiltration, faction pressure) and what drift patterns to prevent (council simulation, worship, instant devotion).</li>
          <li><strong>PLAYER POWER</strong> — if the player is intentionally overpowered, explicit rules: never nerf, stakes land through timing/people/politics not incompetence, NPCs engage without worship.</li>
          <li><strong>PROSE</strong> — sentence rhythm, dialogue voice diversity, sensory vs. expository balance. This section meaningfully improves output quality even when everything else is default.</li>
          <li><strong>PREMISE-SPECIFIC RULES</strong> — bending systems, technology rules, faction logic, anything that would otherwise drift by turn 10.</li>
        </ul>
        <p><strong>The option-menu problem.</strong> Models trained on human approval data (e.g. DeepSeek) interpret "leave choices for the player" as "present explicit options." Every character ends with "Want to X, or Y?" The default Narration Rules already prevent this — don't restate it in AI Instructions.</p>
        <p><strong>Character voice anchoring.</strong> Per-character voice belongs on the character's Story Card using a Voice Contract, not in AI Instructions. AI Instructions apply globally — putting one character's rules here dilutes them and creates two sources of truth.</p>
        <p><strong>Don't duplicate Narration Rules.</strong> Perspective, continuity, language matching, and option-menu prevention are already in the default Narration Rules every turn. Restating them wastes tokens.</p>
        <p><strong>The word "choices" is a trigger.</strong> "Leave X's choices for the player" → model presents menus. Rewrite as: "leave X's exact words and reactions unwritten — end at a natural beat."</p>
      </>
    ),
  },
  {
    id: "ai-mutation-boundaries",
    title: "AI Mutation Boundaries",
    category: "Safety",
    summary: "The hard write boundaries for AI-generated updates.",
    tags: ["ai update", "mutation", "reducer", "safety"],
    body: (
      <>
        <p>
          AI-generated updates must flow through <code>applyAIMemoryUpdate</code> or a reducer-backed
          approval path. Direct mutation is not allowed.
        </p>
        <p>Allowed AI writes:</p>
        <ul>
          <li>BrainEntry fields for existing BrainEntries.</li>
          <li>StoryCard content, triggers, and state.</li>
          <li>Component content only when the component type is <code>plotEssentials</code>.</li>
        </ul>
        <p>Rejected AI writes include AI Instructions, Author's Note, provider config, trigger definitions, raw imports, quest definitions, and the system shell.</p>
      </>
    ),
  },
  {
    id: "semantic-triggers",
    title: "Semantic Triggers",
    category: "Automations",
    summary: "LLM-evaluated conditions, generated updates, cooldowns, and logs.",
    tags: ["semantic", "triggers", "evaluation", "automation"],
    body: (
      <>
        <p>
          Semantic triggers are natural-language conditions evaluated after the turn completes. They do
          not block the player's UI. If the player submits again before async updates finish, updates are
          queued and flushed before the next context assembly.
        </p>
        <p>
          Keyword and regex triggers still run synchronously before and after provider generation. Semantic
          trigger logs are visible in Automations.
        </p>
        <p>
          Generated content actions include Story Card updates and Plot Essentials updates. Brain updates
          are handled inline during story generation at zero extra API cost.
        </p>
      </>
    ),
  },
  {
    id: "provider",
    title: "Provider Configuration",
    category: "Runtime",
    summary: "OpenAI-compatible provider settings and local test keys.",
    tags: ["provider", "groq", "deepseek", "api key"],
    body: (
      <>
        <p>
          Runtime providers use OpenAI-compatible chat completions. API keys are stored in localStorage
          by the app and are not written into adventure JSON.
        </p>
        <pre>{`Base URL: https://api.groq.com/openai/v1
Model:    llama-3.3-70b-versatile`}</pre>
        <p>
          Live tests read <code>.env.test.local</code>. That file is ignored and should contain only
          throwaway test keys.
        </p>
      </>
    ),
  },
  {
    id: "import-export",
    title: "Import and Export",
    category: "Data",
    summary: "Adventure JSON backup, restore, and raw fallback behavior.",
    tags: ["import", "export", "aist", "json"],
    body: (
      <>
        <p>
          Adventure JSON should round-trip through the Import / Export page. AIST backups should
          preserve transcript, plot blocks, story cards, brains, triggers, and settings, while runtime
          API keys stay out of exported JSON.
        </p>
        <p>
          Invalid or ambiguous imported data should be rejected or preserved as raw text rather than
          silently discarded.
        </p>
      </>
    ),
  },
  {
    id: "input-modes",
    title: "Input Modes: Story, Do, Author",
    category: "Playing",
    summary: "How Story, Do, and Author modes shape the text submitted to the AI.",
    tags: ["story mode", "do mode", "author mode", "input", "turn"],
    body: (
      <>
        <dl>
          <dt>Story mode</dt>
          <dd>
            You speak as the narrator. Type a sentence that guides the next beat of the story — a direction, a happening, or a
            continuation. The text is submitted exactly as written.
          </dd>
          <dt>Do mode</dt>
          <dd>
            You speak as your character. Type in first person ("I draw my sword") or second person ("draw your sword") — the AI narrates back in second person. Good for actions, dialogue, and reactions.
          </dd>
          <dt>Author mode</dt>
          <dd>
            Out-of-character message to the AI. Use this to ask questions, give meta-instructions, or correct the AI's
            behavior without it appearing as story text. Wrapped in <code>[Out of Character: …]</code> in the transcript.
          </dd>
        </dl>
        <p>On desktop, press <strong>Enter</strong> to submit. Press <strong>Shift+Enter</strong> to insert a newline without submitting. On mobile, use the Send button.</p>
      </>
    ),
  },
  {
    id: "next-turn-note",
    title: "Next Turn Note",
    category: "Playing",
    summary: "A one-turn steering note that appears near the model context and expires after use.",
    tags: ["next turn note", "steering", "bias", "direction"],
    body: (
      <>
        <p>
          The Next Turn Note is a short instruction or reminder placed near the end of the model context — after the Rolling
          Summary and before Recent Messages — so it strongly influences the next response.
        </p>
        <p>
          It is visible (token-counted), editable, and expires after a single use by default. Use it to steer the next scene
          without permanently changing the story setup.
        </p>
        <p>Examples:</p>
        <ul>
          <li>"Keep the confrontation unresolved — Nyxa shouldn't yield yet."</li>
          <li>"Focus on atmosphere, not dialogue."</li>
          <li>"This is the turning point. Commit."</li>
        </ul>
        <p>
          Toggle <strong>Protected</strong> to prevent the note from being dropped by token truncation.
          Toggle <strong>Expires after output</strong> off to keep it active across multiple turns.
        </p>
      </>
    ),
  },
  {
    id: "token-budget",
    title: "Token Budget",
    category: "Context",
    summary: "How token budgets work for individual items and the overall context window.",
    tags: ["token budget", "tokens", "truncation", "context budget"],
    body: (
      <>
        <p>
          Every item in context — Story Cards, World Blocks, Brains, Current Arc, Author's Note, Next Turn Note, and Recent Messages — has an estimated token cost.
          The total is shown in Context Preview and in the header of the Play page.
        </p>
        <dl>
          <dt>Item token budget</dt>
          <dd>
            An optional cap per Story Card or World Block. If an item's content exceeds its budget, it is truncated or
            excluded when the overall context is tight. Set to 0 (the default) for no per-item cap.
          </dd>
          <dt>Protected items</dt>
          <dd>
            Items marked Protected are never dropped by truncation, regardless of the budget. Use this sparingly — too many
            protected items can crowd out triggered context.
          </dd>
          <dt>Priority</dt>
          <dd>
            When the context is over budget, higher-priority items survive longer. Items with the same priority are dropped
            newest-first (or by pinned status).
          </dd>
        </dl>
        <p>
          Watch the token count in the play header. If you see it climbing above ~6,000–8,000 tokens with a smaller model,
          consider reducing always-on World Blocks, trimming long Story Cards, or lowering the Recent Messages window.
        </p>
      </>
    ),
  },
  {
    id: "story-cards-vs-world-blocks",
    title: "Story Cards vs World Blocks",
    category: "Memory",
    summary: "When to use a Story Card vs a World Block (Component).",
    tags: ["story cards", "world blocks", "components", "memory routing"],
    body: (
      <>
        <dl>
          <dt>Story Cards</dt>
          <dd>
            Use for facts that are only relevant part of the time — characters, places, secrets, relationships, rules.
            They stay dormant until their trigger keys appear in the input or output, so they don't waste token budget
            when off-topic.
          </dd>
          <dt>World Blocks (Components)</dt>
          <dd>
            Use for context that is relevant every turn — your AI Instructions, Plot Essentials, Author's Note, and
            broad world lore that shapes every scene. These load unconditionally and cost tokens every turn.
          </dd>
        </dl>
        <p>
          A good rule of thumb: if you'd only need to know it when the character or place comes up, it's a Story Card.
          If it should always shape how the AI writes, it's a World Block.
        </p>
      </>
    ),
  },
  {
    id: "continue-action",
    title: "Continue",
    category: "Playing",
    summary: "Continue asks the AI to keep writing without adding any player text.",
    tags: ["continue", "generation", "turn"],
    body: (
      <>
        <p>
          Clicking <strong>Continue</strong> sends the current context to the AI and asks it to generate more story text —
          without adding any player-authored message to the transcript first.
        </p>
        <p>
          This is useful when the AI ended mid-scene, when you want it to keep going in the same direction, or when you
          just don't have anything to add yet. It does <em>not</em> inject a "Continue." user message — the transcript
          stays clean.
        </p>
      </>
    ),
  },
  {
    id: "opening-scene-author-note",
    title: "Opening Scene & Author's Note",
    category: "Playing",
    summary: "Two special setup fields accessible from the Story Setup panel on the Play page.",
    tags: ["opening scene", "author's note", "setup", "context"],
    body: (
      <>
        <dl>
          <dt>Opening Scene</dt>
          <dd>
            A first assistant message placed at the oldest end of the Recent Messages window. It sets the stage for
            the story — tone, setting, initial situation. It is included when the context budget allows and falls
            off naturally as the conversation grows long, like any other message.
          </dd>
          <dt>Author's Note</dt>
          <dd>
            A short instruction placed near the bottom of the context (close to recent messages) so it influences the
            AI's next response strongly. Think of it as a running whisper to the narrator: "Keep the tone tense",
            "This is a political drama, not action", "The protagonist never fully relaxes."
          </dd>
        </dl>
        <p>
          Both are accessible from the Story Setup panel at the top of the Play page, collapsed by default so they
          don't clutter the main view.
        </p>
      </>
    ),
  },
  {
    id: "tests",
    title: "Testing Commands",
    category: "Development",
    summary: "Deterministic unit tests, live provider checks, and production build.",
    tags: ["testing", "vitest", "build", "live"],
    body: (
      <>
        <pre>{`npm.cmd test
npm.cmd run build
npm.cmd run test:live`}</pre>
        <p>
          Normal tests are deterministic and do not require a live API. Live tests are opt-in and cover
          provider, semantic trigger, manual brain update, and Remember This flows.
        </p>
      </>
    ),
  },
];

function searchableText(topic: DocTopic): string {
  return [topic.title, topic.category, topic.summary, ...topic.tags].join(" ").toLocaleLowerCase();
}

export function HelpPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredTopics = useMemo(
    () => topics.filter((topic) => !normalizedQuery || searchableText(topic).includes(normalizedQuery)),
    [normalizedQuery],
  );
  const categories = Array.from(new Set(filteredTopics.map((topic) => topic.category)));

  return (
    <section className="page docs-page">
      <header className="docs-header">
        <div>
          <p className="eyebrow">Reference</p>
          <h2>AI Story Teller Documentation</h2>
          <p className="muted">Technical reference for context, memory, triggers, persistence, and testing.</p>
        </div>
        <label className="docs-search">
          <span>Search docs</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="context, brain, provider, trigger..."
          />
        </label>
      </header>

      <div className="docs-layout">
        <aside className="docs-toc panel">
          <strong>Topics</strong>
          {filteredTopics.length === 0 ? (
            <p className="muted">No matches.</p>
          ) : (
            <nav>
              {categories.map((category) => (
                <div key={category} className="docs-toc-group">
                  <span>{category}</span>
                  {filteredTopics
                    .filter((topic) => topic.category === category)
                    .map((topic) => (
                      <a key={topic.id} href={`#${topic.id}`}>
                        {topic.title}
                      </a>
                    ))}
                </div>
              ))}
            </nav>
          )}
        </aside>

        <div className="docs-content">
          {filteredTopics.map((topic) => (
            <article key={topic.id} id={topic.id} className="panel docs-topic">
              <div className="docs-topic-heading">
                <div>
                  <span className="docs-category">{topic.category}</span>
                  <h3>{topic.title}</h3>
                </div>
                <div className="docs-tags">
                  {topic.tags.slice(0, 4).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <p className="muted">{topic.summary}</p>
              <div className="docs-body">{topic.body}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
