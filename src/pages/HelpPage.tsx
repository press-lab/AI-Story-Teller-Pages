import { useMemo, useState, type ReactNode } from "react";

import { AUTHORING_SECTIONS, CHATGPT_AUTHORING_INSTRUCTIONS } from "../ai/authoringPolicy";

interface DocTopic {
  id: string;
  title: string;
  category: string;
  summary: string;
  tags: string[];
  body: ReactNode;
}

const topics: DocTopic[] = [
  ...AUTHORING_SECTIONS.map((section): DocTopic => ({
    id: `authoring-${section.id}`,
    title: section.title,
    category: "Authoring Standards",
    summary: section.text,
    tags: ["authoring", "create", "edit", section.title.toLowerCase()],
    body: <>{section.text.split("\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</>,
  })),
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
          opening scene, tight Plot Essentials, optional scenario-specific
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
          update or Plot Essentials update through reducer-backed paths.
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
          Use <strong>Draft a Story Card with AI</strong> to choose a card focus, an optional destination,
          and the thing that should be remembered. The AI compares the brief with existing cards
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
    id: "side-menu-world-blocks",
    title: "World Blocks",
    category: "Side Menu",
    summary: "Manage Narration Rules, AI Instructions, Plot Essentials, Author's Note, and custom components.",
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
          System memory triggers are the zero-cost inline memory tags the model can append after a response.
          Use <strong>Quiet entity-only</strong> when you only want new characters and world facts. Use{" "}
          <strong>Balanced story memory</strong> when you also want relationship milestones, plot beats, and
          status changes to create Memory Suggestions. The prompt still asks for only the strongest durable
          memory per response, and duplicate proposals are filtered by the reducer.
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
    summary: "Chronicle, Next Turn Note, Story Cards, Brains, Plot Essentials, and Memory Suggestions roles.",
    tags: ["memory", "chronicle", "summary", "next turn note", "story cards", "brains"],
    body: (
      <>
        <dl>
          <dt>Adventure Chronicle</dt>
          <dd>The complete transcript. Stored locally, not compressed, not automatically dumped into context.</dd>
          <dt>Next Turn Note</dt>
          <dd>Short-term user-written steering for the next generation. It is visible, token-counted, and expires after use by default.</dd>
          <dt>Story Cards</dt>
          <dd>Durable content triggered by keywords, phrases, or regex configuration. Generated Story Card changes wait for review by default; auto-approval is optional. Chronicle can evaluate one entry or up to ten narrator entries on demand.</dd>
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
          <li>Plot Essentials holds the enduring premise and scenario-wide constraints.</li>
          <li>Meaningful historical events belong in Lore, not Character cards.</li>
          <li>Ephemeral scenery, one-off room layouts, movement, and throwaway details are ignored.</li>
        </ul>
        <pre>{`"Margo calls Seth hedge prince" -> storyCard
"Margo feels jealous but hides it" -> brainUpdate only if Margo Brain exists
"The couch is against the west wall" -> ignore
"Magic cannot cross the warded threshold" -> storyCard
"The Beast attacked the sanctuary" -> Lore`}</pre>
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
          outcomes; the app decides whether the result belongs in AI Instructions, Plot Essentials,
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
          <dd>Plot Essentials defines the enduring political framework. Use cards for factions, leaders, alliances, and secrets.</dd>
          <dt>Romance drama</dt>
          <dd>Relationship pressure stays choice-driven. Character cards hold established relationships; Lore holds their history. Player relationships require user context.</dd>
          <dt>Survival / horror</dt>
          <dd>Story Cards hold threat rules, safe places, recurring dangers, and costs.</dd>
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
          Every item in context — Story Cards, World Blocks, Brains, Author's Note, Next Turn Note, and Recent Messages — has an estimated token cost.
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
  const [copyStatus, setCopyStatus] = useState("");
  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(CHATGPT_AUTHORING_INSTRUCTIONS);
      setCopyStatus("ChatGPT instructions copied.");
    } catch {
      setCopyStatus("Could not copy instructions. Check clipboard permission and try again.");
    }
  }
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
          <button type="button" onClick={() => void copyInstructions()}>Copy ChatGPT Instructions</button>
          <p role="status" aria-live="polite">{copyStatus}</p>
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
              <p className="muted">{topic.category === "Authoring Standards" ? "Shared standards for documentation, ChatGPT, and Generate with AI." : topic.summary}</p>
              <div className="docs-body">{topic.body}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
