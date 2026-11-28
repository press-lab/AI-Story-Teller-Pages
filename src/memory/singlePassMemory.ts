import { relationshipCardError, relationshipCharacterMatches, relationshipIdError, relationshipKey, relationshipNameKey, validateRelationshipIds } from "./relationshipCards";
import { ARC_EVALUATION, arcReferenceState, eligibleArc } from "./currentArc";
import { snapshotFingerprint } from "../utils/snapshotFingerprint";
import type { Adventure, BrainEntry, ChatMessage, ProviderConfig, SinglePassMemoryBatchResult, SinglePassMemoryCheckpoint, SinglePassMemoryFinding, SinglePassMemorySourceResult } from "../types/adventure";
import { assessmentInputs, assessmentSourceState, memoryDecisionState } from "./memoryAssessment";
import { buildMemoryAssessmentConditions } from "../triggers/semanticEngine";
import { autonomousReferences, isAutonomousLore } from "./autonomousLore";
import { memoryEvidenceWindow, storyMemoryMessages } from "./memoryEvidenceWindow";
import { memoryBatchProvider, sendMemoryCompletion } from "../providers/memoryCompletion";
import { generatedStoryCardTriggers } from "./resolveMemoryTarget";
import { storyCardContextContent } from "./storyCardPolicy";
import { createId } from "../utils/id";
import { originalLoreEvidence, sameDayLoreCards } from "./datedLoreRouting";
import { parseLooseMemoryOperations } from "./looseMemoryParser";
import { routeLooseMemoryOperations } from "./looseMemoryRouter";

const profileName = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
/** Linked identity wins; fallback names/aliases must identify exactly one Character. */
export function singlePassCharacterCard(a: Adventure, brain: BrainEntry) {
  const linked = a.storyCards.find(c => c.id === brain.linkedStoryCardId && c.type === "character");
  if (linked) return linked;
  const matches = a.storyCards.filter(c => c.type === "character" && [c.title, ...c.keys].some(name => profileName(name) === profileName(brain.characterName)));
  return matches.length === 1 ? matches[0] : undefined;
}
export function singlePassPersonality(content: string): string {
  const parts = content.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const priority = /personality|voice|motivat|relationship|trust|loyal|proud|protect|humou?r|wit|sarcas|ambiti|values?|fear|want|believ|temper|reserved|guarded|speaks?|manner/i;
  return [...parts.filter(s => priority.test(s)), ...parts.filter(s => !priority.test(s))].join(" ").slice(0, 500);
}

function relationshipReferences(a: Adventure, sourceId: string) {
  const characters = a.storyCards.filter(card => card.type === "character").map(({ id, title, keys }) => ({ id, title, keys }));
  const evidence = " " + relationshipNameKey(memoryEvidenceWindow(a, sourceId).map(message => message.content).join("\n")) + " ";
  const namesInEvidence = [...new Set(characters.flatMap(card => [card.title, ...card.keys].map(relationshipNameKey)))]
    .filter(name => name && evidence.includes(" " + name + " "));
  const identified = new Set(namesInEvidence.flatMap(name => {
    const matches = relationshipCharacterMatches(characters, name);
    return matches.length === 1 ? [matches[0].id] : [];
  }));
  const relevant = (ids: string[] | undefined) => Boolean(ids && !validateRelationshipIds(a.storyCards, ids) && ids.some(id => identified.has(id)));
  const relationships = a.storyCards.filter(card => card.type === "relationship" && relevant(card.relationship?.characterIds))
    .map(card => ({ id: card.id, title: card.title, characterIds: card.relationship!.characterIds, key: relationshipKey(card.relationship!.characterIds),
      content: card.content, invalidLinks: relationshipCardError(a.storyCards, card), active: card.active, pinned: card.pinned, protected: card.protected, priority: card.priority }));
  const coverage = a.activeState.memoryProposals.filter(proposal => proposal.storyCardType === "relationship"
    && ["pending", "rejected", "ignored"].includes(proposal.status) && relevant(proposal.relationship?.characterIds))
    .filter(proposal => !a.messages.slice(a.messages.findIndex(message => message.id === sourceId) + 1).some(message => message.id === proposal.sourceTurnId))
    .map(proposal => ({ characterIds: proposal.relationship!.characterIds, content: proposal.content, status: proposal.status }));
  return { characters, relationships, coverage };
}

