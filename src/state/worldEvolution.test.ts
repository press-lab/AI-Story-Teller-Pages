import { describe, expect, it, vi } from "vitest";
import { createDefaultAdventure, makeComponent, normalizeAdventure } from "./defaults";
import { runTurnPipeline } from "./turnPipeline";
import { buildContext } from "../contextBuilder/contextBuilder";

describe("persistent plot events", () => {
  const arc = () => makeComponent({ id: "arc-mystery", title: "The Bell Mystery", type: "currentArc",
    content: "Who rang the midnight bell remains unknown.", arcPremise: "Find who rang the midnight bell.",
    arcSimmerInstruction: "Keep the culprit mysterious.", arcBreakInstruction: "Confront the culprit.",
    inclusionPolicy: "always", active: true });

  it("resolves an evidenced mystery through the narration turn and removes its pending premise next turn", async () => {
    const adventure = createDefaultAdventure("Mystery");
    adventure.components.push(arc());
    const story = "Mira unmasks the bell ringer. The mayor admits ringing the midnight bell. The mayor confesses and is arrested. The bell mystery is conclusively solved.";
    const sendChatCompletion = vi.fn(async () => ({ content: story + "\n<memory_updates>" + JSON.stringify({ updates: [], plotEvents: [{ kind: "resolved", targetId: "arc-mystery", expectedRevision: 0, objective: "Find who rang the midnight bell.", certainty: "confirmed", autonomous: false, offscreen: false, evidence: story, outcome: "The mayor confesses and is arrested.", resolution: { verdict: "victory", centralObjective: true, remainingObstacles: [], closureEvidence: story } }] }) + "</memory_updates>" }));
    const result = await runTurnPipeline({ adventure, text: "I confront the mayor.", sendChatCompletion });
    expect(sendChatCompletion).toHaveBeenCalledTimes(1);
    const updated = result.adventure.components.find(c => c.id === "arc-mystery")!;
    expect(updated.arcState?.outcome).toBe("The mayor confesses and is arrested.");
    const context = buildContext(result.adventure);
    const current = context.sections.find(s => s.id === "currentArc")!.items[0].content;
    expect(current).toContain("Arc concluded");
    expect(current).not.toContain("Who rang");
    expect(current).not.toContain("Keep the culprit mysterious");
  });

  it("rejects unsupported outcomes and keeps old saves in their prior mode", async () => {
    const legacy = createDefaultAdventure("Old");
    delete legacy.worldEvolutionSettings;
    const restored = normalizeAdventure(legacy);
    expect(restored.worldEvolutionSettings?.plotProgression).toBe("off");
    const adventure = createDefaultAdventure("New");
    adventure.components.push(arc());
    const result = await runTurnPipeline({ adventure, text: "I wait.", sendChatCompletion: async () => ({ content: `The mayor smiles.\n<memory_updates>{"updates":[],"plotEvents":[{"kind":"resolved","targetId":"arc-mystery","evidence":"The mayor smiles.","outcome":"The mayor is arrested."}]}</memory_updates>` }) });
    expect(result.adventure.components.find(c => c.id === "arc-mystery")?.arcState?.outcome).toBeUndefined();
  });

  it("rejects an offscreen victory when offscreen events are disabled", async () => {
    const adventure = createDefaultAdventure("Offscreen gate");
    adventure.worldEvolutionSettings!.offscreenEvents = false;
    adventure.components.push(arc());
    const story = "Meanwhile, the mayor destroys the bell ledger.";
    const result = await runTurnPipeline({ adventure, text: "I rest.", sendChatCompletion: async () => ({ content:
      `${story}\n<memory_updates>{"updates":[],"plotEvents":[{"kind":"resolved","targetId":"arc-mystery","evidence":"${story}","outcome":"the mayor destroys the bell ledger","offscreen":true}]}</memory_updates>` }) });
    expect(result.adventure.components.find(c => c.id === "arc-mystery")?.arcState?.outcome).toBeUndefined();
  });
});
