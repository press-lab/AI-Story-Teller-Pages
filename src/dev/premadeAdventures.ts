import type { Adventure } from "../types/adventure";
import { buildContext } from "../contextBuilder/contextBuilder";
import { createDefaultAdventure, defaultSemanticEvaluationSettings, normalizeAdventure } from "../state/defaults";
import { sanitizeStoryCardTriggers } from "../memory/resolveMemoryTarget";
import { latestAssistantOutput } from "../state/turnPipeline";
import { nowIso } from "../utils/id";
import {
  createDevelopmentAdventure,
  developmentAdventureTitle,
} from "./developmentAdventure";
import {
  createDispatchAdventure,
  dispatchAdventureTitle,
} from "./dispatchAdventure";
import {
  createRookeryAdventure,
  rookeryAdventureTitle,
} from "./rookeryAdventure";
import {
  arcaneAfterRocketAdventureTitle,
  createArcaneAfterRocketAdventure,
} from "./arcaneAfterRocketAdventure";
import crucibleComponents from "./premades/crucible-protocol-components.json";
import crucibleStoryCards from "./premades/crucible-protocol-story-cards.json";

export type PremadeAdventureId = "dragon-throne" | "dispatch-sdn" | "crucible-protocol" | "rookery" | "arcane-after-rocket";

export interface PremadeAdventureDefinition {
  id: PremadeAdventureId;
  title: string;
  eyebrow: string;
  summary: string;
  tags: string[];
  createAdventure: () => Adventure;
  createAdventureJson: () => string;
  createStoryCardsJson: () => string;
}

const crucibleAdventureTitle = "Crucible Protocol";

