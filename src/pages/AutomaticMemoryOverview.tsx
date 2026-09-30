import type { InlineMemoryCategory, MemoryAutoApproveSettings, MemoryProposal, MemoryProposalType } from "../types/adventure";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField } from "./shared";

const quietCategories: Record<InlineMemoryCategory, boolean> = {
  character_reveal: true, world_fact: true, relationship: false, plot_beat: false, status_change: false,
};
const balancedCategories: Record<InlineMemoryCategory, boolean> = {
  character_reveal: true, world_fact: true, relationship: true, plot_beat: true, status_change: true,
};
const categories: Array<{ key: InlineMemoryCategory; label: string; description: string }> = [
  { key: "relationship", label: "Relationship Milestone", description: "Lasting change between characters" },
  { key: "world_fact", label: "World Fact", description: "New place, organization, rule, or world detail" },
  { key: "character_reveal", label: "Character Reveal", description: "A character's lasting nature, role, or history" },
  { key: "plot_beat", label: "Plot Beat", description: "Lasting obligation, alliance, betrayal, or consequence" },
  { key: "status_change", label: "Status Change", description: "Changed rank, title, allegiance, or relationship status" },
];

const destinations: Array<{
  name: string;
  types: MemoryProposalType[];
  approvalKey: keyof MemoryAutoApproveSettings;
  sources: string;
  exception: string;
}> = [
  {
    name: "Story Cards", types: ["storyCard"], approvalKey: "storyCard",
    sources: "Narrator, recovery, background discovery, manual tools, custom rules",
    exception: "Inline plot cards and protected-card changes require review. Background-discovered plot cards currently follow the general Story Cards switch.",
  },
  {
    name: "Character thoughts", types: ["brainUpdate"], approvalKey: "brainUpdate",
    sources: "Narrator, recovery, manual tools, custom rules",
    exception: "An eligible narrator thought can apply directly when auto-approval is on.",
  },
  {
    name: "Plot Essentials", types: ["plotEssentialsUpdate"], approvalKey: "plotEssentialsUpdate",
    sources: "Narrator, recovery, manual tools, custom rules",
    exception: "Foundational changes during narration always require review.",
  },
  {
    name: "Active Pressure", types: ["plotPressureUpdate"], approvalKey: "plotPressureUpdate",
    sources: "Narrator, recovery, manual tools, custom rules",
    exception: "Auto-approved pressure changes may apply without a history entry.",
  },
  {
    name: "Current Arc developments", types: ["currentArcUpdate"], approvalKey: "currentArcUpdate",
    sources: "Narrator, recovery, manual tools, custom rules",
    exception: "New arc proposals have a separate approval switch below.",
  },
];

export function destinationName(proposal: MemoryProposal): string {
  if (proposal.proposedType === "storyCard") return `${proposal.storyCardType ?? "unspecified"} Story Card`;
  const names: Partial<Record<MemoryProposalType, string>> = {
    brainUpdate: "Character thoughts", plotEssentialsUpdate: "Plot Essentials",
    plotPressureUpdate: "Active Pressure", currentArcUpdate: "Current Arc",
    arcProposal: "New arc", summaryUpdate: "Legacy Summary", plotMomentumUpdate: "Legacy Momentum",
  };
  return names[proposal.proposedType] ?? proposal.proposedType;
}

