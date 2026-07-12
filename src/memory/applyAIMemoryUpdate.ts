import type {
  Adventure,
  AdventureAction,
  BrainPatch,
  ComponentEntry,
  StoryCard,
} from "../types/adventure";

export type AIMemoryUpdate =
  | {
      type: "brainPatch";
      brainId: string;
      patch: BrainPatch;
      mode?: "replace" | "append";
      turn?: number;
      preview?: string;
    }
  | {
      type: "storyCardUpdate";
      storyCardId: string;
      content?: string;
      keys?: string[];
      state?: string;
    }
  | {
      type: "componentUpdate";
      componentId: string;
      content: string;
    }
  | {
      type: "providerConfigUpdate" | "triggerRuleUpdate" | "questDefinitionUpdate" | "rawImportUpdate" | "systemShellUpdate";
      targetId?: string;
      description?: string;
    };

export interface AppliedAIMemoryUpdate {
  targetType: "brain" | "storyCard" | "component";
  targetId: string;
  actionTypes: AdventureAction["type"][];
}

export interface RejectedAIMemoryUpdate {
  updateType: AIMemoryUpdate["type"];
  targetId?: string;
  reason: string;
}

export interface AIMemoryUpdateResult {
  actions: AdventureAction[];
  appliedUpdates: AppliedAIMemoryUpdate[];
  rejectedUpdates: RejectedAIMemoryUpdate[];
  changedItemIds: string[];
}

function reject(update: AIMemoryUpdate, reason: string): RejectedAIMemoryUpdate {
  return {
    updateType: update.type,
    targetId: "brainId" in update ? update.brainId : "storyCardId" in update ? update.storyCardId : "componentId" in update ? update.componentId : update.targetId,
    reason,
  };
}

function storyCardPatch(update: Extract<AIMemoryUpdate, { type: "storyCardUpdate" }>): Partial<StoryCard> {
  return {
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.keys !== undefined ? { keys: update.keys } : {}),
    ...(update.state !== undefined ? { state: update.state } : {}),
  };
}

function isProtectedComponent(component: ComponentEntry): boolean {
  return component.type === "aiInstructions" || component.type === "authorNote";
}

export function applyAIMemoryUpdate(adventure: Adventure, updates: AIMemoryUpdate[]): AIMemoryUpdateResult {
  const actions: AdventureAction[] = [];
  const appliedUpdates: AppliedAIMemoryUpdate[] = [];
  const rejectedUpdates: RejectedAIMemoryUpdate[] = [];
  const changedItemIds: string[] = [];

  for (const update of updates) {
    if (update.type === "brainPatch") {
      const brain = adventure.brains.find((entry) => entry.id === update.brainId);
      if (!brain) {
        rejectedUpdates.push(reject(update, "Brain not found."));
        continue;
      }
      if (Object.keys(update.patch).length === 0) {
        rejectedUpdates.push(reject(update, "Brain patch had no allowed fields."));
        continue;
      }
      const action: AdventureAction = {
        type: "APPLY_BRAIN_UPDATE",
        brainId: update.brainId,
        patch: update.patch,
        mode: update.mode,
        turn: update.turn,
        preview: update.preview,
      };
      actions.push(action);
      appliedUpdates.push({ targetType: "brain", targetId: update.brainId, actionTypes: [action.type] });
      changedItemIds.push(update.brainId);
      continue;
    }

    if (update.type === "storyCardUpdate") {
      const card = adventure.storyCards.find((entry) => entry.id === update.storyCardId);
      if (!card) {
        rejectedUpdates.push(reject(update, "Story card not found."));
        continue;
      }
      const patch = storyCardPatch(update);
      if (Object.keys(patch).length === 0) {
        rejectedUpdates.push(reject(update, "Story card update had no content, triggers, or state change."));
        continue;
      }
      const metadataPatch = storyCardPatch({ ...update, content: undefined });
      const storyActions: AdventureAction[] = [{
        type: "APPLY_STORY_CARD_UPDATE",
        storyCardId: update.storyCardId,
        ...(update.content !== undefined ? { content: update.content } : {}),
        ...(Object.keys(metadataPatch).length > 0 ? { patch: metadataPatch } : {}),
      }];
      actions.push(...storyActions);
      appliedUpdates.push({ targetType: "storyCard", targetId: update.storyCardId, actionTypes: storyActions.map((action) => action.type) });
      changedItemIds.push(update.storyCardId);
      continue;
    }

    if (update.type === "componentUpdate") {
      const component = adventure.components.find((entry) => entry.id === update.componentId);
      if (!component) {
        rejectedUpdates.push(reject(update, "Component not found."));
        continue;
      }
      if (isProtectedComponent(component)) {
        rejectedUpdates.push(reject(update, `${component.type} components are protected from AI mutation.`));
        continue;
      }
      if (component.type !== "plotEssentials") {
        rejectedUpdates.push(reject(update, "AI may only update component content when component.type is plotEssentials."));
        continue;
      }
      const action: AdventureAction = { type: "APPLY_COMPONENT_UPDATE", componentId: update.componentId, content: update.content };
      actions.push(action);
      appliedUpdates.push({ targetType: "component", targetId: update.componentId, actionTypes: [action.type] });
      changedItemIds.push(update.componentId);
      continue;
    }

    rejectedUpdates.push(reject(update, "AI-generated memory updates cannot mutate this surface."));
  }

  return {
    actions,
    appliedUpdates,
    rejectedUpdates,
    changedItemIds: Array.from(new Set(changedItemIds)),
  };
}
