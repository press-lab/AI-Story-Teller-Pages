import type { Adventure, AdventureAction, MemoryAutoApproveSettings, MemoryProposal, PendingAdventureUpdate, TokenBudgetSettings } from "../types/adventure";

/** Input-only compatibility. Retired values never enter the canonical Adventure model. */
export type LegacyAdventureInput = Adventure & {
  rollingSummary?: unknown;
  sceneState?: unknown;
};

const retiredSettings = [
  "allowSystemToTruncateSummary", "autoSummarize", "autoSummarizeEveryNTurns",
  "autoSceneStateEveryNTurns", "sceneStateEnabled", "summaryEnabled",
];
const retiredActions = new Set(["UPDATE_ROLLING_SUMMARY", "UPDATE_SCENE_STATE", "SET_LAST_SCENE_STATE_TURN"]);
const retiredSources = new Set(["autoSummary", "autoSceneState"]);

function omitKeys<T extends object>(input: T, keys: string[]): T {
  const result = { ...input };
  for (const key of keys) delete (result as Record<string, unknown>)[key];
  return result;
}

export function stripRetiredTokenSettings<T extends Partial<TokenBudgetSettings>>(input: T): T {
  const settings = omitKeys(input, retiredSettings);
  if (settings.sectionBudgets) {
    settings.sectionBudgets = omitKeys(settings.sectionBudgets, ["rollingSummary", "sceneState"]);
  }
  return settings;
}

function isRetiredProposal(input: { proposedType?: unknown }): boolean {
  return input.proposedType === "summaryUpdate" || input.proposedType === "sceneStateUpdate";
}

type ApprovalNormalizer = (input: unknown) => MemoryAutoApproveSettings;

function cleanActions(actions: AdventureAction[], retiredProposalIds: Set<string>, normalizeApproval: ApprovalNormalizer): AdventureAction[] {
  return actions.flatMap<AdventureAction>(action => {
    if (retiredActions.has(action.type)) return [];
    if ("proposalId" in action && action.proposalId && retiredProposalIds.has(action.proposalId)) return [];
    if (action.type === "ADD_MEMORY_PROPOSAL" && isRetiredProposal(action.proposal)) return [];
    if (action.type === "UPDATE_MEMORY_PROPOSAL" && isRetiredProposal(action.patch)) return [];
    if (action.type === "APPROVE_MEMORY_PROPOSAL" && action.editedProposal && isRetiredProposal(action.editedProposal)) return [];
    if (action.type === "SET_TOKEN_BUDGET_SETTINGS") return [{ ...action, settings: stripRetiredTokenSettings(action.settings) }];
    if (action.type === "SET_MEMORY_AUTO_APPROVE") return [{ ...action, settings: normalizeApproval(action.settings) }];
    if (action.type === "SET_SEMANTIC_EVALUATION_SETTINGS") return [{ ...action, settings: omitKeys(action.settings, ["requireApprovalForAutoUpdates"]) }];
    if (action.type === "QUEUE_PENDING_UPDATE") {
      const update = cleanUpdate(action.update, retiredProposalIds, normalizeApproval);
      return update ? [{ ...action, update }] : [];
    }
    return [action];
  });
}

function cleanUpdate(update: PendingAdventureUpdate, retiredProposalIds: Set<string>, normalizeApproval: ApprovalNormalizer): PendingAdventureUpdate | undefined {
  const actions = cleanActions(update.actions ?? [], retiredProposalIds, normalizeApproval);
  if (!actions.length) return undefined;
  return { ...update, source: retiredSources.has(update.source) ? "manual" : update.source, actions };
}

/** Also called at persistence boundaries, even when the normal importer was bypassed. */
export function stripRetiredAdventureFields(input: LegacyAdventureInput, normalizeApproval: ApprovalNormalizer): Adventure {
  const adventure = omitKeys(input, ["rollingSummary", "sceneState"]);
  const proposals = adventure.activeState?.memoryProposals ?? [];
  const retiredProposalIds = new Set(proposals.filter(isRetiredProposal).map(proposal => proposal.id));
  return {
    ...adventure,
    ...(adventure.tokenBudgetSettings ? { tokenBudgetSettings: stripRetiredTokenSettings(adventure.tokenBudgetSettings) } : {}),
    ...(adventure.activeState ? {
      activeState: {
        ...omitKeys(adventure.activeState, ["lastSceneStateTurn"]),
        memoryProposals: proposals.filter(proposal => !isRetiredProposal(proposal)) as MemoryProposal[],
        pendingUpdates: (adventure.activeState.pendingUpdates ?? []).flatMap(update => {
          const clean = cleanUpdate(update, retiredProposalIds, normalizeApproval);
          return clean ? [clean] : [];
        }),
      },
    } : {}),
    triggerRules: (adventure.triggerRules ?? []).map(rule => ({
      ...rule,
      actions: rule.actions.filter(action => (action as { type: string }).type !== "updateSummary"),
    })),
  };
}