export function AutomaticMemoryOverview({ adventure, dispatch }: AdventurePageProps) {
  const proposals = adventure.activeState.memoryProposals;
  const autoApprove = adventure.memoryAutoApprove;
  const systemTriggers = adventure.systemTriggers;
  const detectionOn = adventure.memoryDetectionSettings.enabled;
  const semanticRules = adventure.triggerRules.filter(rule => rule.enabled && (rule.evaluationMode ?? "semantic") === "semantic");
  const memoryLogs = adventure.activeState.evaluationLog.filter(entry =>
    !entry.conditionsEvaluated.some(condition => condition.sourceType === "triggerRule")
    && !entry.conditionsFired.some(id => id.startsWith("trigger:")),
  ).slice(0, 20);
  const recentProposals = [...proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const backgroundTokens = adventure.activeState.backgroundTokenUsage;

  function setAutoApprove(patch: Partial<MemoryAutoApproveSettings>) {
    dispatch({ type: "SET_MEMORY_AUTO_APPROVE", settings: { ...autoApprove, ...patch } });
  }

  return (
    <div className="automatic-memory-overview">
      <div className="panel">
        <h3>How automatic memory flows</h3>
        <p className="memory-flow">Detected in a turn <span>→</span> Proposed destination <span>→</span> Review or auto-approve <span>→</span> Saved memory <span>→</span> Future context</p>
        <p className="muted">Pending suggestions do not enter story context. Saved Story Cards and components enter only when eligible under their context and token settings.</p>
      </div>

      <div className="panel">
        <h3>Detection sources and requests</h3>
        <div className="memory-mapping-list">
          <div><strong>Inline narrator memory</strong><span>{detectionOn ? "On · every story response" : "Off"}</span><p>Uses the story request and extra tokens; no separate request when its hidden output succeeds.</p></div>
          <div><strong>Missing-output recovery</strong><span>{detectionOn ? `On · at most once every ${Math.max(1, adventure.memoryDetectionSettings.everyNTurns ?? 1)} turn(s)` : "Off"}</span><p>Runs only after missing or invalid hidden output. One background request; an invalid result can start the older multi-request cycle.</p></div>
          <div><strong>Background Story Card discovery</strong><span>Fallback or manual</span><p>Uses a background request in the older fallback cycle or when explicitly requested. It can create plot and event cards; the inline category switches below do not control it.</p></div>
          <div><strong>Custom Automation rules</strong><span>{semanticRules.length} enabled AI rule(s)</span><p>Semantic rules use background requests. Keyword and regex checks do not. Their rule editor and logs remain on Automations.</p></div>
        </div>
        <p className="muted">Cumulative background tokens recorded: {backgroundTokens.promptTokens.toLocaleString()} input, {backgroundTokens.completionTokens.toLocaleString()} output. Exact request counts and per-turn token use are not recorded; the activity below cannot estimate cost.</p>
      </div>

      <details className="panel editor-tools-panel" open>
        <summary>Inline discovery of new Story Cards</summary>
        <p className="muted">These categories filter only <strong>new cards proposed in the narrator's hidden output</strong>. They do not switch off existing-card updates, Character thoughts, Plot Essentials, Active Pressure, or background discovery.</p>
        <CheckboxField
          label="Allow inline new-card discovery"
          checked={systemTriggers.enabled !== false}
          onChange={enabled => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...systemTriggers, enabled } })}
        />
        <div className="toolbar">
          <button type="button" onClick={() => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...systemTriggers, enabled: true, categories: quietCategories } })}>Quiet entity-only</button>
          <button type="button" onClick={() => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...systemTriggers, enabled: true, categories: balancedCategories } })}>Balanced story memory</button>
        </div>
        <p className="muted">Quiet allows character and world facts. Balanced also allows relationship, plot, and status categories. The narrator can propose at most one new card in a response; the category does not fix its destination subtype.</p>
        <div className="grid two disabled-when-off" data-disabled={systemTriggers.enabled === false}>
          {categories.map(({ key, label, description }) => (
            <div key={key}>
              <CheckboxField
                label={label}
                checked={systemTriggers.categories[key] !== false}
                onChange={enabled => dispatch({ type: "SET_SYSTEM_TRIGGER_SETTINGS", settings: { ...systemTriggers, categories: { ...systemTriggers.categories, [key]: enabled } } })}
              />
              <p className="muted">{description}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="panel">
        <h3>Destinations and approval</h3>
        <p className="muted">Counts below describe saved suggestion history, not how often a memory was sent to the model. A required-review proposal waits even when auto-approve is on.</p>
        <div className="memory-destination-list">
          {destinations.map(destination => {
            const matching = proposals.filter(proposal => destination.types.includes(proposal.proposedType));
            const pending = matching.filter(proposal => proposal.status === "pending").length;
            const approved = matching.filter(proposal => proposal.status === "approved").length;
            return (
              <div className="memory-destination" key={destination.name}>
                <div className="memory-destination-heading">
                  <strong>{destination.name}</strong>
                  <CheckboxField label="Auto-approve eligible updates" checked={autoApprove[destination.approvalKey]} onChange={enabled => setAutoApprove({ [destination.approvalKey]: enabled })} />
                </div>
                <p className="muted">From: {destination.sources}</p>
                <p>{pending} pending · {approved} approved in suggestion history</p>
                {destination.name === "Story Cards" && <p>Saved cards: {adventure.storyCards.length} total · {(["character", "location", "lore", "plot", "event", "custom"] as const).map(type => `${adventure.storyCards.filter(card => card.type === type).length} ${type}`).join(" · ")}</p>}
                <p className="muted">{destination.exception}</p>
              </div>
            );
          })}
        </div>
        <details className="editor-tools-panel">
          <summary>Other and legacy approval controls</summary>
          <div className="auto-approve-toggles">
            <CheckboxField label="New arc proposals" checked={autoApprove.arcProposal} onChange={arcProposal => setAutoApprove({ arcProposal })} />
            <CheckboxField label="Legacy Summary" checked={autoApprove.summaryUpdate} onChange={summaryUpdate => setAutoApprove({ summaryUpdate })} />
          </div>
        </details>
      </div>

      <details className="panel editor-tools-panel">
        <summary>Recent memory activity and trace</summary>
        <p className="muted">Evaluation logs show outcomes, but do not store exact request counts. Suggestion records do not reliably store their detection source, approval method, or per-item context inclusion.</p>
        {memoryLogs.length === 0 && <p className="muted">No memory evaluation logs retained.</p>}
        {memoryLogs.map(entry => (
          <details className="log-entry" key={entry.id}>
            <summary>Turn {entry.turn}: {entry.actionsExecuted.join(" · ") || "No memory change"}</summary>
            <p className="muted">Created {new Date(entry.createdAt).toLocaleString()}</p>
            {entry.errors.length > 0 && <p>{entry.errors.join(" · ")}</p>}
            <h4>Fired conditions</h4>
            <pre>{JSON.stringify(entry.conditionsFired, null, 2)}</pre>
            <h4>Generated content</h4>
            <pre>{JSON.stringify(entry.generatedContent, null, 2)}</pre>
            <h4>Conditions evaluated</h4>
            <pre>{JSON.stringify(entry.conditionsEvaluated, null, 2)}</pre>
          </details>
        ))}
        <h4>Latest suggestions</h4>
        {recentProposals.length === 0 && <p className="muted">No suggestions recorded yet.</p>}
        {recentProposals.map(proposal => (
          <p className="memory-trace" key={proposal.id}>
            <strong>{proposal.title}</strong><br />
            Detection source not recorded
            {" → "}{destinationName(proposal)}{" → "}{proposal.status}
            {proposal.status === "approved" ? " (approval method not recorded)" : ""}
            {" → "}Context inclusion: check Context Preview
          </p>
        ))}
      </details>
    </div>
  );
}