const premadeComponentContent: Record<string, string> = {
  "dev-component-ai-instructions": `SETTING
- Use Avatar: The Last Airbender world logic from the adventure context: bending, nations, culture, spirits, martial arts, and postwar politics.
- Treat all main characters as adults.
- Do not import outside-canon facts unless this adventure's context establishes them.

PLAYER POWER
- Setu is intentionally overpowered; let his gold-white dragon fire and lightning matter.
- Stakes land through politics, loyalty, public consequences, romance, family, and collateral, not through secretly nerfing Setu.
- NPCs may respect, fear, court, test, or exploit his power, but they should not worship him or become simply stronger to win a scene.

STORY BEHAVIOR
- Keep the story in palace life, the crown's missions, Nyxa pressure, court knives, spirit weirdness, and the New Ozai Society thread.
- Let downtime, banter, rivalry, flirtation, meals, training, and travel breathe when no urgent crisis is active.
- Keep the antagonist pressure personal and convergent; promote seeded threads instead of inventing stranger villains.

CHARACTERS
- Honor each NPC's Story Card and VOICE CONTRACT.
- Let NPCs pressure, tempt, provoke, flirt, command, lie, test, and react; never resolve Setu's decisions for him.

PROSE
- Write in second person, present tense.
- Favor action, dialogue, sensory detail, and distinct voices over summary or exposition.
- End on a concrete beat Setu can answer, not a menu or "what do you do?" prompt.`,

  "dev-component-plot-essentials": `- Setu is the twenty-four-year-old crown prince of the Fire Nation and the crown's off-books troubleshooter, trained by Ran and Shaw in gold-white dragon fire and lightning.
- The current opening is palace training in the Caldera: Nyxa pushes Setu in the ring until a messenger summons him to answer a New Ozai Society strike on the harbor armory.
- The world is roughly twenty-two years after the Hundred Year War; Zuko's peace is real but fragile, the old colonies are becoming the United Republic, and spirits are stirring again.
- The New Ozai Society is growing bolder through sabotage, stolen weapons, propaganda, and noble money.
- Nyxa is Setu's rival, sparring partner, betrothal candidate, and primary romantic pressure; House Renzan's ambitions make that bond politically dangerous.
- The active arc is a restorationist conspiracy whose hand runs close to House Renzan, forcing Setu to choose between crown duty, Nyxa, and the peace his father built.`,

  "disp-component-ai-instructions": `SETTING
- Use the modern SDN superhero-dispatch world established in this adventure: corporate hero management, field teams, villains, PR, legal pressure, and mission fallout.
- The recurring home base is SDN life: briefings, missions, debriefs, training, labs, downtime, and workplace chaos. Keep the default tone light, witty, and sarcastic until stakes earn seriousness.
- Do not import outside facts unless the adventure context establishes them.

PLAYER POWER
- Seth/Titan is intentionally overpowered; Absolute Adaptation means survival is not the question. Years of deliberate exposure (pain, suffocation, starvation, radiation, chemicals) have left almost nothing that can touch him.
- The one opening: a genuinely novel threat he has never met can hurt him once before he adapts and becomes permanently immune. Use it sparingly for real physical tension, never the same trick twice.
- Stakes land through teammates, civilians, optics, collateral, hard choices, and Shroud's manipulation, not through quietly nerfing Seth.
- NPCs may respect, fear, court, test, or exploit him, but they should not worship him, fear-spiral, or become simply stronger to win a scene. Let impressive actions earn practical reactions: respect, rivalry, attraction, annoyance, tactical adjustment, or a quick "damn."

STORY BEHAVIOR
- Keep Z-Team's messy social ecosystem active: mission, fallout, banter, rivalry, flirtation, training, next job.
- Generate missions only when scenes need forward motion; favor jobs tied to Nix's tech, the Red Ring, Shroud, prior experiments, tech thefts, traps, surveillance, or named Red Ring threats over random assignment-of-the-day problems.
- Keep Shroud and Red Ring pressure recurring through probes, traps, aftermath clues, and targeted pressure instead of constant monologues.

ROMANCE
- The romantic tangle is central and unresolved. Nix is Seth's primary romantic and emotional focus right now; Blazer and Visi remain real romantic pressure but are pulled into the background more often by SDN duties.
- Let romance emerge through action, banter, rivalry, competence, jealousy, and private moments. No instant worship, forced commitment, or confession spam. Do not pick one for Seth. Malevola flirts as theater, not as part of the core tangle.

CHARACTERS
- Honor each NPC's Story Card and VOICE CONTRACT.
- Use codenames/handles in group, workplace, and mission scenes (Blazer, Track Star, Visi, Flambae, Nix, Malevola, Waterboy, Sightline, Punch Up, Phenomaman, Breach); use civilian names only in private, intimate, serious, unmasked, or old-friend contexts, and never mash a civilian name and codename together.
- Let NPCs pressure, tempt, provoke, flirt, command, lie, test, and react; never resolve Seth's decisions for him.

PROSE
- Write in second person, present tense.
- Favor action, dialogue, sensory detail, and distinct voices over summary or exposition.
- End on a concrete beat Seth can answer, not a menu or "what do you do?" prompt.`,

  "disp-component-plot-essentials": `- Seth Prest, codename Titan, is an SDN Z-Team hero whose Absolute Adaptation makes him effectively unkillable and permanently resistant to repeated threats; only a genuinely novel threat can hurt him once before he adapts to that too.
- The current opening is SDN's conference room: after a failed solo fight against Shroud cost Seth his standing, Blonde Blazer offers him supervised SDN work on Z-Team while both teams size him up.
- SDN is a corporate hero-dispatch agency built around missions, oversight, PR, discipline, legal cover, and workplace chaos; Track Star dispatches both Z-Team and X-Team.
- Z-Team is Seth's messy recurring social habitat: Nix, Visi, Malevola, Flambae, and Track Star generate banter, rivalry, flirtation, training, and mission fallout.
- The romantic tangle around Seth is central and unresolved — Nix is the current emotional focus, with Blazer and Visi as real but more background pressure; keep jealousy sharp without collapsing it into one pairing.
- The active arc is Shroud and the Red Ring moving again after Seth's failed fight; Shroud killed Seth's father, the Red Ring's probes bend toward Nix's tech, and Nix's estranged older sister Breach is on the rival X-Team.`,

  "cruc-comp-ai": `SETTING
- Use the Dispatch/SDN superhero workplace established in this adventure.
- Five characters are original to this story: Seth/Crucible, Nix, Breach/Rhea Knox, Sightline/Adeline Ward, and Encore/Sasha Mercer; other Dispatch characters keep the powers and roles established in the Story Cards and Plot Essentials.
- Do not import outside biography or relationships unless this adventure context establishes them.

PLAYER POWER
- Seth/Crucible is intentionally overpowered; Absolute Conversion should remain enormous and respected.
- Stakes land through people, collateral, optics, control, morality, and relationships, not through secretly nerfing Seth or inventing someone simply stronger.
- NPCs may respect, fear, court, test, or exploit his power without worshiping him.

STORY BEHAVIOR
- Keep this a superhero workplace story centered on SDN headquarters, Z-Team, X-Team, briefings, missions, experiments, downtime, debriefs, rivalry, and fallout.
- Nix is Seth's primary romantic and emotional focus; Blonde Blazer remains a real professional/romantic complication; Visi carries history and attraction without becoming the main pursuit at the start.
- Keep Shroud almost patient and indirect: probes, devices, engineered emergencies, stolen tech, surveillance, and tailored pressure.

CHARACTERS
- Honor each NPC's Story Card and VOICE CONTRACT.
- Let NPCs pressure, tempt, provoke, flirt, command, lie, test, and react; never resolve Seth's decisions for him.

PROSE
- Write in second person, present tense.
- Favor action, dialogue, sensory detail, and distinct voices over summary or exposition.
- End on a concrete beat Seth can answer, not a menu or "what do you do?" prompt.`,

  "cruc-comp-plot": `- Seth Prest, codename Crucible, has just entered the Superhero Dispatch Network after Harbor Grid made him publicly infamous: he saved civilians by absorbing an unstable Red Ring core, but the release devastated an industrial district while Shroud escaped.
- The current opening is SDN intake: the scanner arch attacks Seth, Absolute Conversion neutralizes it, Z-Team and X-Team witness the failure, and Nix cracks a Red Ring device displaying HELLO, CRUCIBLE.
- Blonde Blazer recruited Seth into supervised SDN work, assigned him to Z-Team, and placed him under Track Star's dispatch.
- SDN headquarters and its teams are the recurring social habitat: briefing, mission, debrief, training, experiments, rivalry, downtime, next pressure.
- Nix is Seth's primary romance and is already fascinated by his power and willingness to meet her chaos without flinching.
- The active long arc is Shroud, who murdered Seth's father, engineered Harbor Grid to study Absolute Conversion, and is now pressuring Seth, Nix's inventions, Waterboy's hidden scale, and the Knox-sisters fracture.`,
};

