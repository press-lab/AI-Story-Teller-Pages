import { useCallback, useEffect, useState } from "react";
import {
  deleteAdventure as dbDeleteAdventure,
  getAdventure,
  listAdventures,
  saveAdventure,
  type AdventureSummary,
} from "../db/adventureDb";
import { buildContext } from "../contextBuilder/contextBuilder";
import { createDevelopmentAdventure } from "../dev/developmentAdventure";
import { createDispatchAdventure } from "../dev/dispatchAdventure";
import { buildPremadeContext, getPremadeAdventure, type PremadeAdventureId } from "../dev/premadeAdventures";
import { createDefaultAdventure } from "../state/defaults";
import { latestAssistantOutput } from "../state/turnPipeline";
import type { Adventure, ContextBuildResult, NewAdventureSetup } from "../types/adventure";
import { importAdventureJson } from "../utils/json";
import { thumbnailMetadataPatch } from "../utils/adventureImages";

export function useAdventureLibrary(
  setAdventure: (a: Adventure | undefined) => void,
  setContextResult: (r: ContextBuildResult | undefined) => void,
  onNavigate: (tab: string) => void,
  onModalClose: () => void,
  onError: (e: string) => void,
) {
  const [adventures, setAdventures] = useState<AdventureSummary[]>([]);

  const refreshAdventures = useCallback(async () => {
    setAdventures(await listAdventures());
  }, []);

  useEffect(() => {
    void refreshAdventures();
  }, [refreshAdventures]);

  async function allSavedAdventures(): Promise<Adventure[]> {
    const summaries = await listAdventures();
    const loaded = await Promise.all(summaries.map((s) => getAdventure(s.id)));
    return loaded.filter((a): a is Adventure => Boolean(a));
  }

  async function openAdventure(id: string) {
    const next = await getAdventure(id);
    if (!next) { onError("Adventure could not be opened."); return; }
    setAdventure(next);
    setContextResult(undefined);
    onModalClose();
    onNavigate("dashboard");
  }

  async function createAdventure(setup: NewAdventureSetup) {
    const baseline = createDefaultAdventure(setup.title);
    // Collect all singleton component types the wizard is providing so we can drop
    // the baseline defaults for those types — avoids duplicate narrationRules,
    // aiInstructions, plotEssentials, etc. when the wizard seeds its own copy.
    const setupTypes = new Set(setup.components.map((c) => c.type));
    const next = {
      ...baseline,
      openingScene: setup.openingScene,
      metadata: setup.thumbnailImage ? thumbnailMetadataPatch(setup.thumbnailImage) : baseline.metadata,
      components: [
        ...baseline.components.filter((c) => !setupTypes.has(c.type)),
        ...setup.components,
      ],
      storyCards: setup.storyCards,
    };
    await saveAdventure(next);
    setAdventure(next);
    onModalClose();
    onNavigate("dashboard");
    await refreshAdventures();
  }

  async function duplicateAdventure(id: string) {
    const existing = await getAdventure(id);
    if (!existing) return;
    const copy = importAdventureJson(JSON.stringify(existing), true);
    await saveAdventure(copy);
    setAdventure(copy);
    onModalClose();
    onNavigate("dashboard");
    await refreshAdventures();
  }

  async function removeAdventure(id: string, currentAdventureId?: string) {
    if (!window.confirm("Delete this adventure from IndexedDB?")) return;
    await dbDeleteAdventure(id);
    if (currentAdventureId === id) {
      setAdventure(undefined);
      onModalClose();
    }
    await refreshAdventures();
  }

  async function importAdventure(text: string) {
    try {
      const next = importAdventureJson(text);
      await saveAdventure(next);
      setAdventure(next);
      onModalClose();
      onNavigate("dashboard");
      await refreshAdventures();
    } catch (importError) {
      onError(importError instanceof Error ? importError.message : "Import failed.");
    }
  }

  async function createAdventureFromImport(next: Adventure) {
    await saveAdventure(next);
    setAdventure(next);
    setContextResult(undefined);
    onModalClose();
    await refreshAdventures();
  }

  async function loadDevScenario(next: Awaited<ReturnType<typeof createDevelopmentAdventure>>) {
    await saveAdventure(next);
    setAdventure(next);
    setContextResult(buildContext(next, { latestModelOutput: latestAssistantOutput(next) }));
    onModalClose();
    onNavigate("dashboard");
    await refreshAdventures();
  }

  async function loadPremadeAdventure(id: PremadeAdventureId) {
    const premade = getPremadeAdventure(id);
    if (!premade) {
      onError("Premade adventure could not be loaded.");
      return;
    }
    const next = premade.createAdventure();
    await saveAdventure(next);
    setAdventure(next);
    setContextResult(buildPremadeContext(next));
    onModalClose();
    onNavigate("dashboard");
    await refreshAdventures();
  }

  async function loadDevelopmentAdventure() {
    await loadDevScenario(createDevelopmentAdventure());
  }

  async function loadDispatchAdventure() {
    await loadDevScenario(createDispatchAdventure());
  }

  return {
    adventures,
    refreshAdventures,
    allSavedAdventures,
    openAdventure,
    createAdventure,
    duplicateAdventure,
    removeAdventure,
    importAdventure,
    createAdventureFromImport,
    loadPremadeAdventure,
    loadDevelopmentAdventure,
    loadDispatchAdventure,
  };
}
