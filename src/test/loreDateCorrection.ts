import type { StoryTime } from "../types/adventure";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { makeStoryCardSuggestion } from "../memory/storyCardSuggestions";
import { makeMemoryProposal } from "./goldenAdventure";
import { reviewedProposal } from "./memoryPlacement";

export const correctionDay = (date: string): StoryTime => ({ text: date, date, precision: "day" });
export function loreCorrectionFixture() {
  const a = createDefaultAdventure();
  a.storyClock = { current: correctionDay("2001-09-08"), anchor: correctionDay("2001-09-08"), origin: "established" };
  a.storyCards = [makeStoryCard({ id: "history", title: "Archive agreement", type: "lore", content: "The archivist granted supervised reading privileges.",
    lore: { occurredAt: correctionDay("2001-09-04"), lastChangedAt: correctionDay("2001-09-04"), status: "ongoing", sourceMessageIds: ["original"], knownTo: ["Mira"] } })];
  a.messages = [
    { id: "stale", content: "Mira discovered the lost royal archive." },
    { id: "historical", content: "September 3, 2001\nThe council signed a trade treaty." },
    { id: "append", content: "The archivist gave Mira exclusive access to sealed records." },
    { id: "unselected", content: "The queen appointed Mira as royal investigator." },
  ].map(m => ({ ...m, role: "assistant" as const, createdAt: "2026-10-29", storyTime: correctionDay("2001-09-02") }));
  a.activeState.memoryProposals = a.messages.map(source => reviewedProposal(a, { ...makeStoryCardSuggestion(a, source.id, source.content, {
    title: source.id === "append" ? "Archive agreement" : source.id === "historical" ? "Trade treaty" : source.id === "unselected" ? "Royal appointment" : "Archive discovery",
    content: source.content.split("\n").at(-1)!, evidence: source.content.split("\n").at(-1)!, reason: "A lasting development.",
  }), id: source.id }));
  const stale = a.activeState.memoryProposals[0];
  for (const status of ["approved", "rejected", "ignored"] as const) a.activeState.memoryProposals.push({ ...stale, id: status, title: status, status });
  a.activeState.memoryProposals.push(makeMemoryProposal({ id: "brain", proposedType: "brainUpdate", title: "Private thought" }));
  for (const type of ["character", "location", "custom"] as const) a.activeState.memoryProposals.push({ ...stale, id: type, title: type, storyCardType: type });
  return a;
}
