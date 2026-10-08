import type { WorldEvolutionSettings } from "../types/adventure";

export const worldPresets: Record<string, Omit<WorldEvolutionSettings, "enabled">> = {
  "Quiet Sandbox": { plotProgression: "off", plotResolution: "openEnded", newPlotGeneration: "off", npcAutonomy: "reactive", offscreenEvents: false, characterDevelopment: false, relationshipEvolution: false, betrayal: "off", redemption: "off", hiddenMotivations: false, canonReinterpretation: "off" },
  "Natural Evolution": { plotProgression: "natural", plotResolution: "openEnded", newPlotGeneration: "occasional", npcAutonomy: "reactive", offscreenEvents: false, characterDevelopment: true, relationshipEvolution: true, betrayal: "off", redemption: "earned", hiddenMotivations: true, canonReinterpretation: "review" },
  "Living World": { plotProgression: "active", plotResolution: "decisive", newPlotGeneration: "occasional", npcAutonomy: "independent", offscreenEvents: true, characterDevelopment: true, relationshipEvolution: true, betrayal: "off", redemption: "earned", hiddenMotivations: true, canonReinterpretation: "review" },
  "Unpredictable World": { plotProgression: "active", plotResolution: "decisive", newPlotGeneration: "frequent", npcAutonomy: "independent", offscreenEvents: true, characterDevelopment: true, relationshipEvolution: true, betrayal: "unrestricted", redemption: "unrestricted", hiddenMotivations: true, canonReinterpretation: "review" },
};
export function worldPresetName(settings: WorldEvolutionSettings): string {
  return Object.entries(worldPresets).find(([, values]) => Object.entries(values).every(([key, value]) => settings[key as keyof WorldEvolutionSettings] === value))?.[0] ?? "Custom";
}