function premadeMemoryMode(card: Adventure["storyCards"][number]): Adventure["storyCards"][number]["memoryMode"] {
  if (card.type === "plot") return card.memoryMode === "living" ? "living" : "historical";
  if (card.memoryMode) return card.memoryMode;
  return "static";
}

function applyPremadeBestPractices(adventure: Adventure): Adventure {
  const normalized = normalizeAdventure(adventure);
  const componentOverrides = premadeComponentContent;
  const components = normalized.components.map((component) => {
    const override = componentOverrides[component.id];
    if (component.type === "plotEssentials") {
      return {
        ...component,
        content: override ?? component.content,
        autoUpdate: true,
        autoUpdateCooldownTurns: 0,
      };
    }
    if (override) return { ...component, content: override };
    return component;
  });
  const componentTuned = { ...normalized, components };
  const storyCards = normalized.storyCards.map((card) => ({
    ...card,
    memoryMode: premadeMemoryMode(card),
    matchType: card.matchType ?? "phrase",
    autoUpdate: premadeMemoryMode(card) === "living" ? true : card.autoUpdate,
    autoUpdateCooldownTurns: premadeMemoryMode(card) === "living"
      ? Math.min(card.autoUpdateCooldownTurns ?? 1, 1)
      : card.autoUpdateCooldownTurns,
    keys: sanitizeStoryCardTriggers(componentTuned, card.title, card.keys, card.id, premadeMemoryMode(card)),
  }));
  return normalizeAdventure({ ...componentTuned, storyCards });
}