/** Exact reference/control guard. Worker bookkeeping and request records are not evidence. */
export function singlePassReferenceState(a: Adventure, sourceId: string, withAutonomousAuthorization = false): string {
  const snapshot = { ...a, messages: a.messages.slice(0, a.messages.findIndex(m => m.id === sourceId) + 1),
    activeState: { ...a.activeState, turn: a.messages.find(m => m.id === sourceId)?.memoryEvaluation?.turn ?? a.activeState.turn },
    semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, sourceId).length } };
  const conditions = buildMemoryAssessmentConditions(snapshot);
  return snapshotFingerprint(JSON.stringify([assessmentSourceState(snapshot, sourceId, conditions), memoryDecisionState(snapshot, sourceId),
    relationshipReferences(a, sourceId),
    sameDayLoreCards(a, sourceId).map(card => [card.id, card.title, card.content, card.lore?.occurredAt, originalLoreEvidence(snapshot, card)]),
    snapshot.components.filter(c => c.type === "immediateMomentum").map(({ memoryUpdateHistory: _history, ...c }) => c),
    snapshot.brains.filter(b => conditions.brains.some(c => c.id === `brain:${b.id}`)).map(b => {
      const card = singlePassCharacterCard(snapshot, b);
      return card ? { brainId: b.id, id: card.id, title: card.title, keys: card.keys, content: card.content } : { brainId: b.id };
    }), ...(withAutonomousAuthorization ? [autonomousReferences(a, sourceId), a.memoryAutoApprove.autonomousLoreStoryCard === true] : [])]));
}
export interface PreparedSinglePassMemoryBatch {
  batchId: string;
  checkpoints: Array<{ sourceId: string; checkpoint: SinglePassMemoryCheckpoint }>;
  outputAliases: Record<string, { sourceId: string; sourceTurn: number;
    evidence: Record<string, { id: string; reference: number }>;
    cards: Record<string, { id: string; reference: number; type: string; memoryMode?: SinglePassMemoryFinding["memoryMode"] }>;
    characters?: Record<string, { id: string; reference: number }>;
    relationships?: Record<string, { id: string; reference: number }>;
    lore?: Record<string, { id: string; reference: number }>;
    autonomousSubjects?: Record<string, { id: string; reference: number }>;
    brains: Record<string, { id: string; reference: number; type: "brain" }>;
    plot: Record<string, { id: string; reference: number; type: string }> }>;
  payload: { references: unknown[]; sources: Array<{ plot: number[]; arcPlan?: number; [key: string]: unknown }> };
}
export async function prepareSinglePassMemoryBatch(a: Adventure, ids: readonly string[], options?: { allowAutonomousDevelopment?: boolean }): Promise<PreparedSinglePassMemoryBatch> {
  if (ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length) throw new Error("Select one to three unique narrator sources.");
  const selected = ids.map(id => a.messages.find(m => m.id === id));
  if (selected.some(m => !m || m.role !== "assistant" || m.inputMode === "comms" || m.memoryEvaluation?.pipeline !== "singlePass"
    || ["complete", "quarantined"].includes(m.memoryEvaluation.status) || !memoryEvidenceWindow(a, m.id).some(e => e.id === m.id))) {
    throw new Error("Single-pass extraction requires saved, unfinished, in-story single-pass sources.");
  }
  const arc = eligibleArc(a);
  const ordered = a.messages.filter(m => ids.includes(m.id));
  const latest = options?.allowAutonomousDevelopment ? storyMemoryMessages(a).reverse().find(message => message.role === "assistant") : undefined;
  const autonomousSource = latest?.id === ordered.at(-1)?.id
    && latest?.memoryEvaluation?.status === "pending" && latest.memoryEvaluation.attempts === 0 ? latest.id : undefined;
  const batchId = createId("memoryBatch");
  const references: unknown[] = [];
  const referenceIndexes = new Map<string | undefined, number>();
  const pool = (value: unknown) => {
    const serialized = JSON.stringify(value);
    const existing = referenceIndexes.get(serialized);
    if (existing !== undefined) return existing;
    const index = references.length;
    references.push(value);
    referenceIndexes.set(serialized, index);
    return index;
  };
  const checkpoints: PreparedSinglePassMemoryBatch["checkpoints"] = [];
  const sources: PreparedSinglePassMemoryBatch["payload"]["sources"] = [];
  const outputAliases: PreparedSinglePassMemoryBatch["outputAliases"] = {};
  for (const source of ordered) {
    const snapshot = { ...a, messages: a.messages.slice(0, a.messages.indexOf(source) + 1),
      activeState: { ...a.activeState, turn: source.memoryEvaluation!.turn },
      semanticEvaluationSettings: { ...a.semanticEvaluationSettings, messagesIncluded: memoryEvidenceWindow(a, source.id).length } };
    const conditions = buildMemoryAssessmentConditions(snapshot);
    const inputs = await assessmentInputs(snapshot, source.id, conditions);
    const brains = inputs.currentBrains.map(b => {
      const brain = snapshot.brains.find(entry => entry.id === b.id)!;
      const card = singlePassCharacterCard(snapshot, brain);
      if (!card) return b;
      const supplied = inputs.currentCards.find(c => c.id === card.id)
        ?? inputs.canon.find(entry => entry.content === "Canon story card: " + card.title + "\n" + storyCardContextContent(card));
      return { ...b, personalityReference: supplied
        ? { cardId: card.id, reference: pool(supplied), use: "personality, motivations, relationships, voice" }
        : { cardId: card.id, personality: singlePassPersonality(card.content) } };
    });
    // Single-pass-only, review-required legacy Momentum support.
    const plot = [...inputs.currentPlot.filter(p => conditions.plot.some(c => c.id.endsWith(":" + p.id))), ...snapshot.components.filter(c => c.type === "immediateMomentum" && c.active && c.autoUpdate !== false)
      .map(c => ({ id: c.id, type: c.type, content: c.content, autoUpdate: c.autoUpdate, protected: c.protected }))];

    if (arc) plot.push({ id: arc.state.id, type: arc.state.type, content: arc.state.content,
      autoUpdate: true, protected: arc.state.protected });

    const autonomous = source.id === autonomousSource ? autonomousReferences(a, source.id) : [];
    const autonomousSubjects = autonomous.length ? Object.fromEntries(autonomous.map(({ authorization, reference }) =>
      [authorization.alias, { id: authorization.cardId, reference: pool(reference) }])) : undefined;

    // Keep source evidence; retain only the digest of the reference/control guard.
    checkpoints.push({ sourceId: source.id, checkpoint: { batchId, sourceContent: source.content, sourceRevision: source.memoryEvaluation?.revision,
      evidence: inputs.evidence.map(({ id, content }) => ({ id, content })), referenceState: singlePassReferenceState(a, source.id, Boolean(autonomousSubjects)),
      ...(autonomousSubjects ? { autonomousSubjects: autonomous.map(({ authorization }) => authorization) } : {}), arcReference: arcReferenceState(a),
      status: "running", findings: [], dispositions: [], acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 } });
    const lore = Object.fromEntries(sameDayLoreCards(a, source.id).map((card, i) => [`L${i + 1}`, {
      id: card.id, reference: pool({ title: card.title, day: card.lore?.occurredAt,
        recentDevelopments: card.content.slice(-1200), originalEvidence: originalLoreEvidence(snapshot, card) }),
    }]));
    const relationRefs = relationshipReferences(a, source.id);
    const characters = Object.fromEntries(relationRefs.characters.map((card, index) => ["C" + (index + 1), { id: card.id, reference: pool(card) }]));
    const relationships = Object.fromEntries(relationRefs.relationships.map((card, index) => ["R" + (index + 1), { id: card.id, reference: pool(card) }]));
    outputAliases[`S${sources.length + 1}`] = {
      sourceId: source.id, sourceTurn: source.memoryEvaluation!.turn, lore, characters, relationships,
      ...(autonomousSubjects ? { autonomousSubjects } : {}),
      evidence: Object.fromEntries(inputs.evidence.map((e, i) => [`E${i + 1}`, { id: e.id, reference: pool(e) }])),
      cards: Object.fromEntries(inputs.currentCards.map((c, i) => [`C${i + 1}`, { id: c.id, reference: pool(c), type: c.type, memoryMode: c.memoryMode }])),
      brains: Object.fromEntries(brains.map((b, i) => [`B${i + 1}`, { id: b.id, reference: pool(b), type: "brain" as const }])),
      plot: Object.fromEntries(plot.map((p, i) => [`P${i + 1}`, { id: p.id, reference: pool({ ...p, title: snapshot.components.find(c => c.id === p.id)?.title }), type: p.type }])),
    };
    sources.push({ sourceId: source.id, conditions, sameDayLore: lore,
      ...(autonomousSubjects ? { autonomousSubjects } : {}),
      consideredRelationshipsNotCanon: relationRefs.coverage.map(pool),
      ...(arc ? { arcPlan: pool({ type: arc.plan.type, content: arc.plan.content, readOnly: true }) } : {}),
      evidence: inputs.evidence.map(pool), canon: inputs.canon.map(entry => {
        const card = inputs.currentCards.find(c => entry.content === "Canon story card: " + c.title + "\n" + c.content);
        if (card) return pool({ role: entry.role, prefix: "Canon story card: " + card.title + "\n", reference: pool(card) });
        const plot = inputs.currentPlot.find(p => entry.content === "Canon component: " + snapshot.components.find(c => c.id === p.id)?.title + "\n" + p.content);
        if (plot) return pool({ role: entry.role, prefix: entry.content.slice(0, -plot.content.length), reference: pool(plot) });
        return pool(entry);
      }), cards: inputs.currentCards.map(c => {
        const saved = snapshot.storyCards.find(card => card.id === c.id);
        return pool(saved?.type === "lore" ? { ...c, originalEvent: { title: saved.title, evidence: originalLoreEvidence(snapshot, saved) } } : c);
      }),
      brains: brains.map(pool), plot: plot.map(p => pool({ ...p, title: snapshot.components.find(c => c.id === p.id)?.title })), consideredSuggestionsNotCanon: inputs.coverage.map(pool) });
  }
  return { batchId, checkpoints, outputAliases, payload: { references, sources } };
}
const POLICY = `SINGLE PASS MEMORY EXTRACTION.
Identify meaningful NEW information in each supplied narrator source. Read canon and considered suggestions to avoid repetition. Keep distinct consequential facts separate. Return one short operation per fact:
(category.subtype: Subject = New information)
Group operations under S1, S2 or S3 in outputAliases source order. Write NONE under an evaluated source with no updates. Evaluate every source. Do not write JSON. Do not write analysis.
Use names and topic titles. The application resolves destinations, evidence, triggers and internal operations locally.
For Brain thoughts, the narrator source establishes the circumstances and character knowledge. A new private interpretation, decision, or intention may be generated from those circumstances even when that specific thought was never narrated. This exception does not authorize invented world events, completed actions, or knowledge.

Categories:
brain: Consider EVERY eligible existing Brain whose character directly participated in, witnessed, or demonstrably learned about the latest development. Subject is the character’s name. Use established personality, motivations, relationships, voice, existing Brain thoughts, and relevant story evidence.

Write meaningful NEW private thoughts in the character’s first-person voice. A thought may contain an observation, interpretation, emotional reaction, suspicion, changed belief, judgment, independent decision, intention, or private plan. Incremental changes qualify. Prefer subtype thoughts. Alternatives currentState, relationshipPressure, emotionalInterpretation, recentDevelopments, and notes remain available for distinct state changes. recentDevelopments is NOT a transcript-summary field. Never create Brains.

INDEPENDENT CHARACTER AGENCY: Characters are independent people with their own interests, goals, loyalties, fears, priorities, and judgment. When recent events give a character a meaningful reason to act, the Brain may originate a NEW private decision, intention, or plan that has never appeared in the narration. The character does not need to announce the decision, receive permission from the player, or wait for the player to initiate it. Determine what the character might independently decide to do based on their established perspective. The plan may support, oppose, complicate, or have no connection to the player’s interests. It may involve another character, a private goal, or a situation unrelated to the player. Characters may also decide to wait, conceal information, reconsider an earlier plan, or deliberately take no action.

EVIDENCE BOUNDARY: Recent story evidence must establish the circumstances and information available to the character. It does NOT need to contain the character’s newly generated private decision. A plausible new intention is original character cognition, not an unsupported factual claim. Do not invent events the character witnessed, information they received, or knowledge they could not possess. Do not present a proposed plan as an action already completed. “I will ask someone to investigate” is a valid new private intention. “I already sent someone to investigate” requires an established action. Keep intentions, attempts, and completed events distinct.

THOUGHT QUALITY: Write what the character privately thinks, wants, concludes, or intends to do. Do not simply repeat the dialogue, summarize the scene, copy the player’s perspective, or rephrase existing thoughts. Private decisions must follow the character’s established personality and current motivations. They do not need to be dramatic, antagonistic, romantic, or directed at the player. Do not force a plan into every update. A character can experience a meaningful internal change without deciding to act.

Never copy dialogue into thoughts, rewrite narration in first person without private meaning, record location or scene participation, repeat existing thoughts in different words, or invent feelings to force an update. Never grant knowledge of unwitnessed events without evidence of learning them. Return no Brain update when nothing meaningful changed.
storyCard: default subtype lore. Lore records consequential events, agreements, plans, discoveries and shared developments. Compare each candidate fact against provided Story Cards and considered suggestions; output ONLY information not already recorded or considered. One ongoing conversation is one development unless a new decision, consequence or fact changes it. Do not record conversational restatements or create a new event because an old event is discussed again. Preserve genuinely new consequences and commitments. Plans, invitations, attempts, offers, accepted agreements and completed outcomes are distinct. Return NONE when no new durable information exists. Give every Lore fact a standalone subject. Use storyCard.lore.create for a new event. Use (storyCard.lore.update: Standalone title = New fact || L1 || Explain how this fact continues the original event) for a direct continuation of a card in this source’s sameDayLore list. Use the listed alias for that source. If the continuation destination is uncertain, use ? in place of the alias and explain the ambiguity. A distinct event on the same day gets its own entry. A later story day starts a new Lore entry. Shared participants do not establish continuity. Appended content cannot redefine the original event. If original evidence does not support the titled event, create focused Lore. Object, Location and Custom updates may use the same fact || destination || reason fields. A participant's biography is not the event destination.
storyCard.character: a genuinely missing person's enduring identity. Existing profiles are protected. Only an explicit evidenced enduring correction uses storyCard.character.update, with a specific explanation after ||. Never infer permanence from a single scene.
storyCard.location: enduring properties of a place, not a one-time event there.
storyCard.object: enduring identity, capabilities, and limits of a named object. Events involving it belong in Lore.
storyCard.relationship: Record only new, established, durable interpersonal facts
between two or more identified characters. Use an exact participant set. A group
relationship is separate from every pair within the group. Do not emit pairs merely
because a group interacts. Use names or unique identity aliases from this source's
Character manifest, separated by ' + ' in the subject. Each participant must have
an existing Character Card. If an identity is missing or ambiguous, do not emit a
relationship operation; a genuinely new person may qualify for Character discovery.

Use the relationship for established friendship, family, rivalry, trust, enduring
boundaries, recurring interaction patterns, commitments, and meaningful changes to
established interpersonal dynamics. Distinguish observable behavior from inference.
Attribute directional facts to the right person. A private belief or feeling is a
Brain finding, not evidence of mutual feeling. Temporary emotion, routine banter,
ordinary affection, flirting, a single gesture or a proposed future relationship
is not a durable change. Never infer consent, attraction or reciprocity.

Compare the exact participant set with existing relationships and considered
suggestions. Output only the novel durable factual delta. Use the same operation
for creation or append; the application chooses the destination. Preserve history:
write a changed relationship as an evidenced transition, not an eternal present
state. Use past tense for superseded facts; do not reset the relationship to an
old state or prescribe future behavior. Do not write a current-status tracker.

Lore records the event, action, circumstances and outcome. Relationship records
what the event actually establishes about the participants' durable connection.
Emit both only when both independently qualify and carry distinct information.
Character records the person's independent identity, traits, role, abilities and
voice; place participant-specific dynamics in Relationship, not Character updates.
Brain records a private interpretation from an eligible existing perspective.
Return NONE if no eligible new fact exists. Never use ordinary trigger phrases
or invent card IDs for a relationship.

storyCard.custom: enduring properties of an established non-person subject, not a catch-all for events.
component.plotEssentials: replacement premise, central conflict and persistent constraints; preserve still-valid foundations (180 words).
component.immediateMomentum: replacement for an existing eligible immediate-momentum component; review required.
Components must use the existing title and correct subtype. Never create components or edit narrationRules, aiInstructions, authorNote, memory or custom components.

Examples:
S1
(storyCard.lore.create: Rune tattoo production order = Fred and George agreed to produce 96 rune tattoos tomorrow.)
(brain.thoughts: George Weasley = I think this could grow beyond individual customers.)
S2
(storyCard.character: Eleanor Vale = Eleanor is a sixth-year Ravenclaw specializing in experimental enchantments.)
(storyCard.location: Observatory Annex = A sealed chamber lies beneath the western tower.)
S1
(storyCard.relationship: Seth + Elliot = Seth and Elliot agreed to rely on one another as trusted confidants.)
S2
(storyCard.relationship: Elliot + Margo + Seth = All three established a recurring post-exam gathering.)
S3
(storyCard.relationship: Elliot + Seth = Elliot withdrew the earlier agreement to share confidential research after their dispute.)

Brain and Story Card subtypes may be omitted when using their defaults. lore: Topic = Information is also valid.
Private interpretation examples (illustrative, not established canon):
Bad: (brain.recentDevelopments: Fred = Fair question, she's one of ours now by dating Press.)
Good, ONLY if supported: (brain.thoughts: Fred = George is treating this like an acquisition attempt. Press seems happy; I'll watch for trouble without making his girlfriend an enemy.)
Bad: (brain.thoughts: George = I said we should be careful.)
Good, ONLY if supported: (brain.thoughts: George = Her warning addresses the risk I missed. I can accept her help while keeping control of our designs.)

A justified existing Character correction:
(storyCard.character.update: Eleanor Vale = Eleanor permanently lost her fire magic. || The experiment established this lasting loss.)

Keep ordinary card deltas concise; length alone does not require manual review. Record only supported new facts, preserving claims, chronology, uncertainty and private knowledge boundaries. Plans remain plans; proposed agreements are not accepted agreements; future meetings have not occurred; attempts are not completed outcomes. Collaboration is not romance. Do not invent private reactions, permanent traits or facts to fill an empty source. Source attachment proves provenance, not semantic correctness. All extracted findings undergo local validation. Valid findings follow the user's configured auto-approval rules. Story Card protection, length, tentative wording, and supported Character profile changes do not independently require manual approval. Preserve explicit prior review decisions and evidence, placement, and chronology safeguards. Never invent certainty to bypass review.`;
const AUTONOMOUS_DEVELOPMENT_POLICY = `AUTONOMOUS WORLD DEVELOPMENT

This section authorizes a separate kind of Lore generation. Ordinary memory extraction records established events. Autonomous development may establish new events outside the current foreground scene.

Only consider autonomous subjects explicitly supplied in the current source’s autonomous subject manifest.

Evaluate each authorized subject independently. Determine whether established events, elapsed story time, objectives, capabilities, resources, obligations, available knowledge, or existing circumstances justify a meaningful off-screen development.

A development may respond to recent gameplay. A development may also occur independently of recent gameplay. A subject does not need to appear in the foreground scene to develop.

Return no autonomous development when nothing meaningful is justified. An authorized subject is an available possibility, not a requirement to generate an event.

Do not force developments to escalate, advance an overarching plot, involve the player, or create an immediate player objective.

Generate concrete developments that occurred outside the player’s current foreground interaction. Preserve established identity, personality, capabilities, relationships, geography, chronology, resources, and world rules.

Only assign knowledge to characters or groups that could reasonably obtain that knowledge. Distinguish observations, reports, rumors, suspicions, conclusions, intentions, attempted actions, and completed actions.

An autonomous subject may form plans and perform actions independently. Do not grant the subject information from narrator-accessible context unless the subject has a credible way to know it.

Do not invent the player’s dialogue, thoughts, feelings, decisions, consent, participation, or actions. Do not resolve the player’s current interaction off-screen. Do not dictate the outcome of a pending player decision.

Do not rewrite established events, introduce retroactive contradictions, or generate major irreversible outcomes solely to create drama.

Develop existing world circumstances. Do not invent arbitrary new central conflicts or unrelated mysteries simply because autonomous development is enabled.

Compare proposed developments with the subject’s approved autonomous history. Continue established circumstances without repeating earlier events.

Pending, rejected, and ignored suggestions are not world history. Do not build subsequent events on them.

Use one concise standalone Lore operation per meaningful new event. Use no more than one operation per autonomous subject in the current evaluation. A single event may involve multiple authorized subjects.

An autonomous development is a new Lore event. Do not use it to update a Character, Relationship, Location, Object, Custom Story Card, Brain, Component, or Current Arc.

Return autonomous developments using this exact format:

(storyCard.lore.autonomous: Specific event title = Event content || A1 || Knowledge holders)

For an event involving multiple authorized subjects:

(storyCard.lore.autonomous: Specific event title = Event content || A1 + A2 || Knowledge holders)

Use only aliases from the current source’s autonomous subject manifest.

Knowledge holders are semicolon-separated character names, groups, or established roles. Use NONE if no character knowledge has been established.

Knowledge holder example:

House Green's remaining command; surviving camp sentries

The event content must be self-contained. State what occurred and preserve relevant uncertainty and information boundaries. Do not describe narrator instructions or future plot requirements.

Do not output autonomous operations under sources that have no autonomous subject manifest.

Continue ordinary memory extraction under the existing instructions. Ordinary Lore must not invent off-screen events.

If no meaningful ordinary or autonomous findings exist, return NONE.`;

