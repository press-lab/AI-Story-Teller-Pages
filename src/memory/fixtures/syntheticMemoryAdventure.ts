import { createDefaultAdventure, makeStoryCard } from "../../state/defaults";
import type { Message } from "../../types/adventure";

/** Invented software-test data. No message, identity or content is copied from a save. */
export const offerSourceId = "synthetic-source-14";
export const partnershipSourceId = "synthetic-source-15";
export const acceptanceId = "synthetic-player-15";
export const recordedLoreId = "synthetic-recorded-meeting";
export const offerQuote = "I propose a share of sales for your custom designs.";
export const acceptanceQuote = "I accept the collaboration.";
export const confirmationQuote = "Avery Stone shook Casey Vale's hand to confirm the agreement.";

export function syntheticMemoryAdventure(recordedMeeting = false) {
  const a = createDefaultAdventure("Synthetic memory software regression");
  a.storyClock = { origin: "established", current: { text: "2000-01-01", date: "2000-01-01", precision: "day" } };
  a.storyCards = ["Casey Vale", "Avery Stone", "Blair Reed", "Robin Jordan"].map(title => makeStoryCard({
    title, content: `${title} is a known workshop visitor.`, type: "character", keys: title === "Robin Jordan" ? [title] : [title, title.split(" ")[0]],
  }));
  a.messages = [];
  for (let index = 1; index <= 15; index++) {
    const player: Message = { id: `synthetic-player-${index}`, role: "user", content: `I inspect sample ${index}.`, createdAt: "2000-01-01" };
    const narrator: Message = { id: `synthetic-source-${index}`, role: "assistant", content: `Sample ${index} remains on its shelf.`, createdAt: "2000-01-01",
      storyTime: a.storyClock.current, memoryRecovery: { status: "pending", turn: index + 22 } };
    if (index === 12) narrator.content = "Robin Jordan arrives to visit the workshop.";
    if (index === 13) narrator.content = "Avery Stone and Blair Reed ask Casey Vale about custom designs.";
    if (index === 14) narrator.content = `Avery Stone says, "${offerQuote}" Robin says the schedule can be discussed later.`;
    if (index === 15) { player.content = acceptanceQuote; narrator.content = confirmationQuote + " Blair Reed will arrange a workshop tour later."; }
    a.messages.push(player, narrator);
  }
  if (recordedMeeting) {
    a.messages.at(-2)!.content = "I greet Morgan without knowing their public reputation.";
    a.messages.at(-1)!.content = "Morgan welcomes Rowan and appreciates being treated as an ordinary visitor.";
    a.storyCards.push(makeStoryCard({ id: recordedLoreId, title: "Morgan and Rowan: first introduction", type: "lore", memoryMode: "historical",
      content: "This records the first on-screen introduction between Morgan and Rowan.",
      keys: ["introduction"], lore: { status: "completed", sourceMessageIds: [partnershipSourceId] } }));
    // Name-based inventory alone fills all eight slots before source-linked Lore.
    for (let index = 0; index < 10; index++) a.storyCards.push(makeStoryCard({ title: `Visitor ${index}`, type: "character",
      content: "An established visitor.", keys: ["Morgan", "Rowan", "ordinary visitor"] }));
  }
  a.memoryAutoApprove.loreStoryCard = false; a.memoryAutoApprove.otherStoryCard = false;
  a.memoryDetectionSettings = { enabled: true, generateContent: true, evaluator: "dedicated", everyNTurns: 0 };
  a.semanticEvaluationSettings.backgroundProviderConfig = undefined;
  a.semanticEvaluationSettings.memoryEvaluationApi = "chat";
  a.activeState.memoryRecoveryStoryTurn = 45;
  return a;
}
