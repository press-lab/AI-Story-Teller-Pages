import { isActivePressureAction, isActivePressureTriggerAction, retireActivePressureComponent, retireActivePressureProposal } from "./activePressureRetirement";
import type { Adventure, AdventureAction, MemoryAutoApproveSettings, MemoryProposal, PendingAdventureUpdate, TokenBudgetSettings, TriggerAction, TriggerRule } from "../types/adventure";

/** Input-only compatibility. Retired values never enter the canonical Adventure model. */
export type LegacyAdventureInput = Adventure & {
  rollingSummary?: unknown;
  sceneState?: unknown;
};

const retiredSettings = [
  "allowSystemToTruncateSummary", "autoSummarize", "autoSummarizeEveryNTurns",
  "autoSceneStateEveryNTurns", "sceneStateEnabled", "summaryEnabled",
];
const retiredActions = new Set([
  "UPDATE_ROLLING_SUMMARY", "UPDATE_SCENE_STATE", "SET_LAST_SCENE_STATE_TURN",
  "ADVANCE_ARC_PACING", "SET_ARC_PHASE", "SET_ARC_CONTINUATIONS",
  "COMPLETE_ARC_TO_STORY_CARD", "APPLY_ARC_CONTINUATION",
]);
const retiredArcFields = [
  "arcPremise", "arcThreadKeys", "arcPace", "arcTriggerMode", "arcSimmerInstruction",
  "arcBreakInstruction", "arcState", "arcContinuationOptions", "arcAutoContinue",
];
const isLegacyArc = (component: { type?: unknown }) => component.type === "currentArc";
function isLegacyArcTrigger(action: TriggerAction, arcIds: Set<string>): boolean {
  return (action as { type: string }).type === "updateComponentArc"
    || ("componentId" in action && arcIds.has(action.componentId))
    || (action.type === "forceIncludeNextTurn" && action.targetType === "component" && arcIds.has(action.targetId));
}

function cleanArcTriggerPatch<T extends Partial<TriggerRule>>(patch: T, arcIds: Set<string>): T {
  const actions = patch.actions?.filter(action => !isLegacyArcTrigger(action, arcIds));
  if (!actions || actions.length === patch.actions?.length) return patch;
  return { ...patch, actions, ...(actions.length ? {} : { enabled: false }) };
}

function isLegacyArcProposal(input: { proposedType?: unknown; manualDraft?: { componentType?: unknown } }): boolean {
  return input.proposedType === "currentArcUpdate" || input.proposedType === "arcProposal"
    || input.manualDraft?.componentType === "currentArc";
}
const retiredSources = new Set(["autoSummary", "autoSceneState"]);

function omitKeys<T extends object>(input: T, keys: string[]): T {
  const result = { ...input };
  for (const key of keys) delete (result as Record<string, unknown>)[key];
  return result;
}

export function stripRetiredTokenSettings<T extends Partial<TokenBudgetSettings>>(input: T): T {
  const settings = omitKeys(input, retiredSettings);
  if (settings.sectionBudgets) {
    settings.sectionBudgets = omitKeys(settings.sectionBudgets, ["rollingSummary", "sceneState", "currentArc"]);
  }
  return settings;
}

function isRetiredProposal(input: Parameters<typeof isLegacyArcProposal>[0]): boolean {
  return input.proposedType === "summaryUpdate" || input.proposedType === "sceneStateUpdate" || isLegacyArcProposal(input);
}

type ApprovalNormalizer = (input: unknown) => MemoryAutoApproveSettings;

