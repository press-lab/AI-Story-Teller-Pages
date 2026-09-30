import { createDefaultAdventure, makeBrain, makeComponent, makeStoryCard } from "../state/defaults";
import type { Adventure, MemoryProposal } from "../types/adventure";

const timestamp = "2026-01-01T00:00:00.000Z";

export function makeMemoryProposal(overrides: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    id: overrides.id ?? "proposal-private-joke",
    sourceTurnId: overrides.sourceTurnId ?? "msg-user-1",
    sourceText: overrides.sourceText ?? "Margo calls Seth hedge prince as a private joke.",
    proposedType: overrides.proposedType ?? "storyCard",
    title: overrides.title ?? "Hedge Prince Joke",
    content: overrides.content ?? "Margo privately calls Seth hedge prince as a teasing joke.",
    suggestedTriggers: overrides.suggestedTriggers ?? ["Margo", "Seth", "hedge prince"],
    confidence: overrides.confidence ?? 0.9,
    rationale: overrides.rationale ?? "Recurring private joke.",
    status: overrides.status ?? "pending",
    targetId: overrides.targetId,
    appendContent: overrides.appendContent,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    memoryMode: overrides.memoryMode,
    storyCardType: overrides.storyCardType,
    autoUpdate: overrides.autoUpdate,
    autoUpdateCooldownTurns: overrides.autoUpdateCooldownTurns,
  };
}

export function goldenAdventure(): Adventure {
  const aiInstructions = makeComponent({
    id: "component-ai",
    title: "AI Instructions",
    type: "aiInstructions",
    content: "Use second person and preserve player agency.",
    alwaysOn: true,
    active: true,
    priority: 300,
  });
  const plotEssentials = makeComponent({
    id: "component-plot",
    title: "Plot Essentials",
    type: "plotEssentials",
    content: "The Beast is actively hunting Seth tonight.",
    alwaysOn: false,
    active: true,
    priority: 280,
  });
  const authorNote = makeComponent({
    id: "component-author",
    title: "Author's Note",
    type: "authorNote",
    content: "Keep the tone intimate and tense.",
    alwaysOn: true,
    active: true,
    priority: 260,
  });
  const pinnedNormal = makeComponent({
    id: "component-pinned",
    title: "Pinned Weather",
    type: "custom",
    content: "Rain makes the city smell like iron.",
    pinned: true,
    active: true,
    priority: 40,
  });
  const inactiveNormal = makeComponent({
    id: "component-inactive",
    title: "Inactive Note",
    type: "memory",
    content: "This should not load.",
    active: false,
    priority: 500,
  });

  const jokeCard = makeStoryCard({
    id: "card-joke",
    title: "Hedge Prince Joke",
    keys: ["hedge prince", "Margo"],
    matchType: "phrase",
    content: "Margo calls Seth hedge prince as a private joke.",
    active: true,
    priority: 100,
  });
  const beastCard = makeStoryCard({
    id: "card-beast",
    title: "The Beast",
    keys: ["Beast"],
    matchType: "keyword",
    content: "The Beast hunts by scent and old promises.",
    active: true,
    priority: 90,
  });
  const inactiveCard = makeStoryCard({
    id: "card-inactive",
    title: "Inactive Secret",
    keys: ["silent bell"],
    content: "This inactive secret should not load.",
    active: false,
    priority: 200,
  });

  const margoBrain = makeBrain({
    id: "brain-margo",
    characterName: "Margo",
    triggers: ["hedge prince"],
    thoughts: { turn1_protective: "1 → I tease the hedge prince so he can't see how scared I am for him." },
    active: true,
    priority: 80,
  });
  const sethBrain = makeBrain({
    id: "brain-seth",
    characterName: "Seth",
    triggers: ["Seth"],
    thoughts: { turn1_ward: "1 → The ward feels wrong. I don't trust it, and I don't trust who built it." },
    active: true,
    priority: 70,
  });

  return {
    ...createDefaultAdventure("Golden Adventure"),
    components: [aiInstructions, plotEssentials, authorNote, pinnedNormal, inactiveNormal],
    storyCards: [jokeCard, beastCard, inactiveCard],
    brains: [margoBrain, sethBrain],
    rollingSummary: {
      content: "Seth and Margo entered the old city while the Beast drew closer.",
      updatedAt: timestamp,
    },
    messages: [
      { id: "msg-1", role: "assistant", content: "Rain tapped against the glass.", createdAt: timestamp },
      { id: "msg-2", role: "user", content: "I ask Margo about the ward.", createdAt: timestamp },
      { id: "msg-3", role: "assistant", content: "Margo glances toward Seth.", createdAt: timestamp },
      { id: "msg-4", role: "user", content: "I repeat the hedge prince joke.", createdAt: timestamp },
      { id: "msg-5", role: "assistant", content: "The Beast howls somewhere below.", createdAt: timestamp },
      { id: "msg-6", role: "user", content: "We hurry toward the threshold.", createdAt: timestamp },
    ],
    activeState: {
      ...createDefaultAdventure("Golden Adventure").activeState,
      turn: 3,
      memoryProposals: [],
    },
    tokenBudgetSettings: {
      maxContextTokens: 5000,
      maxRecentMessages: 6,
      memoryPriorityMode: "userLocked",
      allowSystemToPrioritizeMemory: false,
      allowSystemToDropUnpinnedTriggeredCards: true,
      allowSystemToTruncateSummary: true,
      recentMessageWindow: 6,
      sectionBudgets: {},
      autoSummarize: false,
      autoSummarizeEveryNTurns: 20,
      autoSceneStateEveryNTurns: 1,
      sceneStateEnabled: true,
      summaryEnabled: true,
    },
  };
}
