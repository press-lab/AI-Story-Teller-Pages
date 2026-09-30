import type { Adventure } from "../types/adventure";

export function activeStoryCanon(adventure: Adventure): string {
  return adventure.components
    .filter((component) => component.active && ["plotEssentials", "currentArc", "activePressure"].includes(component.type))
    .map((component) => `${component.title}: ${[component.arcPremise, component.content].filter(Boolean).join("\n")}`)
    .join("\n\n");
}