function cleanActions(adventure: Adventure, actions: AdventureAction[], retiredProposalIds: Set<string>, arcIds: Set<string>, normalizeApproval: ApprovalNormalizer): AdventureAction[] {
  return actions.flatMap<AdventureAction>(action => {
    if (retiredActions.has(action.type) || isActivePressureAction(adventure, action)) return [];
    if ("componentId" in action && arcIds.has(action.componentId)) return [];
    if (action.type === "UPSERT_COMPONENT" && isLegacyArc(action.component)) return [];
    if (action.type === "UPDATE_COMPONENT" && isLegacyArc(action.patch)) return [];
    if (action.type === "UPSERT_TRIGGER_RULE") return [{ ...action, triggerRule: cleanArcTriggerPatch(action.triggerRule, arcIds) }];
    if (action.type === "UPDATE_TRIGGER_RULE") return [{ ...action, patch: cleanArcTriggerPatch(action.patch, arcIds) }];
    if ("proposalId" in action && action.proposalId && retiredProposalIds.has(action.proposalId)) return [];
    if (action.type === "ADD_MEMORY_PROPOSAL" && isRetiredProposal(action.proposal)) return [];
    if (action.type === "UPDATE_MEMORY_PROPOSAL" && isRetiredProposal(action.patch)) return [];
    if (action.type === "APPROVE_MEMORY_PROPOSAL" && action.editedProposal && isRetiredProposal(action.editedProposal)) return [];
    if (action.type === "SET_TOKEN_BUDGET_SETTINGS") return [{ ...action, settings: stripRetiredTokenSettings(action.settings) }];
    if (action.type === "SET_MEMORY_AUTO_APPROVE") return [{ ...action, settings: normalizeApproval(action.settings) }];
    if (action.type === "SET_SEMANTIC_EVALUATION_SETTINGS") return [{ ...action, settings: omitKeys(action.settings, ["requireApprovalForAutoUpdates"]) }];
    if (action.type === "QUEUE_PENDING_UPDATE") {
      const update = cleanUpdate(adventure, action.update, retiredProposalIds, arcIds, normalizeApproval);
      return update ? [{ ...action, update }] : [];
    }
    return [action];
  });
}

function cleanUpdate(adventure: Adventure, update: PendingAdventureUpdate, retiredProposalIds: Set<string>, arcIds: Set<string>, normalizeApproval: ApprovalNormalizer): PendingAdventureUpdate | undefined {
  const actions = cleanActions(adventure, update.actions ?? [], retiredProposalIds, arcIds, normalizeApproval);
  if (!actions.length) return undefined;
  return { ...update, source: retiredSources.has(update.source) ? "manual" : update.source, actions };
}

/** Also called at persistence boundaries, even when the normal importer was bypassed. */
export function stripRetiredAdventureFields(input: LegacyAdventureInput, normalizeApproval: ApprovalNormalizer): Adventure {
  const adventure = omitKeys(input, ["rollingSummary", "sceneState", "currentArc"]);
  const proposals = adventure.activeState?.memoryProposals ?? [];
  const retiredProposalIds = new Set(proposals.filter(isRetiredProposal).map(proposal => proposal.id));
  const arcText = (adventure.components ?? []).filter(isLegacyArc).map(component => {
    const legacy = component as typeof component & { arcPremise?: unknown; arcSimmerInstruction?: unknown; arcBreakInstruction?: unknown };
    return { id: component.id, title: component.title, content: component.content,
      premise: legacy.arcPremise, simmerInstruction: legacy.arcSimmerInstruction, breakInstruction: legacy.arcBreakInstruction };
  });
  const arcIds = new Set(arcText.map(component => component.id));
  const priorArcText = adventure.metadata?.retiredArcText;
  return {
    ...adventure,
    ...(arcText.length ? { metadata: { ...adventure.metadata,
      retiredArcText: [...(Array.isArray(priorArcText) ? priorArcText : []), ...arcText] } } : {}),
    ...(adventure.components ? { components: adventure.components.filter(component => !isLegacyArc(component))
      .map(component => retireActivePressureComponent(omitKeys(component, retiredArcFields))) } : {}),
    ...(adventure.tokenBudgetSettings ? { tokenBudgetSettings: stripRetiredTokenSettings(adventure.tokenBudgetSettings) } : {}),
    ...(adventure.activeState ? {
      activeState: {
        ...omitKeys(adventure.activeState, ["lastSceneStateTurn"]),
        memoryProposals: proposals.filter(proposal => !isRetiredProposal(proposal)).map(retireActivePressureProposal) as MemoryProposal[],
        pendingUpdates: (adventure.activeState.pendingUpdates ?? []).flatMap(update => {
          const clean = cleanUpdate(adventure, update, retiredProposalIds, arcIds, normalizeApproval);
          return clean ? [clean] : [];
        }),
      },
    } : {}),
    triggerRules: (adventure.triggerRules ?? []).map(rule => {
      const cleaned = cleanArcTriggerPatch(rule, arcIds);
      const actions = cleaned.actions.filter(action => (action as { type: string }).type !== "updateSummary" && !isActivePressureTriggerAction(adventure, action));
      return { ...cleaned, actions, enabled: cleaned.actions.some(action => isActivePressureTriggerAction(adventure, action)) && !actions.length ? false : cleaned.enabled };
    }),
  };
}
