import { createDefaultAdventure, makeBrain, makeStoryCard } from "../state/defaults";
import type { SinglePassMemoryFinding } from "../types/adventure";

// Minimal synthetic examples. No private export data is included.
export const spokenFred = "Fair question, honestly — she’s one of ours now, by the transitive property of dating Press.";
export const privateFred = "I reckon George is treating this as an acquisition attempt. Press seems happy; I'll watch for trouble without making his girlfriend an enemy.";
export const privateGeorge = "Her warning addresses a risk I missed. I can accept her help while keeping control of our designs.";
export const privateDraconia = "I won't beg for their approval. Giving them a practical safeguard lets me stand beside Press on my own terms.";
export const qualitySource = `Fred tells George, “${spokenFred}” George worries aloud about losing control of the shop. Draconia offers a safeguard that keeps the designs theirs. Fred announces Gryffindor Quidditch tryouts; Ron will audition for Keeper.`;
export const recordedLore = [
  "Draconia learned that Seth's temporary tattoos last only a few days.",
  "Draconia wore Seth's blazer in public and kissed him.",
  "Draconia refused to take off her Mood Ring.",
].join(" ");
export const repeatedLore = [
  "Draconia learns Seth's tattoos fade after a few days.",
  "Draconia publicly wore Seth's blazer and kissed him.",
  "Draconia refuses to remove her Mood Ring.",
];
export function qualityFixture(count = 1) {
  const a = createDefaultAdventure("Synthetic memory quality");
  a.components = []; a.brains = []; a.storyCards = [];
  a.memoryAutoApprove.loreStoryCard = false; a.memoryAutoApprove.otherStoryCard = false; a.memoryAutoApprove.brainUpdate = false;
  a.memoryDetectionSettings = { ...a.memoryDetectionSettings, pipeline: "singlePass", enabled: true, generateContent: true, everyNTurns: 1 };
  for (const name of ["Fred", "George", "Draconia", "Hermione"]) {
    a.storyCards.push(makeStoryCard({ id: "profile-" + name, title: name, type: "character", keys: [name],
      content: name === "Draconia" ? "Personality: proud, guarded, pragmatic. Motivations: independence and earned trust. Voice: precise, dry wit. Relationship: stands beside Press without begging for approval."
        : `Personality: ${name === "Fred" ? "playful, loyal, irreverent" : "cautious, practical"}. Voice: dry humour.` }));
    a.brains.push(makeBrain({ id: "brain-" + name, characterName: name, triggers: [name], linkedStoryCardId: "profile-" + name,
      thoughts: { established: "1 → I protect the people who trust me." }, active: true }));
  }
  a.storyCards.push(makeStoryCard({ id: "relationship", title: "Seth and Draconia's Public Exposure", type: "lore", keys: ["Seth", "Draconia", "public exposure"], content: recordedLore }));
  a.messages = Array.from({ length: count }, (_, i) => ({ id: "quality-" + i, role: "assistant" as const, content: qualitySource,
    createdAt: "2026-01-01", inputMode: "story" as const, memoryEvaluation: { pipeline: "singlePass" as const, status: "pending" as const,
      turn: i + 1, attempts: 0, revision: "quality-rev-" + i, completedGroups: [] } }));
  return { a, ids: a.messages.map(m => m.id) };
}
export function thoughtFinding(name: string, content: string, sourceId = "quality-0"): SinglePassMemoryFinding {
  return { kind: "brain", targetId: "brain-" + name, title: name, brainPatch: { thoughts: { new_reaction: "2 → " + content } },
    candidateOnly: true, reason: "A supported new private interpretation.", evidenceQuotes: [{ messageId: sourceId, quote: qualitySource }] };
}
export function loreFinding(content: string, sourceId = "quality-0"): SinglePassMemoryFinding {
  return { kind: "storyCard", targetId: "relationship", title: "Seth and Draconia's Public Exposure", content, storyCardType: "lore", operation: "append",
    memoryMode: "static", eventStatus: "unresolved", suggestedTriggers: ["public exposure"], participants: ["Seth", "Draconia"],
    candidateOnly: true, reason: "A durable shared development.", evidenceQuotes: [{ messageId: sourceId, quote: qualitySource }] };
}