export function buildSinglePassMemoryMessages(batch: PreparedSinglePassMemoryBatch): ChatMessage[] {
  const hasArc = Object.values(batch.outputAliases).some(source => Object.values(source.plot).some(p => p.type === "currentArcState"));
  const hasAutonomous = Object.values(batch.outputAliases).some(source => Object.keys(source.autonomousSubjects ?? {}).length);
  const policy = [POLICY, ...(hasArc ? [ARC_EVALUATION] : []), ...(hasAutonomous ? [AUTONOMOUS_DEVELOPMENT_POLICY] : [])].join("\n\n");
  return [{ role: "system", content: policy }, { role: "user", content: JSON.stringify({ ...batch.payload, outputAliases: batch.outputAliases }) }];
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());
const findingKeys = ["kind", "targetId", "title", "content", "brainPatch", "reason", "evidenceQuotes", "candidateOnly", "storyCardType", "operation", "memoryMode", "eventStatus", "suggestedTriggers", "participants", "identityChange", "destinationCandidates", "loreContinuation", "relationship", "autonomous"];
/** Recover metadata only. Never create facts, evidence, patches, or target IDs. */
export function normalizeSinglePassFinding(v: unknown, sourceId: string, adventure?: Adventure, diagnostics: string[] = []): SinglePassMemoryFinding | undefined {
  if (!object(v)) return undefined;
  if (Object.hasOwn(v, "autonomous")) {
    diagnostics.push("Autonomous Lore requires an authorized loose operation.");
    return undefined;
  }
  const f: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v)) {
    if (findingKeys.includes(key)) f[key] = value;
    else diagnostics.push(`Ignored unknown finding field: ${key}.`);
  }
  const target = adventure && (f.kind === "storyCard" ? adventure.storyCards.find(c => c.id === f.targetId)
    : f.kind === "brain" ? adventure.brains.find(b => b.id === f.targetId) : adventure.components.find(c => c.id === f.targetId));
  let recovered = false;
  const missing = (key: string, value: unknown) => {
    if (f[key] === undefined) { f[key] = value; recovered = true; diagnostics.push(`Recovered ${key} locally.`); }
  };
  const words = nonempty(f.content) ? f.content.trim().split(/\s+/) : [];
  const excerpt = words.slice(0, Math.min(8, Math.max(1, words.length - 1))).join(" ").slice(0, 60);
  missing("title", target && ("title" in target ? target.title : target.characterName) || (excerpt || undefined));
  missing("reason", `Extracted from narrator source ${sourceId}.`);
  missing("candidateOnly", true);
  if (f.kind === "storyCard") {
    const card = adventure?.storyCards.find(c => c.id === f.targetId);
    missing("operation", f.targetId === null ? "create" : "append");
    missing("storyCardType", card?.type ?? (f.targetId === null ? "lore" : undefined));
    missing("memoryMode", card?.memoryMode ?? (f.targetId === null ? "static" : undefined));
    if (f.storyCardType !== "relationship") missing("eventStatus", "unresolved");
    missing("participants", []);
    if (f.suggestedTriggers === undefined) missing("suggestedTriggers", adventure && nonempty(f.title) && nonempty(f.content)
      ? generatedStoryCardTriggers(adventure, f.title, f.content, undefined, typeof f.targetId === "string" ? f.targetId : undefined, f.memoryMode as SinglePassMemoryFinding["memoryMode"], f.storyCardType as SinglePassMemoryFinding["storyCardType"]) : []);
  }
  if (recovered) f.candidateOnly = true;
  return singlePassFindingSchemaError(f) ? undefined : f as unknown as SinglePassMemoryFinding;
}
/** Structural checks only. Exact quotation is not proof of the model's interpretation. */
export function singlePassFindingSchemaError(v: unknown): string | undefined {
  if (!object(v) || Object.keys(v).some(key => !["kind", "targetId", "title", "content", "brainPatch", "reason", "evidenceQuotes", "candidateOnly", "storyCardType", "operation", "memoryMode", "eventStatus", "suggestedTriggers", "participants", "identityChange", "destinationCandidates", "loreContinuation", "relationship", "autonomous"].includes(key)) || !["storyCard", "brain", "plotEssentials", "activePressure", "immediateMomentum", "currentArcState"].includes(String(v.kind))
    || !(v.targetId === null || nonempty(v.targetId)) || !nonempty(v.title) || !nonempty(v.reason) || typeof v.candidateOnly !== "boolean"
    || !Array.isArray(v.evidenceQuotes) || (!v.evidenceQuotes.length && v.autonomous === undefined) || v.evidenceQuotes.some(q => !object(q) || !nonempty(q.messageId) || !nonempty(q.quote))) return "Missing or invalid required finding fields.";
  if (v.autonomous !== undefined && (!object(v.autonomous) || Object.keys(v.autonomous).length !== 2
    || !isAutonomousLore(v.autonomous.provenance) || !Array.isArray(v.autonomous.knownTo) || !v.autonomous.knownTo.every(nonempty)
    || v.kind !== "storyCard" || v.storyCardType !== "lore" || v.operation !== "create" || v.targetId !== null
    || v.evidenceQuotes.length !== 0 || v.loreContinuation !== undefined || v.identityChange !== undefined))
    return "Invalid autonomous Lore finding.";
  if (v.loreContinuation !== undefined && v.loreContinuation !== "identified" && v.loreContinuation !== "review") return "Invalid Lore continuation flag.";
  if (v.destinationCandidates !== undefined && (!Array.isArray(v.destinationCandidates) || v.destinationCandidates.some(id => !nonempty(id)))) return "Invalid destination candidates.";
  if (v.kind === "brain") {
    if (!object(v.brainPatch) || !Object.keys(v.brainPatch).length || Object.entries(v.brainPatch).some(([key, value]) =>
      key === "thoughts" ? !object(value) || !Object.keys(value).length || Object.values(value).some(t => t !== null && !nonempty(t))
        : !["currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"].includes(key) || !nonempty(value))) return "Invalid BrainPatch.";
  } else if (!nonempty(v.content)) return "Missing usable factual content.";
  const relationship = v.kind === "storyCard" && v.storyCardType === "relationship";
  if (relationship && (!object(v.relationship) || relationshipIdError(v.relationship.characterIds)
    || !Array.isArray(v.relationship.characterIds) || JSON.stringify(v.relationship.characterIds) !== relationshipKey(v.relationship.characterIds as string[])
    || Object.keys(v.relationship).length !== 1 || v.memoryMode !== "static" || v.eventStatus !== undefined
    || !Array.isArray(v.suggestedTriggers) || v.suggestedTriggers.length)) return "Invalid Relationship Card fields.";
  if (!relationship && v.relationship !== undefined) return "Relationship metadata requires a Relationship Card.";
  if (v.kind === "storyCard" && (!["lore", "character", "location", "object", "relationship", "custom"].includes(String(v.storyCardType))
    || !["append", "create"].includes(String(v.operation)) || !["static", "living", "historical"].includes(String(v.memoryMode))
    || (!relationship && !["completed", "ongoing", "unresolved"].includes(String(v.eventStatus)))
    || !Array.isArray(v.suggestedTriggers) || v.suggestedTriggers.some(t => !nonempty(t))
    || !Array.isArray(v.participants) || v.participants.some(t => !nonempty(t)))) return "Missing Story Card contract fields.";
  return undefined;
}
/** Remove complete wrappers only. Unmatched tags remain and fail JSON parsing. */
function unwrapResponse(text: string): string {
  let value = text.replace(/^\uFEFF/, "").trim();
  let previous: string;
  let fenceRemoved = false;
  do {
    previous = value;
    const fence = /^```(?:json|text|plaintext)?\s*\n?([\s\S]*?)\n?```$/i.exec(value);
    if (fence && !fenceRemoved) { value = fence[1].trim(); fenceRemoved = true; }
    if (value.startsWith("<think>")) {
      const end = value.indexOf("</think>");
      if (end >= 0) value = value.slice(end + 8).trim();
    }
  } while (value !== previous);
  return value;
}
/** Scan JSON tokens. Only complete objects directly in the root sources array survive. */
function recoverSourceRecords(text: string): unknown[] {
  const records: unknown[] = [];
  if (!text.startsWith("{")) return records;
  const stack: string[] = [];
  let quoted = false, escape = false, start = -1, tokenStart = -1, sourcesDepth = -1;
  let sourcesArrayAt = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') {
        quoted = false;
        if (stack.length === 1 && stack[0] === "{" && text.slice(tokenStart, i + 1) === '"sources"') {
          let next = i + 1;
          while (/\s/.test(text[next] ?? "") && next < text.length) next++;
          if (text[next] === ":") {
            next++;
            while (next < text.length && /\s/.test(text[next])) next++;
            if (text[next] === "[") sourcesArrayAt = next;
          }
        }
      }
      continue;
    }
    if (c === '"') { quoted = true; tokenStart = i; continue; }
    if (c === "{" || c === "[") {
      if (c === "[" && i === sourcesArrayAt && stack.length === 1) { sourcesDepth = stack.length + 1; sourcesArrayAt = -1; }
      if (c === "{" && sourcesDepth === stack.length && stack.at(-1) === "[") start = i;
      stack.push(c);
    } else if (c === "}" || c === "]") {
      if (stack.at(-1) !== (c === "}" ? "{" : "[")) break;
      if (c === "}" && start >= 0 && stack.length === sourcesDepth + 1) {
        try { records.push(JSON.parse(text.slice(start, i + 1))); } catch { /* No reconstruction. */ }
        start = -1;
      }
      if (stack.length === sourcesDepth) sourcesDepth = -1;
      stack.pop();
      if (!stack.length) break;
    }
  }
  return records;
}
export function parseSinglePassMemoryResponse(text: string, sourceIds: readonly string[], adventure?: Adventure, aliases?: PreparedSinglePassMemoryBatch["outputAliases"], batch?: PreparedSinglePassMemoryBatch): SinglePassMemoryBatchResult {
  const clean = unwrapResponse(text);
  if (aliases && /^(?:MEM|DONE)\b/im.test(clean)) return parseSinglePassMemoryCommands(text, aliases, adventure);
  const legacyJson = /^\{\s*"sources"\s*:/.test(clean);
  if (adventure && aliases && !legacyJson) {
    // Direct parsing also supports previews; running workers always supply their original batch.
    const previewReferences: unknown[] = [];
    if (!batch) for (const source of Object.values(aliases)) {
      for (const { id, reference } of Object.values(source.characters ?? {})) {
        const card = adventure.storyCards.find(entry => entry.id === id && entry.type === "character");
        if (card) previewReferences[reference] = { id, title: card.title, keys: card.keys };
      }
    }
    const localBatch = batch ?? { batchId: "parse-preview", payload: { references: previewReferences, sources: [] }, outputAliases: aliases,
      checkpoints: Object.values(aliases).map(manifest => {
        const source = adventure.messages.find(m => m.id === manifest.sourceId);
        const checkpoint: SinglePassMemoryCheckpoint = source?.memoryEvaluation?.singlePass ?? {
          batchId: "parse-preview", sourceContent: source?.content ?? "", sourceRevision: source?.memoryEvaluation?.revision,
          evidence: memoryEvidenceWindow(adventure, manifest.sourceId).map(({ id, content }) => ({ id, content })),
          referenceState: singlePassReferenceState(adventure, manifest.sourceId), status: "running", findings: [], dispositions: [],
          acceptedCount: 0, rejectedCount: 0, suppressedCount: 0, reviewCount: 0 };
        return { sourceId: manifest.sourceId, checkpoint };
      }) };
    return routeLooseMemoryOperations(adventure, localBatch, parseLooseMemoryOperations(text, Object.keys(aliases)));
  }
  let records: unknown[];
  try {
    const parsed: unknown = JSON.parse(clean);
    records = object(parsed) && Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch { records = recoverSourceRecords(clean); }
  return { sources: sourceIds.map(sourceId => {
    const matches = records.filter(v => object(v) && v.sourceId === sourceId);
    if (matches.length !== 1 || !object(matches[0]) || !Array.isArray(matches[0].findings)) return { sourceId, findings: [], rejected: [], failureReason: "Missing, duplicate or malformed source record. Explicit Retry required." };
    const result: SinglePassMemorySourceResult = { sourceId, findings: [], findingIndexes: [], rejected: [], diagnostics: [] };
    matches[0].findings.forEach((finding: unknown, index: number) => {
      if (object(finding) && (finding.storyCardType === "relationship" || finding.relationship !== undefined
        || adventure?.storyCards.some(card => card.id === finding.targetId && card.type === "relationship"))) {
        result.rejected.push({ index, reason: "Relationship extraction requires the single-pass loose grammar." });
        return;
      }
      const diagnostics: string[] = [];
      const normalized = normalizeSinglePassFinding(finding, sourceId, adventure, diagnostics);
      result.diagnostics!.push(...diagnostics.map(reason => ({ index, reason })));
      const error = normalized ? undefined : singlePassFindingSchemaError(finding) ?? "Invalid finding metadata.";
      if (error) result.rejected.push({ index, reason: error });
      else { result.findings.push(normalized!); result.findingIndexes!.push(index); }
    });
    if (records.some(v => !object(v) || !sourceIds.includes(String(v.sourceId)))) result.diagnostics!.push({ index: -1, reason: "Rejected unknown source record; no attribution inferred." });
    if (result.rejected.length && !result.findings.length) result.failureReason = "Invalid findings rejected; valid sibling findings retained. Explicit Retry required.";
    return result;
  }) };
}
/** Translate commands locally. Existing validation remains the authority. */
export function parseSinglePassMemoryCommands(text: string, aliases: PreparedSinglePassMemoryBatch["outputAliases"], adventure?: Adventure): SinglePassMemoryBatchResult {
  const states = Object.entries(aliases).map(([alias, manifest]) => ({ alias, manifest, done: false, nextIndex: 0,
    result: { sourceId: manifest.sourceId, findings: [], findingIndexes: [], rejected: [], diagnostics: [] } as SinglePassMemorySourceResult }));
  const stateFor = (alias: string) => states.find(s => s.alias === alias || s.alias === alias.toUpperCase());
  type Command = { state?: typeof states[number]; index: number; header: string; sourceAlias: string; kind: string; target: string; metadata: Record<string, string>;
    evidence: Array<{ messageId: string; quote: string }>; lines: string[]; inText: boolean; errors: string[]; evidenceRecovered?: boolean };
  let current: Command | undefined;
  const diagnostic = (reason: string) => states.forEach(s => s.result.diagnostics!.push({ index: -1, reason }));
  const reject = (c: Command, reason: string) => {
    const detail = `Rejected MEM header: source=${JSON.stringify(c.sourceAlias.slice(0, 160))}; header=${JSON.stringify(c.header)}; kind=${JSON.stringify(c.kind.slice(0, 160))}; target=${JSON.stringify(c.target.slice(0, 160))}; ${reason}`;
    if (c.state) {
      c.state.result.diagnostics!.push({ index: c.index, reason: detail });
      c.state.result.rejected.push({ index: c.index, reason });
    }
    else diagnostic(detail);
  };
  const finish = (c: Command) => {
    if (!c.state) { reject(c, "Unknown source alias; no attribution inferred."); return; }
    const { manifest, result } = c.state;
    const content = c.lines.join("\n").trim(), meta = c.metadata;
    const kinds = ["storyCard", "brain", "plotEssentials", "activePressure"] as const;
    const label = c.kind.toLowerCase().replace(/\s+/g, " ");
    const cardAlias = Object.hasOwn(manifest.cards, c.target) ? c.target : c.target.toUpperCase();
    const kind = label === "story card" || (label === "lore" && (c.target === "NEW" || Object.hasOwn(manifest.cards, cardAlias)))
      ? "storyCard" : kinds.find(k => k.toLowerCase() === label);
    const lookup = <T,>(table: Record<string, T>, alias: string): T | undefined => Object.hasOwn(table, alias) ? table[alias] : Object.hasOwn(table, alias.toUpperCase()) ? table[alias.toUpperCase()] : undefined;
    const card = kind === "storyCard" ? lookup(manifest.cards, c.target) : undefined;
    const brain = kind === "brain" ? lookup(manifest.brains, c.target) : undefined;
    const plot = kind && !["storyCard", "brain"].includes(kind) ? lookup(manifest.plot, c.target) : undefined;
    const isNew = kind === "storyCard" && c.target === "NEW";
    if (!kind) c.errors.push("Unknown memory kind.");
    if (!isNew && !card && !brain && !(plot && plot.type === kind)) c.errors.push("Invalid target alias for memory kind.");
    if (!c.inText || !content) c.errors.push("Missing usable factual content after TEXT.");
    if (!c.evidence.length) c.errors.push("Missing evidence.");
    const recoverCharacterEvent = kind === "storyCard" && card?.type === "character" && !meta.PROFILE && Boolean(content) && c.evidence.length > 0;
    if (meta.PROFILE && !/^(correction|transformation|profile)\s*\|\s*\S[\s\S]*$/i.test(meta.PROFILE)) c.errors.push("Invalid PROFILE kind or missing enduring-change reason.");
    const field = ["thought", "currentState", "relationshipPressure", "emotionalInterpretation", "recentDevelopments", "notes"].find(f => f.toLowerCase() === meta.FIELD?.toLowerCase());
    if (kind === "brain" && !field) c.errors.push("Invalid or missing Brain FIELD.");
    if (c.errors.length) { reject(c, c.errors.join(" ")); return; }
    const targetId = recoverCharacterEvent ? null : card?.id ?? brain?.id ?? plot?.id ?? null;
    const base: Record<string, unknown> = { kind, targetId, content, evidenceQuotes: c.evidence };
    if (meta.TITLE) base.title = meta.TITLE;
    if (meta.REASON) base.reason = meta.REASON;
    if (meta.REVIEW) base.candidateOnly = meta.REVIEW.toLowerCase() === "yes";
    if (kind === "storyCard") {
      base.operation = isNew || recoverCharacterEvent ? "create" : "append";
      if (card?.type === "relationship" || meta.TYPE?.toLowerCase() === "relationship") {
        reject(c, "Relationship extraction requires the single-pass loose grammar.");
        return;
      }
      base.storyCardType = recoverCharacterEvent ? "lore" : card?.type ?? meta.TYPE?.toLowerCase() ?? "lore";
      if (meta.MODE || (!recoverCharacterEvent && card?.memoryMode)) base.memoryMode = meta.MODE?.toLowerCase() ?? card?.memoryMode;
      if (meta.STATUS) base.eventStatus = meta.STATUS.toLowerCase();
      if (card?.type === "character" && !recoverCharacterEvent) {
        const separator = meta.PROFILE.indexOf("|");
        base.identityChange = { targetId, kind: meta.PROFILE.slice(0, separator).trim().toLowerCase(),
          reason: meta.PROFILE.slice(separator + 1).trim(), fact: content, evidenceQuotes: c.evidence };
        base.candidateOnly = true;
      }
    }
    if (kind === "brain") {
      if (field === "thought") {
        const slug = manifest.sourceId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        const key = `memory_${slug}_${c.index + 1}`;
        const existing = adventure?.brains.find(b => b.id === targetId);
        if (existing && (key in existing.thoughts || key in existing.archivedThoughts)) {
          reject(c, "Generated Brain thought key already exists; existing thoughts must not be overwritten."); return;
        }
        base.brainPatch = { thoughts: { [key]: `${manifest.sourceTurn} \u2192 ${content}` } };
      } else base.brainPatch = { [field!]: content };

    }
    const diagnostics: string[] = [];
    if (c.evidenceRecovered || recoverCharacterEvent) base.candidateOnly = true;
    if (recoverCharacterEvent) diagnostics.push("Character event routed to focused Lore proposal; no PROFILE justification.");
    const finding = normalizeSinglePassFinding(base, manifest.sourceId, adventure, diagnostics);
    result.diagnostics!.push(...diagnostics.map(reason => ({ index: c.index, reason })));
    if (!finding) reject(c, singlePassFindingSchemaError(base) ?? "Invalid finding metadata.");
    else {
      if (kind === "brain") delete finding.content;
      result.findings.push(finding); result.findingIndexes!.push(c.index);
    }
  };
  const clean = unwrapResponse(text);
  const blocked = clean.startsWith("<think>") || clean.startsWith("```");
  if (blocked) diagnostic("Incomplete response wrapper; no commands parsed.");
  for (const raw of blocked ? [] : clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (current?.inText) {
      if (/^END$/i.test(line)) { finish(current); current = undefined; continue; }
      current.lines.push(raw); continue;
    }
    const mem = /^MEM\s+(\S+)\s+(story\s+card|\S+)\s+(\S+)$/i.exec(line);
    if (mem) {
      if (current) reject(current, "Incomplete memory command: missing TEXT or END.");
      const state = stateFor(mem[1]);
      current = { state, index: state ? state.nextIndex++ : -1, header: raw.slice(0, 160), sourceAlias: mem[1], kind: mem[2], target: mem[3], metadata: {}, evidence: [], lines: [], inText: false,
        errors: state?.done ? ["Command after DONE."] : [] };
      continue;
    }
    const malformedMem = /^MEM(?:\s+(\S+))?(?:\s.*)?$/i.exec(line);
    if (malformedMem) {
      if (current) reject(current, "Incomplete memory command: missing END.");
      const state = malformedMem[1] ? stateFor(malformedMem[1]) : undefined;
      const partial = /^MEM\s+\S+(?:\s+(story\s+card|\S+))?(?:\s+(\S+))?/i.exec(line);
      current = { state, index: state ? state.nextIndex++ : -1, header: raw.slice(0, 160), sourceAlias: malformedMem[1] ?? "",
        kind: partial?.[1] ?? "", target: partial?.[2] ?? "", metadata: {}, evidence: [], lines: [], inText: false, errors: ["Invalid MEM syntax."] };
      continue;
    }
    const done = /^DONE\s+(\S+)$/i.exec(line);
    if (done) {
      if (current) { reject(current, "Incomplete memory command: missing END."); current = undefined; }
      const state = stateFor(done[1]);
      if (!state) diagnostic("Unknown source alias in DONE; no attribution inferred.");
      else if (state.done) { state.result.failureReason = "Duplicate DONE marker. Explicit Retry required."; state.result.diagnostics!.push({ index: -1, reason: "Duplicate DONE marker." }); }
      else state.done = true;
      continue;
    }
    if (!current) { if (line) diagnostic("Rejected text outside a memory command."); continue; }
    if (/^TEXT$/i.test(line)) { current.inText = true; continue; }
    if (/^END$/i.test(line)) { finish(current); current = undefined; continue; }
    const evidence = /^E\s+([^\s|]+)(?:\s*\|([\s\S]*))?$/i.exec(line);
    if (evidence) {
      const table = current.state?.manifest.evidence;
      const entry = table && Object.hasOwn(table, evidence[1]) ? table[evidence[1]] : undefined;
      const message = entry && adventure?.messages.find(m => m.id === entry.id);
      if (!entry) current.errors.push("Invalid evidence alias.");
      else if (!message || !message.content.trim()) current.errors.push("Missing or empty original evidence message.");
      else {
        const suppliedQuote = evidence[2]?.trim();
        const exact = Boolean(suppliedQuote && message.content.includes(suppliedQuote));
        current.evidence.push({ messageId: entry.id, quote: exact ? suppliedQuote! : message.content });
        if (!exact) {
          current.evidenceRecovered = true;
          current.state!.result.diagnostics!.push({ index: current.index, reason: suppliedQuote
            ? "Nonverbatim quote replaced by exact source evidence; review required."
            : "Alias-based evidence resolution attached exact source evidence; review required." });
        }
      }
      continue;
    }
    const optional = /^(TITLE|TYPE|MODE|STATUS|REVIEW|REASON|FIELD|PROFILE)\s+(.+)$/i.exec(line);
    if (optional) {
      const key = optional[1].toUpperCase();
      if (key in current.metadata) current.errors.push(`Duplicate ${key} field.`);
      current.metadata[key] = optional[2].trim();
      const choices: Record<string, string[]> = { TYPE: ["lore", "character", "location", "object", "custom"], MODE: ["static", "living", "historical"], STATUS: ["completed", "ongoing", "unresolved"], REVIEW: ["yes", "no"] };
      if (choices[key] && !choices[key].includes(optional[2].trim().toLowerCase())) current.errors.push(`Invalid ${key} value.`);
      continue;
    }
    if (line) current.errors.push("Invalid command syntax before TEXT.");
  }
  if (current) reject(current, "Incomplete memory command: missing END.");
  for (const state of states) {
    if (!state.done) state.result.failureReason = "Missing DONE; source evaluation unfinished. Explicit Retry required.";
    else if (state.result.rejected.length && !state.result.findings.length) state.result.failureReason = "Invalid commands rejected; valid sibling findings retained. Explicit Retry required.";
  }
  return { sources: states.map(s => s.result) };
}

export async function runSinglePassMemoryBatch(a: Adventure, provider: ProviderConfig, batch: PreparedSinglePassMemoryBatch): Promise<SinglePassMemoryBatchResult> {
  // An arc can change between async preparation and the saved claim. Remove stale
  // material from the request while retaining ordinary references and the claim.
  if (batch.checkpoints.some(({ checkpoint }) => checkpoint.arcReference && checkpoint.arcReference !== arcReferenceState(a))) {
    const removed = new Set<number>();
    const outputAliases = Object.fromEntries(Object.entries(batch.outputAliases).map(([alias, source]) => {
      const plot = Object.fromEntries(Object.entries(source.plot).filter(([, entry]) => {
        if (entry.type !== "currentArcState") return true;
        removed.add(entry.reference);
        return false;
      }));
      return [alias, { ...source, plot }];
    }));
    const sources = batch.payload.sources.map(({ arcPlan, ...source }) => {
      if (arcPlan !== undefined) removed.add(arcPlan);
      return { ...source, plot: source.plot.filter(reference => !removed.has(reference)) };
    });
    batch = { ...batch, outputAliases, payload: {
      sources, references: batch.payload.references.map((reference, index) => removed.has(index) ? null : reference),
    } };
  }
  const config = memoryBatchProvider(provider, batch.checkpoints.map(s => s.sourceId));
  // Bounded extraction output, independent of narration settings. Cancellation guard stays on this exact config.
  config.memoryRequest = { ...config.memoryRequest!, batchId: batch.batchId, attempt: Math.max(1, ...batch.checkpoints.map(c => a.messages.find(m => m.id === c.sourceId)?.memoryEvaluation?.attempts ?? 1)) };
  const extractionLimit = Math.min(8192, Math.max(provider.maxOutputTokens || 0, 1024 + batch.checkpoints.length * 2048));
  config.maxOutputTokens = provider.connectionType === "local" ? Math.min(provider.maxOutputTokens, extractionLimit) : extractionLimit;
  const response = await sendMemoryCompletion(a, config, buildSinglePassMemoryMessages(batch), "singlePass");
  let result: SinglePassMemoryBatchResult;
  try { result = parseSinglePassMemoryResponse(response.content, batch.checkpoints.map(s => s.sourceId), a, batch.outputAliases, batch); }
  catch (error) {
    const failure = new Error("memory_parsing_or_validation_failed: " + (error instanceof Error ? error.message : String(error)));
    if (error instanceof Error) failure.stack = error.stack;
    throw failure;
  }
  return { ...result, usage: response.usage };
}

