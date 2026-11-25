import { ARC_STATE_AUTHORING } from "../ai/authoringBestPractices";
import type { Adventure, ArcIntensity, ComponentType } from "../types/adventure";
import { snapshotFingerprint } from "../utils/snapshotFingerprint";

export const ARC_INTENSITIES = ["dormant", "background", "foreground", "dominant", "executeNow"] as const;
export const ARC_INTENSITY_LABELS = ["Dormant", "Background", "Foreground", "Dominant", "Execute Now"];
export function formatArcState(current: string, completed: string): string {
  return "CURRENT DEVELOPMENTS\n" + current + "\n\nCOMPLETED DEVELOPMENTS\n" + completed;
}
export const ARC_STATE_TEMPLATE = formatArcState("", "");
export const isArcComponent = (type: ComponentType) => type === "currentArcPlan" || type === "currentArcState";
export function normalizeArcIntensity(value: unknown): ArcIntensity {
  return ARC_INTENSITIES.find(intensity => intensity === value) ?? "background";
}
export function eligibleArc(adventure: Adventure) {
  const plan = adventure.components.find(c => c.type === "currentArcPlan");
  const state = adventure.components.find(c => c.type === "currentArcState");
  const intensity = normalizeArcIntensity(state?.arcIntensity);
  return plan?.active && state?.active && intensity !== "dormant" ? { plan, state, intensity } : undefined;
}
export function arcReferenceState(adventure: Adventure): string | undefined {
  const arc = eligibleArc(adventure);
  return arc && snapshotFingerprint(JSON.stringify([arc.plan.id, arc.plan.content, arc.plan.updatedAt, arc.state.id, arc.state.content, arc.state.updatedAt]));
}
export function arcStateSections(content: string, preserveWhitespace = false) {
  const match = /^\s*CURRENT DEVELOPMENTS[ \t]*\r?\n([\s\S]*?)^COMPLETED DEVELOPMENTS[ \t]*(?:\r?\n|$)([\s\S]*)$/im.exec(content);
  if (!match || /^\s*(?:CURRENT|COMPLETED) DEVELOPMENTS\s*$/im.test(match[1] + "\n" + match[2])) return undefined;
  return preserveWhitespace
    ? { current: match[1].replace(/(?:\r?\n){1,2}$/, ""), completed: match[2] }
    : { current: match[1].trim(), completed: match[2].trim() };
}

export const ARC_EVALUATION = "Compare the evidence with the read-only arcPlan reference and State for the source. Use the Plan only for arc evaluation. Never output Plan updates or treat its future beats as evidence for other memory categories. Emit at most one (component.currentArcState: Current Arc State = complete replacement) only for meaningful changes or warranted transitions. Actual gameplay overrides intended progression. Recognize failed, skipped, invalidated, delayed and superseded beats and unexpected resolutions. A resolved conflict must not restart. Activate the next applicable beat only when Plan and established circumstances support it. Evidence must justify the transition without showing that an activated beat already played out. Newly completed events require actual story evidence. Previously established history needs no fresh evidence. Activation never establishes an unplayed encounter or guarantees success. " + ARC_STATE_AUTHORING;

const shared = [
  "CURRENT ARC STATE establishes active world circumstances and completed arc history.",
  "Current Developments describe events and circumstances occurring now. Completed Developments describe historical events.",
  "Use Current Developments according to the selected arc intensity. Do not repeat completed events or treat them as ongoing.",
  "Preserve established chronology, location, character knowledge, world constraints, and player agency. Active developments do not establish guaranteed outcomes.",
  "Characters may remain unaware of active developments until they acquire the relevant information through gameplay.",
].join("\n");

const guidance = {
  background: [
    "ARC INTENSITY: BACKGROUND",
    "Give Current Arc State low narrative priority.",
    "Current Developments are actively occurring in the world, but they do not need to influence the immediate scene.",
    "Allow ordinary life, unrelated events, and existing player activities to continue naturally.",
    "Introduce arc-related developments when contextually appropriate. Do not force arc progression into unrelated scenes or repeatedly remind the player that the arc exists.",
  ],
  foreground: [
    "ARC INTENSITY: FOREGROUND",
    "Give Current Arc State substantial narrative priority.",
    "Actively use Current Developments when generating relevant world events, NPC actions, complications, and opportunities.",
    "Allow the arc to influence ongoing gameplay through coherent developments.",
    "Do not delay relevant arc activity solely to preserve the existing scene. Do not force every interaction to concern the arc.",
  ],
  dominant: [
    "ARC INTENSITY: DOMINANT",
    "Give Current Arc State primary narrative priority.",
    "Use Current Developments as a major source of world activity, NPC actions, conflict, and consequences.",
    "Actively develop the current arc whenever established circumstances permit.",
    "Allow the arc to interrupt ordinary activities when coherent. Preserve player agency, character knowledge, and existing world constraints.",
    "Do not guarantee the outcome or force the player to participate.",
  ],
  executeNow: [
    "ARC INTENSITY: EXECUTE NOW",
    "Give Current Arc State immediate narrative priority.",
    "Bring the active Current Developments into play at the earliest coherent opportunity.",
    "Generate concrete actions, events, or consequences associated with the active development. Do not repeatedly describe preparation, anticipation, or the possibility of the event occurring.",
    "Respect established chronology, location, character knowledge, world constraints, and player agency.",
    "Execute the active circumstances, not a predetermined outcome. Do not resolve the entire arc automatically.",
  ],
};
export const arcNarrationGuidance = (intensity: Exclude<ArcIntensity, "dormant">) => shared + "\n\n" + guidance[intensity].join("\n");
