import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard, normalizeAdventure } from "../state/defaults";
import { adventureReducer } from "../state/adventureReducer";
import { buildContext } from "../contextBuilder/contextBuilder";
import { exportAdventureJson, importAdventureJson } from "../utils/json";
import { storyCardContextContent } from "./storyCardPolicy";
import { onePassMemoryActions, onePassMemoryInstruction } from "./onePassMemory";
import { runStoryCardAudit } from "./storyCardAudit";
import { storyCardAuditSuggestions } from "./storyCardAuditSuggestions";
import type { MemoryProposal } from "../types/adventure";

const profile = "Margo is an empathic sorcerer with telekinesis and flight. Eliot is her closest friend.\nVOICE CONTRACT: sharp, economical and devastatingly funny.";
function fixture() {
  const a = createDefaultAdventure();
  a.storyCards = [makeStoryCard({ id: "margo", title: "Margo", type: "character", memoryMode: "living", content: profile, pinned: true, tokenBudget: 80 })];
  return a;
}
function proposal(content: string, id: string): MemoryProposal {
  return { id, proposedType: "storyCard", title: "Margo", targetId: "margo", content, appendContent: true, memoryMode: "living", suggestedTriggers: [], sourceTurnId: "story", sourceText: content, rationale: "Established fact", confidence: 1, status: "pending", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
}

describe("character foundations under living-card updates", () => {
  it("keeps identity, ties, abilities and voice through repeated overflow, histories and reload", () => {
    let a = fixture();
    for (let n = 0; n < 20; n++) {
      const p = proposal(`Established development ${n}: ${"detail ".repeat(20)}`, `p${n}`);
      a = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
      a = adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    }
    const card = a.storyCards[0];
    expect(storyCardContextContent(card)).toContain(profile.split("\n")[0]);
    expect(storyCardContextContent(card)).toContain("VOICE CONTRACT");
    expect(card.content.length).toBeLessThanOrEqual(320);
    expect(card.archivedFacts).toContain("development 0");
    expect(card.archivedFacts).not.toContain("VOICE CONTRACT");
    expect(card.memoryUpdateHistory).toHaveLength(20);
    const reload = importAdventureJson(exportAdventureJson(a));
    expect(reload.storyCards[0].coreFacts).toEqual(card.coreFacts);
    expect(buildContext(reload).messages.map(m => m.content).join("\n")).toContain("VOICE CONTRACT");
  });

  it("recovers the demonstrated archived paragraph without exposing arbitrary archives", () => {
    const a = fixture();
    a.storyCards[0] = { ...a.storyCards[0], content: "Margo owns a signed novel.", archivedFacts: profile.replace("\n", " ") + "\nAn old, superseded travel status." };
    const restored = normalizeAdventure(a).storyCards[0];
    expect(storyCardContextContent(restored)).toContain("Eliot is her closest friend");
    expect(storyCardContextContent(restored)).toContain("signed novel");
    expect(storyCardContextContent(restored)).not.toContain("superseded travel");
    expect(a.storyCards[0].coreFacts).toBeUndefined();
  });

  it("retains foundations for direct AI replacement and permits explicit core editing", () => {
    let a = adventureReducer(fixture(), { type: "APPLY_STORY_CARD_UPDATE", storyCardId: "margo", content: "A new current fact." });
    expect(storyCardContextContent(a.storyCards[0])).toContain("telekinesis");
    a = adventureReducer(a, { type: "UPDATE_STORY_CARD", storyCardId: "margo", patch: { coreFacts: ["Margo's revised profile."], content: "New notes." } });
    expect(storyCardContextContent(normalizeAdventure(a).storyCards[0])).not.toContain("telekinesis");
  });

  it("keeps core facts in a reviewed cleanup of duplicate notes", async () => {
    let a = normalizeAdventure(fixture());
    a.storyCards[0].content = "Recent note.\nRecent note.";
    const recs = (await runStoryCardAudit(a, a.modelConfig, 20, { includeAI: false })).filter(r => r.id.startsWith("det-duplicate-lines"));
    expect(recs).toHaveLength(1);
    const p = storyCardAuditSuggestions(a, recs)[0];
    a = adventureReducer(a, { type: "ADD_MEMORY_PROPOSAL", proposal: p });
    a = adventureReducer(a, { type: "APPROVE_MEMORY_PROPOSAL", proposalId: p.id });
    expect(storyCardContextContent(normalizeAdventure(a).storyCards[0])).toContain("telekinesis");
    expect(storyCardContextContent(normalizeAdventure(a).storyCards[0]).match(/Recent note\./g)).toHaveLength(1);
  });
});

describe("established developments use existing evidence and approval paths", () => {
  it.each([
    ["Mel's Surveillance", "Mel secretly ordered surveillance of Seth; he found the watcher.", "Mel secretly ordered surveillance of Seth; he found the watcher."],
    ["Allegation Against Chase", "The witness alleged Chase aided the conspiracy; guilt remains unproven.", "The witness alleged Chase aided the conspiracy; guilt remains unproven."],
  ])("proposes %s as reviewable historical lore", (target, content, evidence) => {
    const a = fixture();
    a.memoryDetectionSettings.enabled = true;
    a.systemTriggers.enabled = true;
    a.systemTriggers.categories.plot_beat = true;
    a.memoryAutoApprove.storyCard = true;
    const actions = onePassMemoryActions(a, buildContext(a), [{ kind: "lore", target, content, evidence, reason: "Consequential established development", category: "plot_beat", triggers: [target] }], evidence, "source");
    const result = actions.reduce(adventureReducer, a);
    expect(result.storyCards).toHaveLength(1);
    expect(result.activeState.memoryProposals[0]).toMatchObject({ content, requiresReview: true, status: "pending", memoryMode: "historical" });
    const unsupported = onePassMemoryActions(a, buildContext(a), [{ kind: "lore", target, content, evidence: "An invented event without evidence", reason: "Important", category: "plot_beat", triggers: [target] }], evidence, "source");
    expect(unsupported.some(action => action.type === "ADD_MEMORY_PROPOSAL")).toBe(false);
  });
  it("asks for attribution and established consequences without narrative initiative", () => {
    const text = onePassMemoryInstruction([], ["plot_beat"]);
    expect(text).toContain("allegation, not proven guilt");
    expect(text).toContain("Use Dynamic Relationships");
    expect(text).toContain("must never steer the scene");
    expect(text).not.toContain("plotEvents");
  });
});
