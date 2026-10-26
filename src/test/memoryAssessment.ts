import type { ChatMessage } from "../types/adventure";
/** Explicit deterministic assessment reply; this helper never calls a model. */
export function mockAssessment(messages: ChatMessage[], fired: string[] = [], discovery = false): string {
  const body = JSON.parse(messages.at(-1)!.content);
  if (body.sources) return mockAssessmentBatch(messages, fired, discovery);
  return JSON.stringify({ ...Object.fromEntries((["plot", "storyCards", "brains"] as const).map(g => [g, {
    targets: (body.conditions[g] ?? []).filter((c: { id: string }) => fired.includes(c.id)).map((c: { id: string }) => ({
      id: c.id, delta: "Supported latest-exchange change for " + c.id, evidenceMessageIds: [body.sourceId] })),
    reason: "Controlled fixture decision for " + g,
  }])), discovery: { needed: discovery, reason: discovery ? "Additional development needs discovery." : "No additional durable change in this controlled exchange.", evidenceMessageIds: discovery ? [body.sourceId] : [] } });
}
export function isAssessment(messages: ChatMessage[]) { return messages.some(m => m.content.includes("SHARED MEMORY ASSESSMENT")); }

export function mockAssessmentBatch(messages: ChatMessage[], fired: string[] = [], discovery = false): string {
  const body = JSON.parse(messages.at(-1)!.content);
  return JSON.stringify({ sources: body.sources.map((source: { sourceId: string; eligibleConditions: unknown; requestedGroups: string[] }) => ({
    sourceId: source.sourceId,
    ...JSON.parse(mockAssessment([{ role: "user", content: JSON.stringify({ sourceId: source.sourceId, conditions: source.eligibleConditions,
      requestedGroups: source.requestedGroups }) }], fired, discovery)),
  })) });
}
