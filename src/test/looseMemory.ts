import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import type { Message } from "../types/adventure";
/** Synthetic data; never copied from synchronized user saves. */
export const looseResponse = [
  "S1",
  "(storyCard.lore: Weasley Tattoo Business = Fred and George agreed to produce 96 rune tattoos tomorrow.",
  "(brain: George Weasley = I believe the business can grow beyond individual customers.)",
  "S2",
  "(storyCard.character: Eleanor Vale = Eleanor is a sixth-year Ravenclaw specializing in experimental enchantments.)",
  "(storyCard.location: Observatory Annex = The annex contains a sealed underground chamber.)",
  "Source 3:",
  "[storyCard.lore: Draconia Research Meeting = Draconia agreed to meet Seth tomorrow at six. The meeting has not occurred.]",
  "(component.activePressure: Ministry Deadline = The Ministry expects the research report tomorrow.)",
].join("\n");
export const looseNarrations = [
  'Fred and George agreed to produce 96 rune tattoos tomorrow. George reflects, "I believe the business can grow beyond individual customers."',
  "Eleanor Vale is a sixth-year Ravenclaw specializing in experimental enchantments. The Observatory Annex contains a sealed underground chamber.",
  "Draconia agreed to meet Seth tomorrow at six. The meeting has not occurred. The Ministry expects the research report tomorrow.",
];
export function looseMemoryFixture(withSources = true) {
  const a = createDefaultAdventure("Synthetic loose memory routing");
  a.memoryDetectionSettings = { ...a.memoryDetectionSettings, pipeline: "singlePass", enabled: true, everyNTurns: 1, generateContent: true };
  a.memoryAutoApprove.storyCard = true; a.memoryAutoApprove.brainUpdate = true; a.memoryAutoApprove.plotPressureUpdate = true;
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = false;
  a.storyCards = [
    makeStoryCard({ id: "business", title: "Weasley Tattoo Business", type: "lore", keys: ["rune tattoos", "tattoo business"], content: "Fred and George run a tattoo business." }),
    ...["Fred Weasley", "George Weasley", "Draconia Malfoy"].map(name => makeStoryCard({
      id: name.split(" ")[0].toLowerCase(), title: name, type: "character", keys: [name, name.split(" ")[0]], content: name + " is an established student.",
    })),
    makeStoryCard({ id: "location", title: "Great Hall", type: "location", keys: ["Hall"], content: "The hall has four long tables." }),
    makeStoryCard({ id: "custom", title: "Rune Tattoo System", type: "custom", keys: ["rune system"], content: "The enchantments use runes." }),
  ];
  a.brains = ["Fred", "George", "Draconia"].map(name => makeBrain({
    id: "brain-" + name.toLowerCase(), characterName: name + (name === "Draconia" ? " Malfoy" : " Weasley"), active: true,
    linkedStoryCardId: name.toLowerCase(), triggers: [name], thoughts: {},
  }));
  a.components = [
    makeComponent({ id: "pressure", title: "Ministry Deadline", type: "activePressure", active: true, autoUpdate: true, content: "No deadline has been imposed." }),
    makeComponent({ id: "arc", title: "Research Arc", type: "currentArc", active: true, autoUpdate: true, arcPremise: "Investigate magical research.", content: "The investigation began." }),
  ];
  a.messages = withSources ? looseNarrations.map((content, index): Message => ({ id: "narrator-" + (index + 1), role: "assistant", content,
    createdAt: "2000-01-01", inputMode: "story", memoryEvaluation: { pipeline: "singlePass", status: "pending", attempts: 0, turn: index + 1,
      revision: "revision-" + index, completedGroups: [] } })) : [];
  return { a, ids: a.messages.map(m => m.id) };
}