function premadeAdventureJson(createAdventure: () => Adventure): string {
  return JSON.stringify(createAdventure(), null, 2);
}

function premadeStoryCardsJson(createAdventure: () => Adventure): string {
  const adventure = createAdventure();
  const cards = adventure.storyCards.map((card) => ({
    title: card.title,
    keys: card.keys.join(", "),
    entry: card.content,
    type: card.type,
    memoryMode: card.memoryMode,
  }));
  return JSON.stringify(cards, null, 2);
}

function createCrucibleProtocolAdventure(): Adventure {
  const timestamp = nowIso();
  const base = createDefaultAdventure(crucibleAdventureTitle);
  const components = (crucibleComponents as { components: Adventure["components"]; openingScene: string }).components;
  const openingScene = (crucibleComponents as { openingScene: string }).openingScene;
  const storyCards = crucibleStoryCards as Adventure["storyCards"];
  const adventure: Adventure = {
    ...base,
    title: crucibleAdventureTitle,
    openingScene,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      premadeAdventure: true,
      scenario: "Dispatch - Crucible Protocol",
      note: "Seth/Crucible joins SDN after Harbor Grid; Z-Team, X-Team, Nix romance, and Shroud/Red Ring pressure.",
    },
    components,
    storyCards,
    rollingSummary: {
      content: "Seth Prest, codename Crucible, has entered SDN after the Harbor Grid disaster. The intake scanner attacked him and Absolute Conversion neutralized it in front of Z-Team and X-Team. Nix cracked open a Red Ring device displaying HELLO, CRUCIBLE, confirming Shroud is still watching and has engineered pressure around Seth, Nix's inventions, Waterboy's hidden scale, and the Knox-sisters fracture.",
      updatedAt: timestamp,
    },
    messages: [
      {
        id: "crucible-msg-opening",
        role: "assistant",
        content: openingScene,
        createdAt: timestamp,
      },
    ],
    activeState: {
      ...base.activeState,
      stateFlags: {
        premadeAdventure: true,
      },
    },
    semanticEvaluationSettings: {
      ...defaultSemanticEvaluationSettings,
      messagesIncluded: 8,
      enabled: true,
      showLog: true,
      maxParallelUpdateCalls: 2,
    },
    tokenBudgetSettings: {
      ...base.tokenBudgetSettings,
      maxContextTokens: 9000,
      maxRecentMessages: 18,
      recentMessageWindow: 8,
    },
  };
  return applyPremadeBestPractices(adventure);
}

function createCrucibleProtocolAdventureJson(): string {
  return premadeAdventureJson(createCrucibleProtocolAdventure);
}

function createCrucibleProtocolStoryCardsJson(): string {
  return premadeStoryCardsJson(createCrucibleProtocolAdventure);
}

function createDragonThronePremadeAdventure(): Adventure {
  return applyPremadeBestPractices(createDevelopmentAdventure());
}

function createDragonThronePremadeAdventureJson(): string {
  return premadeAdventureJson(createDragonThronePremadeAdventure);
}

function createDragonThronePremadeStoryCardsJson(): string {
  return premadeStoryCardsJson(createDragonThronePremadeAdventure);
}

function createDispatchSdnPremadeAdventure(): Adventure {
  return applyPremadeBestPractices(createDispatchAdventure());
}

function createDispatchSdnPremadeAdventureJson(): string {
  return premadeAdventureJson(createDispatchSdnPremadeAdventure);
}

function createDispatchSdnPremadeStoryCardsJson(): string {
  return premadeStoryCardsJson(createDispatchSdnPremadeAdventure);
}

function createRookeryPremadeAdventure(): Adventure {
  return applyPremadeBestPractices(createRookeryAdventure());
}

