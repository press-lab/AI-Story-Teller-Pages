import type { Adventure, AdventureAction, ComponentEntry, MemoryProposal, TriggerAction } from "../types/adventure";

/** Preserve old authored text as dormant compatibility data, never active context. */
export function retireActivePressureComponent(component: ComponentEntry): ComponentEntry {
  if (component.type !== "activePressure" || (component.active === false && component.autoUpdate === false)) return component;
  return { ...component, active: false, autoUpdate: false };
}

export function isActivePressureProposal(proposal: Partial<Pick<MemoryProposal, "proposedType" | "componentPatch">>): boolean {
  return proposal.proposedType === "plotPressureUpdate"
    || Boolean(proposal.componentPatch && "type" in proposal.componentPatch && proposal.componentPatch.type === "activePressure");
}

export function retireActivePressureProposal(proposal: MemoryProposal): MemoryProposal {
  return isActivePressureProposal(proposal) && proposal.status === "pending" ? { ...proposal, status: "ignored" } : proposal;
}

function retiredTarget(adventure: Adventure, id: string): boolean {
  return adventure.components?.some(c => c.id === id && c.type === "activePressure") ?? false;
}

/** Keep these guards narrow: do not normalize/copy the full save on every action. */
export function isActivePressureAction(adventure: Adventure, action: AdventureAction): boolean {
  if (action.type === "UPSERT_COMPONENT") return action.component.type === "activePressure" || retiredTarget(adventure, action.component.id);
  if (action.type === "UPDATE_COMPONENT" && action.patch.type === "activePressure") return true;
  if ("componentId" in action && action.type !== "DELETE_COMPONENT" && action.type !== "DEACTIVATE_COMPONENT"
    && retiredTarget(adventure, action.componentId)) return true;
  if (action.type === "FORCE_INCLUDE_NEXT_TURN" && action.targetType === "component" && retiredTarget(adventure, action.targetId)) return true;
  if (action.type === "ADD_MEMORY_PROPOSAL") return isActivePressureProposal(action.proposal);
  if (action.type === "UPDATE_MEMORY_PROPOSAL"
    && (action.patch.proposedType === "plotPressureUpdate"
      || Boolean(action.patch.componentPatch && "type" in action.patch.componentPatch && action.patch.componentPatch.type === "activePressure"))) return true;
  if (action.type === "APPROVE_MEMORY_PROPOSAL" || action.type === "UPDATE_MEMORY_PROPOSAL") {
    const proposal = adventure.activeState?.memoryProposals?.find(p => p.id === action.proposalId);
    return Boolean(proposal && isActivePressureProposal(proposal))
      || Boolean(action.type === "APPROVE_MEMORY_PROPOSAL" && action.editedProposal && isActivePressureProposal(action.editedProposal));
  }
  return false;
}

export function isActivePressureTriggerAction(adventure: Adventure, action: TriggerAction): boolean {
  return action.type === "updateComponentPressure"
    || ("componentId" in action && retiredTarget(adventure, action.componentId))
    || (action.type === "forceIncludeNextTurn" && action.targetType === "component" && retiredTarget(adventure, action.targetId));
}
