import { vi } from "vitest";
import fixture from "../memory/fixtures/hogwarts-assessment.json";
import { createDefaultAdventure, defaultModelConfig, makeStoryCard } from "../state/defaults";
import type { Adventure, ChatMessage } from "../types/adventure";
import { mockAssessment } from "./memoryAssessment";
import { mockPlacementVerdict } from "./memoryPlacement";
import { approximateTokenCount } from "../tokenizer/approximateTokenCount";

export const assessmentConfig = { ...defaultModelConfig, baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-flash", apiKey: "offline-fixture" };
export const sales = "At breakfast, eleven tattoos were sold and Fred received a pouch of gold.";
export const potions = 'Seth completed a Draught of Peace in class. Snape called it "Acceptable" and announced testing at the end of the week; the test has not happened yet.';
export type AssessmentCase = "breakfast" | "charms" | "potions" | "routine";
export function assessmentFixture(name: AssessmentCase): Adventure {
  const a = structuredClone(createDefaultAdventure()); a.components = []; a.brains = []; a.storyCards = [];
  if (name === "routine") {
    a.messages = [{ id: "routine-player", role: "user", content: "I eat my toast.", createdAt: "2026-10-25" },
      { id: "routine-source", role: "assistant", content: "You finish your toast and put down the plate.", createdAt: "2026-10-25" }];
  } else {
    a.messages = structuredClone(fixture.cases[name].messages) as Adventure["messages"];
    a.messages.at(-1)!.memoryEvaluation = { ...fixture.cases[name].evaluation, completedGroups: [] } as NonNullable<Adventure["messages"][number]["memoryEvaluation"]>;
    // Re-evaluate recorded Charms facts, rather than testing the completed-source skip.
    if (name === "charms") a.messages.at(-1)!.memoryEvaluation!.status = "pending";
    if (name !== "potions") a.storyCards = fixture.cards.filter(c => name === "breakfast" ? c.id.includes("weasley_products") : c.id === "story_mvoi3gv7_i121gn1i")
      .map(c => makeStoryCard({ ...c, type: "lore", lore: undefined }));
    a.storyCards.push(...fixture.identities.map(c => makeStoryCard({ ...c, type: "character", content: "" })));
  }
  a.memoryAutoApprove.storyCard = false;
  a.semanticEvaluationSettings.requireApprovalForAutoUpdates = true;
  return a;
}

/** Real provider serialization + accounting; only the HTTP response is synthetic. */
export function mockAssessmentHttp(a: Adventure, name: AssessmentCase, options: { potionsLore?: boolean; invalid?: string; failReview?: boolean; covered?: boolean } = {}) {
  const requests: Array<{ url: string; body: Record<string, unknown>; promptTokens: number; completionTokens: number }> = [];
  const source = a.messages.at(-1)!;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const system = typeof body.system === "string" ? body.system : body.system.map((b: { text: string }) => b.text).join("\n");
    const messages: ChatMessage[] = [{ role: "system", content: system }, ...body.messages];
    const text = messages.map(m => m.content).join("\n");
    let content = "[]";
    if (system.includes("SHARED MEMORY ASSESSMENT")) {
      const decision = JSON.parse(mockAssessment(messages, name === "breakfast" ? [`storyCard:${a.storyCards[0].id}`] : [], name === "potions" && options.potionsLore));
      if (name === "breakfast") decision.storyCards.targets[0].delta = sales;
      if (name === "charms" && options.covered) decision.storyCards.targets = [{ id: `storyCard:${a.storyCards[0].id}`, delta: a.storyCards[0].content, evidenceMessageIds: [source.id] }];
      content = options.invalid ?? JSON.stringify(decision);
    } else if (system.includes("MEMORY UPDATE VALIDATION")) {
      if (options.failReview) throw new Error("offline transport failure");
      const payload = JSON.parse(messages.at(-1)!.content);
      content = JSON.stringify({ accepted: true, meaningfulChange: true, identityMatchesTarget: true,
        reason: "Controlled supported outcome, not a live semantic judgment.", evidenceMessageIds: payload.latestTurnMessageIds, placement: mockPlacementVerdict(payload) });
    } else if (text.includes("Append new durable facts about")) content = sales;
    else if (system.includes("STORY CARD MEMORY CHECK") && name === "potions" && options.potionsLore) {
      content = JSON.stringify([{ title: "Draught of Peace class", content: potions, storyCardType: "lore", eventStatus: "completed",
        rationale: "Completed class outcome with a pending test, not a private reaction or relationship change.",
        evidenceMessageIds: a.messages.map(m => m.id), evidenceQuotes: a.messages.filter(m => m.role === "assistant").map(m => ({ messageId: m.id, quote: m.content })),
        suggestedTriggers: ["Draught of Peace", "Potions class", "potion testing"] }]);
    } else throw new Error("Unexpected offline fixture request");
    // Deterministic estimates used for comparison, NOT provider-measured usage.
    const promptTokens = approximateTokenCount(JSON.stringify({ system: body.system, messages: body.messages }));
    const completionTokens = approximateTokenCount(content);
    requests.push({ url: String(url), body, promptTokens, completionTokens });
    return new Response(JSON.stringify({ content: [{ type: "text", text: content }], stop_reason: "end_turn",
      usage: { input_tokens: promptTokens, output_tokens: completionTokens } }), { status: 200 });
  });
  return { spy, requests };
}