function createRookeryPremadeAdventureJson(): string {
  return premadeAdventureJson(createRookeryPremadeAdventure);
}

function createRookeryPremadeStoryCardsJson(): string {
  return premadeStoryCardsJson(createRookeryPremadeAdventure);
}

function createArcaneAfterRocketPremadeAdventure(): Adventure {
  return applyPremadeBestPractices(createArcaneAfterRocketAdventure());
}

function createArcaneAfterRocketPremadeAdventureJson(): string {
  return premadeAdventureJson(createArcaneAfterRocketPremadeAdventure);
}

function createArcaneAfterRocketPremadeStoryCardsJson(): string {
  return premadeStoryCardsJson(createArcaneAfterRocketPremadeAdventure);
}

export const premadeAdventures: PremadeAdventureDefinition[] = [
  {
    id: "dragon-throne",
    title: developmentAdventureTitle,
    eyebrow: "Avatar AU",
    summary: "Adult Fire Nation palace missions, Setu/Nyxa chemistry, New Ozai conspiracy, and a configured Arc Director.",
    tags: ["ATLA", "court", "romance", "slow-burn arc"],
    createAdventure: createDragonThronePremadeAdventure,
    createAdventureJson: createDragonThronePremadeAdventureJson,
    createStoryCardsJson: createDragonThronePremadeStoryCardsJson,
  },
  {
    id: "dispatch-sdn",
    title: dispatchAdventureTitle,
    eyebrow: "SDN Supers",
    summary: "Original SDN superhero dispatch playtest with Seth/Titan, Z-Team chaos, romantic tangle, and Shroud pressure.",
    tags: ["Dispatch", "superheroes", "Z-Team", "dev seed"],
    createAdventure: createDispatchSdnPremadeAdventure,
    createAdventureJson: createDispatchSdnPremadeAdventureJson,
    createStoryCardsJson: createDispatchSdnPremadeStoryCardsJson,
  },
  {
    id: "crucible-protocol",
    title: crucibleAdventureTitle,
    eyebrow: "Dispatch",
    summary: "Seth/Crucible enters SDN after Harbor Grid; Nix cracks Shroud's HELLO, CRUCIBLE device as Z-Team and X-Team collide.",
    tags: ["Dispatch", "Crucible", "Nix", "Red Ring"],
    createAdventure: createCrucibleProtocolAdventure,
    createAdventureJson: createCrucibleProtocolAdventureJson,
    createStoryCardsJson: createCrucibleProtocolStoryCardsJson,
  },
  {
    id: "rookery",
    title: rookeryAdventureTitle,
    eyebrow: "Powered Mercenary Drama",
    summary: "A grimy mercenary bar, rotating contract crews, Seth's provisional first job, and living trust/romance pressure.",
    tags: ["original", "mercenaries", "bar hub", "romance"],
    createAdventure: createRookeryPremadeAdventure,
    createAdventureJson: createRookeryPremadeAdventureJson,
    createStoryCardsJson: createRookeryPremadeStoryCardsJson,
  },
  {
    id: "arcane-after-rocket",
    title: arcaneAfterRocketAdventureTitle,
    eyebrow: "Arcane AU",
    summary: "Season 2 aftermath with Seth as a proven Council mage, Hextech amplifier, and survivor of Jinx's rocket.",
    tags: ["Arcane", "Piltover", "Zaun", "Hextech"],
    createAdventure: createArcaneAfterRocketPremadeAdventure,
    createAdventureJson: createArcaneAfterRocketPremadeAdventureJson,
    createStoryCardsJson: createArcaneAfterRocketPremadeStoryCardsJson,
  },
];

export function getPremadeAdventure(id: PremadeAdventureId): PremadeAdventureDefinition | undefined {
  return premadeAdventures.find((premade) => premade.id === id);
}

export function buildPremadeContext(adventure: Adventure) {
  return buildContext(adventure, { latestModelOutput: latestAssistantOutput(adventure) });
}
