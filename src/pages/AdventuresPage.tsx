import { useEffect, useState, type ChangeEvent } from "react";
import type {
  Adventure,
  AdventureThumbnailImage,
  ComponentEntry,
  ComponentType,
  GitHubSaveSlot,
  NewAdventureSetup,
  ProviderConfig,
  StoryCard,
  StoryCardMemoryMode,
  StoryCardType,
} from "../types/adventure";
import type { AdventureSummary } from "../db/adventureDb";
import { defaultNarrationRulesContent, makeComponent, makeStoryCard } from "../state/defaults";
import { parseAidStoryCards } from "../importers/aidCardParser";
import { importAdventureJson } from "../utils/json";
import {
  runAdventureGen,
  type AdventureAdultContentMode,
  type AdventurePlayerControlMode,
  type AdventureProseMode,
  type AdventureStoryShape,
} from "../ai/adventureGen";
import { createId } from "../utils/id";
import { CheckboxField, Field, NumberInput, fromCommaList } from "./shared";
import { AdventureThumbnailFrame, AdventureThumbnailPicker } from "../components/AdventureThumbnail";
import type { PremadeAdventureDefinition, PremadeAdventureId } from "../dev/premadeAdventures";

interface AdventuresPageProps {
  adventures: AdventureSummary[];
  currentAdventure?: Adventure;
  onCreate: (setup: NewAdventureSetup) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onOpenEdit?: (id: string) => Promise<void>;
  onDuplicate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateAdventureFromImport?: (adventure: Adventure) => Promise<void>;
  onOpenImportedAdventure?: () => void;
  saveSlots?: GitHubSaveSlot[];
  savesStatus?: string;
  loadingSlotId?: string;
  loadError?: string;
  onDismissError?: () => void;
  onListSaves?: () => void;
  onLoadSave?: (slot: GitHubSaveSlot) => void;
  onDeleteSave?: (slot: GitHubSaveSlot) => void;
  providerConfig?: ProviderConfig;
  premadeAdventures?: PremadeAdventureDefinition[];
  onLoadPremadeAdventure?: (id: PremadeAdventureId) => Promise<void>;
}

interface ComponentDraft {
  id: string;
  source: "manual" | "generated";
  type: ComponentType;
  content: string;
  priority: number;
  alwaysOn: boolean;
  pinned: boolean;
  protected: boolean;
}

interface StoryCardDraft {
  id: string;
  source: "manual" | "generated";
  title: string;
  keysText: string;
  content: string;
  type: StoryCardType;
  memoryMode: StoryCardMemoryMode;
  priority: number;
  pinned: boolean;
}

const componentTypes: ComponentType[] = [
  "narrationRules",
  "aiInstructions",
  "plotEssentials",
  "activePressure",
  "authorNote",
  "custom",
];

const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  narrationRules: "Narration Rules",
  aiInstructions: "AI Instructions",
  plotEssentials: "Plot Essentials",
  currentArc: "Current Story Arc",
  activePressure: "Active Pressure",
  immediateMomentum: "Immediate Momentum",
  authorNote: "Author's Note",
  memory: "Lore Block (legacy)",
  custom: "Custom",
};
const storyCardTypes: StoryCardType[] = ["character", "location", "lore", "plot", "custom"];
const uniqueComponentTypes = new Set<ComponentType>([
  "narrationRules",
  "aiInstructions",
  "plotEssentials",
  "authorNote",
  "currentArc",
  "activePressure",
]);

const storyShapeOptions: Array<{ value: AdventureStoryShape; label: string; description: string }> = [
  { value: "balanced", label: "Balanced starter", description: "Small cast, clear premise, active pressure, and a few durable cards." },
  { value: "sandbox", label: "Sandbox", description: "Reactive world, loose hooks, more factions/locations, less plot locking." },
  { value: "missionLoop", label: "Mission loop", description: "Jobs create fallout, fallout creates team scenes, team scenes create the next job." },
  { value: "mystery", label: "Mystery", description: "Known question in PE, clues/suspects/secrets in Story Cards, no early answer." },
  { value: "factionPolitics", label: "Faction politics", description: "Leverage, alliances, public pressure, and consequences." },
  { value: "romanceDrama", label: "Romance drama", description: "Choice-driven tension, banter, relationships as pressure, not forced commitment." },
  { value: "survivalHorror", label: "Survival / horror", description: "Threat rules, scarcity, safe places, dread, and consequences." },
];

const proseModeOptions: Array<{ value: AdventureProseMode; label: string; description: string }> = [
  { value: "balanced", label: "Balanced", description: "Dialogue, action, and sensory detail without padding." },
  { value: "minimalist", label: "Minimalist", description: "Fast, lean, short paragraphs, little description." },
  { value: "novelistic", label: "Novelistic", description: "Richer atmosphere, emotional texture, slower character work." },
  { value: "cinematic", label: "Cinematic", description: "Visible behavior, motion, blocking, sound, and consequences." },
  { value: "dialogueHeavy", label: "Dialogue-heavy", description: "Distinct voices, interruptions, subtext, and social moves." },
];

const playerControlOptions: Array<{ value: AdventurePlayerControlMode; label: string; description: string }> = [
  { value: "strict", label: "Never write my character", description: "The AI leaves your words, thoughts, choices, actions, and reactions unwritten." },
  { value: "minorActions", label: "Minor implied actions OK", description: "The AI may bridge tiny motions for flow, but not decisions or emotions." },
  { value: "cinematicFlow", label: "Cinematic scene flow", description: "The AI can write small player beats, while major choices stay yours." },
];

const adultContentOptions: Array<{ value: AdventureAdultContentMode; label: string; description: string }> = [
  { value: "off", label: "Off", description: "No sexual setup or NSFW generation rules." },
  { value: "romanceOnly", label: "Romance only", description: "Attraction, intimacy, flirtation, and relationship tension without explicit sexual content." },
  { value: "explicitAdult", label: "Explicit adult opt-in", description: "Adds a separate adult-content section, consenting-adult framing, and boundaries." },
];

function isFixedComponentType(type: ComponentType): boolean {
  return type === "narrationRules" || type === "aiInstructions" || type === "plotEssentials" || type === "authorNote";
}

function defaultComponentPriority(type: ComponentType): number {
  if (type === "narrationRules") return 100;
  if (type === "aiInstructions") return 90;
  if (type === "plotEssentials") return 80;
  if (type === "activePressure") return 245;
  if (type === "authorNote") return 70;
  return 0;
}

function blankComponentDraft(type: ComponentType = "plotEssentials"): ComponentDraft {
  const fixed = isFixedComponentType(type);
  return {
    id: createId("componentDraft"),
    source: "manual",
    type,
    content: "",
    priority: defaultComponentPriority(type),
    alwaysOn: fixed,
    pinned: fixed,
    protected: fixed,
  };
}

function blankStoryCardDraft(): StoryCardDraft {
  return {
    id: createId("storyDraft"),
    source: "manual",
    title: "New Story Card",
    keysText: "",
    content: "",
    type: "custom",
    memoryMode: "static",
    priority: 0,
    pinned: false,
  };
}

function componentFromDraft(draft: ComponentDraft): ComponentEntry | undefined {
  const content = draft.content.trim();
  if (!content) return undefined;
  return makeComponent({
    title: COMPONENT_TYPE_LABELS[draft.type],
    type: draft.type,
    content,
    priority: draft.priority,
    alwaysOn: draft.alwaysOn,
    active: true,
    pinned: draft.pinned,
    protected: draft.protected,
  });
}

function storyCardFromDraft(draft: StoryCardDraft): StoryCard | undefined {
  const title = draft.title.trim();
  const content = draft.content.trim();
  if (!title && !content) return undefined;
  return makeStoryCard({
    title: title || "Untitled Story Card",
    keys: fromCommaList(draft.keysText),
    content,
    type: draft.type,
    memoryMode: draft.memoryMode,
    priority: draft.priority,
    active: true,
    pinned: draft.pinned,
  });
}

function formatUtc(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").replace(/Z$/, " UTC");
}

function formatCount(count: number | undefined, singular: string, plural = `${singular}s`): string {
  const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count ?? 0)) : 0;
  return `${normalized.toLocaleString()} ${normalized === 1 ? singular : plural}`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdventuresPage({
  adventures,
  currentAdventure,
  onCreate,
  onOpen,
  onOpenEdit,
  onDuplicate,
  onDelete,
  onCreateAdventureFromImport,
  onOpenImportedAdventure,
  saveSlots,
  savesStatus,
  loadingSlotId,
  loadError,
  onDismissError,
  onListSaves,
  onLoadSave,
  onDeleteSave,
  providerConfig,
  premadeAdventures = [],
  onLoadPremadeAdventure,
}: AdventuresPageProps) {
  const [view, setView] = useState<"list" | "create" | "aistImport" | "github" | "premade">("list");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  function toggleExpand(id: string) { setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] })); }

  useEffect(() => {
    if (view === "github") onListSaves?.();
    // intentional: only fire when entering the github view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const [title, setTitle] = useState("New Adventure");
  const [openingScene, setOpeningScene] = useState("");
  const [thumbnailImage, setThumbnailImage] = useState<AdventureThumbnailImage | undefined>();
  const [componentDrafts, setComponentDrafts] = useState<ComponentDraft[]>([{
    id: createId("componentDraft"),
    source: "manual",
    type: "narrationRules",
    content: defaultNarrationRulesContent,
    priority: 100,
    alwaysOn: true,
    pinned: true,
    protected: true,
  }]);
  const [manualStoryCardDrafts, setManualStoryCardDrafts] = useState<StoryCardDraft[]>([]);
  const [storyCardJsonText, setStoryCardJsonText] = useState("");
  const [jsonStoryCards, setJsonStoryCards] = useState<StoryCard[]>([]);
  const [jsonImportError, setJsonImportError] = useState<string | undefined>();
  const [jsonImportMessages, setJsonImportMessages] = useState<string[]>([]);
  const [aistImportText, setAistImportText] = useState("");
  const [aistImportFilename, setAistImportFilename] = useState("");
  const [aistImportStatus, setAistImportStatus] = useState("");
  const [aistImportError, setAistImportError] = useState<string | undefined>();
  const [aistImportPreview, setAistImportPreview] = useState<Adventure | undefined>();
  const [premise, setPremise] = useState("");
  const [storyShape, setStoryShape] = useState<AdventureStoryShape>("balanced");
  const [proseMode, setProseMode] = useState<AdventureProseMode>("balanced");
  const [playerControl, setPlayerControl] = useState<AdventurePlayerControlMode>("strict");
  const [adultContent, setAdultContent] = useState<AdventureAdultContentMode>("off");
  const [adultBoundaries, setAdultBoundaries] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | undefined>();
  const [setupError, setSetupError] = useState<string | undefined>();

  const starterComponents = componentDrafts.map(componentFromDraft).filter((component): component is ComponentEntry => Boolean(component));
  const manualStoryCards = manualStoryCardDrafts.map(storyCardFromDraft).filter((card): card is StoryCard => Boolean(card));
  const totalStoryCardCount = manualStoryCards.length + jsonStoryCards.length;

  function updateComponentDraft(id: string, patch: Partial<ComponentDraft>) {
    setComponentDrafts((drafts) =>
      drafts.map((draft) => {
        if (draft.id !== id) return draft;
        const next = { ...draft, ...patch };
        if (patch.type) {
          const fixed = isFixedComponentType(patch.type);
          next.priority = defaultComponentPriority(patch.type);
          next.alwaysOn = fixed || next.alwaysOn;
          next.pinned = fixed || next.pinned;
          next.protected = fixed;
        }
        return next;
      }),
    );
  }

  function updateStoryCardDraft(id: string, patch: Partial<StoryCardDraft>) {
    setManualStoryCardDrafts((drafts) => drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function parseStoryCardJson(text = storyCardJsonText) {
    const result = parseAidStoryCards(text);
    if (result.error) {
      setJsonStoryCards([]);
      setJsonImportError(result.error);
      setJsonImportMessages(result.warnings);
      return;
    }
    setJsonStoryCards(result.cards.map((card) => card.storyCard));
    setJsonImportError(undefined);
    setJsonImportMessages([
      ...result.warnings,
      ...(result.skipped.length ? [`Skipped ${result.skipped.length} invalid card(s).`] : []),
    ]);
  }

  async function readStoryCardFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setStoryCardJsonText(text);
    parseStoryCardJson(text);
  }

  function previewAistAdventure(text: string) {
    const trimmed = text.trim();
    setAistImportText(text);
    setAistImportStatus("");
    if (!trimmed) {
      setAistImportPreview(undefined);
      setAistImportError(undefined);
      return;
    }

    try {
      setAistImportPreview(importAdventureJson(trimmed));
      setAistImportError(undefined);
    } catch (error) {
      setAistImportPreview(undefined);
      setAistImportError(error instanceof Error ? error.message : "Import failed.");
    }
  }

  async function readAistAdventureFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setAistImportFilename(file.name);
    previewAistAdventure(text);
    setAistImportStatus(`Loaded ${file.name}. Review the preview, then import.`);
    event.target.value = "";
  }

  async function createAdventureFromAist() {
    if (!onCreateAdventureFromImport || !aistImportPreview) {
      setAistImportError("Choose a valid AIST adventure JSON file before importing.");
      return;
    }
    await onCreateAdventureFromImport(aistImportPreview);
    setAistImportText("");
    setAistImportFilename("");
    setAistImportPreview(undefined);
    setAistImportStatus(`Imported "${aistImportPreview.title}".`);
    onOpenImportedAdventure?.();
    if (!onOpenImportedAdventure) setView("list");
  }

  async function createAdventure() {
    const duplicateTypes = starterComponents
      .map((component) => component.type)
      .filter((type, index, types) => uniqueComponentTypes.has(type) && types.indexOf(type) !== index);
    if (duplicateTypes.length > 0) {
      setSetupError(`Keep only one ${COMPONENT_TYPE_LABELS[duplicateTypes[0]]} component.`);
      return;
    }
    const unreachableCard = [...manualStoryCards, ...jsonStoryCards].find(
      (card) => !card.pinned && card.keys.length === 0,
    );
    if (unreachableCard) {
      setSetupError(`Add at least one trigger to "${unreachableCard.title}", or pin the card so it can enter context.`);
      return;
    }
    setSetupError(undefined);
    await onCreate({
      title: title.trim() || "New Adventure",
      openingScene: openingScene.trim(),
      components: starterComponents,
      storyCards: [...manualStoryCards, ...jsonStoryCards],
      thumbnailImage,
    });
  }

  async function generateAdventure() {
    if (!providerConfig || !premise.trim()) return;
    setGenLoading(true);
    setGenError(undefined);
    try {
      const result = await runAdventureGen(premise, providerConfig, {
        storyShape,
        proseMode,
        playerControl,
        adultContent,
        boundaries: adultContent === "off" ? "" : adultBoundaries,
      });
      if (result.title) setTitle(result.title);
      if (result.openingScene) setOpeningScene(result.openingScene);
      setComponentDrafts((existing) => {
        const preserved = existing.filter((draft) => draft.source !== "generated");
        const existingTypes = new Set(preserved.map((draft) => draft.type));
        const generatedTypes = new Set<ComponentType>();
        const generatedContent = new Set<string>();
        const generated = result.components.flatMap((component) => {
          const type = component.type as ComponentType;
          const contentKey = `${type}:${component.content.trim().toLocaleLowerCase()}`;
          if (
            (uniqueComponentTypes.has(type) && (existingTypes.has(type) || generatedTypes.has(type)))
            || generatedContent.has(contentKey)
          ) {
            return [];
          }
          generatedTypes.add(type);
          generatedContent.add(contentKey);
          const fixed = isFixedComponentType(type);
          return [{
            id: createId("componentDraft"),
            source: "generated" as const,
            type,
            content: component.content,
            priority: component.priority ?? defaultComponentPriority(type),
            alwaysOn: fixed || (component.alwaysOn ?? true),
            pinned: fixed || (component.pinned ?? false),
            protected: fixed,
          }];
        });
        return [...preserved, ...generated];
      });
      setManualStoryCardDrafts((existing) => {
        const preserved = existing.filter((draft) => draft.source !== "generated");
        const seenTitles = new Set([
          ...preserved.map((draft) => draft.title.trim().toLocaleLowerCase()),
          ...jsonStoryCards.map((card) => card.title.trim().toLocaleLowerCase()),
        ].filter(Boolean));
        const generated = result.storyCards.flatMap((card) => {
          const titleKey = card.title.trim().toLocaleLowerCase();
          if (!titleKey || seenTitles.has(titleKey)) return [];
          seenTitles.add(titleKey);
          return [{
            id: createId("storyCardDraft"),
            source: "generated" as const,
            title: card.title,
            type: card.type as StoryCardType,
            memoryMode: card.memoryMode ?? "static",
            keysText: (card.keys ?? []).join(", "),
            content: card.content,
            priority: card.priority ?? 0,
            pinned: card.pinned ?? false,
          }];
        });
        return [...preserved, ...generated];
      });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenLoading(false);
    }
  }

  if (view === "create") {
    return (
      <section className="page">
        <article className="panel new-adventure-setup">
          <div className="panel-heading">
            <div>
              <button type="button" onClick={() => setView("list")}>
                ← Library
              </button>
              <p className="eyebrow">New Adventure</p>
              <h3>Set up before playing</h3>
              <p className="muted">
                Add starter context and Story Cards now, or leave everything blank and build it later.
              </p>
            </div>
            <div className="toolbar">
              <button type="button" onClick={() => setView("aistImport")}>
                Import from AIST
              </button>
              <button type="button" className="primary-action" onClick={createAdventure}>
                Create Adventure
              </button>
            </div>
          </div>
          {setupError && <p className="error-box">{setupError}</p>}

          {providerConfig && (
            <details className="setup-panel" open={!title || title === "New Adventure"}>
              <summary>Generate with AI</summary>
              <p className="muted">
                Describe your adventure idea and the AI will draft a title, opening scene, components, and story cards for you to review.
              </p>
              <Field label="Premise">
                <textarea
                  rows={4}
                  value={premise}
                  onChange={(event) => setPremise(event.target.value)}
                  placeholder="e.g. A disgraced knight in a crumbling empire must choose between loyalty to a corrupt emperor and a rebel cause led by his estranged sister…"
                />
              </Field>
              <div className="grid two">
                <Field label="Story setup">
                  <select aria-label="Story setup" value={storyShape} onChange={(event) => setStoryShape(event.target.value as AdventureStoryShape)}>
                    {storyShapeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="muted">{storyShapeOptions.find((option) => option.value === storyShape)?.description}</p>
                </Field>
                <Field label="Prose mode">
                  <select aria-label="Prose mode" value={proseMode} onChange={(event) => setProseMode(event.target.value as AdventureProseMode)}>
                    {proseModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="muted">{proseModeOptions.find((option) => option.value === proseMode)?.description}</p>
                </Field>
              </div>
              <div className="grid two">
                <Field label="Player control">
                  <select aria-label="Player control" value={playerControl} onChange={(event) => setPlayerControl(event.target.value as AdventurePlayerControlMode)}>
                    {playerControlOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="muted">{playerControlOptions.find((option) => option.value === playerControl)?.description}</p>
                </Field>
                <Field label="Adult content / NSFW">
                  <select aria-label="Adult content / NSFW" value={adultContent} onChange={(event) => setAdultContent(event.target.value as AdventureAdultContentMode)}>
                    {adultContentOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="muted">{adultContentOptions.find((option) => option.value === adultContent)?.description}</p>
                </Field>
              </div>
              {adultContent !== "off" && (
                <Field label="Boundaries / limits">
                  <textarea
                    rows={3}
                    value={adultBoundaries}
                    onChange={(event) => setAdultBoundaries(event.target.value)}
                    placeholder="Optional. Add boundaries, tone limits, relationship rules, fade preferences, or content to avoid."
                  />
                </Field>
              )}
              {genError && <p className="error-box">{genError}</p>}
              <div className="toolbar">
                <button
                  type="button"
                  className="primary-action"
                  disabled={genLoading || !premise.trim()}
                  onClick={() => void generateAdventure()}
                >
                  {genLoading ? "Generating…" : "Generate"}
                </button>
                {genLoading && <span className="status-pill">Thinking…</span>}
              </div>
            </details>
          )}

          <Field label="Adventure title">
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>

          <details className="setup-panel" open={!!thumbnailImage}>
            <summary>Thumbnail Image</summary>
            <AdventureThumbnailPicker
              thumbnail={thumbnailImage}
              title={title}
              onChange={setThumbnailImage}
            />
          </details>

          <details className="setup-panel" open={!!openingScene}>
            <summary>Opening Scene</summary>
            <p className="muted">
              Sets the initial story text before the first turn. Shown to you in the play view and included
              in the model context as the first assistant message.
            </p>
            <textarea
              rows={6}
              value={openingScene}
              onChange={(event) => setOpeningScene(event.target.value)}
              placeholder="The scene opens on… (optional — you can always start playing with a blank canvas)"
            />
          </details>

          <details className="setup-panel">
            <summary>Starter Components ({starterComponents.length})</summary>
            <p className="muted">
              Components become World Blocks. Keep Plot Essentials short and factual; use AI Instructions for
              persistent generation rules and Author's Note for tone.
            </p>
            <div className="toolbar">
              {!componentDrafts.some((d) => d.type === "aiInstructions") && (
                <button type="button" onClick={() => setComponentDrafts((drafts) => [...drafts, blankComponentDraft("aiInstructions")])}>
                  Add AI Instructions
                </button>
              )}
              {!componentDrafts.some((d) => d.type === "plotEssentials") && (
                <button type="button" onClick={() => setComponentDrafts((drafts) => [...drafts, blankComponentDraft("plotEssentials")])}>
                  Add Plot Essentials
                </button>
              )}
              {!componentDrafts.some((d) => d.type === "authorNote") && (
                <button type="button" onClick={() => setComponentDrafts((drafts) => [...drafts, blankComponentDraft("authorNote")])}>
                  Add Author's Note
                </button>
              )}
              <button type="button" onClick={() => setComponentDrafts((drafts) => [...drafts, blankComponentDraft("custom")])}>
                Add Custom Component
              </button>
            </div>
            {componentDrafts.length === 0 ? (
              <p className="muted">No starter components selected.</p>
            ) : (
              <div className="list">
                {componentDrafts.map((draft) => (
                  <article key={draft.id} className="card editor-card">
                    <div className="grid two">
                      <Field label="Type">
                        <select
                          value={draft.type}
                          onChange={(event) => updateComponentDraft(draft.id, { type: event.target.value as ComponentType })}
                        >
                          {componentTypes.map((type) => (
                            <option key={type} value={type}>
                              {COMPONENT_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Priority">
                        <NumberInput value={draft.priority} onChange={(priority) => updateComponentDraft(draft.id, { priority })} />
                      </Field>
                    </div>
                    <div style={{ position: "relative" }}>
                      <Field label="Content">
                        <textarea
                          rows={expandedIds[draft.id] ? 18 : 5}
                          value={draft.content}
                          onChange={(event) => updateComponentDraft(draft.id, { content: event.target.value })}
                        />
                      </Field>
                      <button type="button" style={{ position: "absolute", top: 0, right: 0, fontSize: "0.7rem", padding: "0.1rem 0.4rem" }} onClick={() => toggleExpand(draft.id)}>{expandedIds[draft.id] ? "Collapse" : "Expand"}</button>
                    </div>
                    <div className="grid four">
                      <CheckboxField
                        label="Always on"
                        checked={draft.alwaysOn}
                        onChange={(alwaysOn) => updateComponentDraft(draft.id, { alwaysOn })}
                      />
                      <CheckboxField
                        label="Pinned"
                        checked={draft.pinned}
                        onChange={(pinned) => updateComponentDraft(draft.id, { pinned })}
                      />
                      <CheckboxField
                        label="Protected"
                        checked={draft.protected}
                        onChange={(protectedValue) => updateComponentDraft(draft.id, { protected: protectedValue })}
                      />
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setComponentDrafts((drafts) => drafts.filter((item) => item.id !== draft.id))}
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </details>

          <details className="setup-panel" open>
            <summary>Starter Story Cards ({totalStoryCardCount})</summary>
            <p className="muted">
              Cards should be self-contained. Add names, aliases, and nicknames as triggers; unpinned cards need at
              least one trigger to enter context. Character cards work best with concrete voice examples.
            </p>

            <div className="grid two">
              <section className="setup-column">
                <div className="panel-heading">
                  <h3>Manual Story Cards</h3>
                  <button type="button" onClick={() => setManualStoryCardDrafts((drafts) => [...drafts, blankStoryCardDraft()])}>
                    Add Manual Card
                  </button>
                </div>
                {manualStoryCardDrafts.length === 0 ? (
                  <p className="muted">No manual Story Cards yet.</p>
                ) : (
                  <div className="list">
                    {manualStoryCardDrafts.map((draft) => (
                      <article key={draft.id} className="card editor-card">
                        <div className="grid two">
                          <Field label="Title">
                            <input value={draft.title} onChange={(event) => updateStoryCardDraft(draft.id, { title: event.target.value })} />
                          </Field>
                          <Field label="Type">
                            <select
                              value={draft.type}
                              onChange={(event) => updateStoryCardDraft(draft.id, { type: event.target.value as StoryCardType })}
                            >
                              {storyCardTypes.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <Field label="Memory Mode">
                          <select
                            value={draft.memoryMode}
                            onChange={(event) => updateStoryCardDraft(draft.id, { memoryMode: event.target.value as StoryCardMemoryMode })}
                          >
                            <option value="static">static - always-true reference facts</option>
                            <option value="living">living - current evolving subject, updates merge/archive</option>
                            <option value="historical">historical - completed past event or retired fact</option>
                          </select>
                        </Field>
                        <Field label="Triggers / keys">
                          <input
                            value={draft.keysText}
                            onChange={(event) => updateStoryCardDraft(draft.id, { keysText: event.target.value })}
                            placeholder="Margo, hedge prince, hidden oath"
                          />
                        </Field>
                        <div style={{ position: "relative" }}>
                          <Field label="Content">
                            <textarea
                              rows={expandedIds[draft.id] ? 18 : 5}
                              value={draft.content}
                              onChange={(event) => updateStoryCardDraft(draft.id, { content: event.target.value })}
                            />
                          </Field>
                          <button type="button" style={{ position: "absolute", top: 0, right: 0, fontSize: "0.7rem", padding: "0.1rem 0.4rem" }} onClick={() => toggleExpand(draft.id)}>{expandedIds[draft.id] ? "Collapse" : "Expand"}</button>
                        </div>
                        <div className="grid three">
                          <Field label="Priority">
                            <NumberInput value={draft.priority} onChange={(priority) => updateStoryCardDraft(draft.id, { priority })} />
                          </Field>
                          <CheckboxField
                            label="Pinned"
                            checked={draft.pinned}
                            onChange={(pinned) => updateStoryCardDraft(draft.id, { pinned })}
                          />
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setManualStoryCardDrafts((drafts) => drafts.filter((item) => item.id !== draft.id))}
                          >
                            Remove
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="setup-column">
                <div className="panel-heading">
                  <h3>Story Card JSON</h3>
                  <button type="button" onClick={() => parseStoryCardJson()}>
                    Parse JSON
                  </button>
                </div>
                <Field label="Upload .json file">
                  <input type="file" accept="application/json,.json" onChange={readStoryCardFile} />
                </Field>
                <Field label="Paste Story Card JSON">
                  <textarea
                    rows={10}
                    value={storyCardJsonText}
                    onChange={(event) => setStoryCardJsonText(event.target.value)}
                    placeholder='[{"title":"Margo","keys":"Margo, hedge prince","entry":"Margo calls Seth hedge prince."}]'
                  />
                </Field>
                {jsonImportError && <div className="error-box">{jsonImportError}</div>}
                {jsonImportMessages.map((message) => (
                  <p key={message} className="muted">
                    {message}
                  </p>
                ))}
                {jsonStoryCards.length > 0 && (
                  <div className="notice">
                    <strong>{jsonStoryCards.length} JSON Story Card(s) ready</strong>
                    <ul className="compact-list setup-preview-list">
                      {jsonStoryCards.slice(0, 8).map((card) => (
                        <li key={card.id}>
                          <strong>{card.title}</strong>
                          <span>{card.keys.join(", ") || "No triggers"}</span>
                        </li>
                      ))}
                    </ul>
                    {jsonStoryCards.length > 8 && <p className="muted">Showing first 8 imported cards.</p>}
                    <button type="button" onClick={() => setJsonStoryCards([])}>
                      Clear JSON Cards
                    </button>
                  </div>
                )}
              </section>
            </div>
          </details>
        </article>
      </section>
    );
  }

  if (view === "aistImport") {
    return (
      <section className="page">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <button type="button" onClick={() => setView("create")}>
                &lt;- Create Adventure
              </button>
              <p className="eyebrow">Import</p>
              <h3>Import from AIST</h3>
              <p className="muted">
                Load a full adventure JSON exported from AI Story Teller. API keys are not imported.
              </p>
            </div>
          </div>

          {aistImportStatus && <div className="import-export-status" role="status">{aistImportStatus}</div>}

          <div className="import-file-picker">
            <Field label="AIST adventure JSON">
              <input type="file" accept=".json,application/json" onChange={readAistAdventureFile} />
            </Field>
            {aistImportFilename && <span className="status-pill">Loaded {aistImportFilename}</span>}
          </div>

          <Field label="Paste AIST adventure JSON">
            <textarea
              rows={8}
              value={aistImportText}
              onChange={(event) => {
                setAistImportFilename("");
                previewAistAdventure(event.target.value);
              }}
              placeholder="Paste a full AI Story Teller adventure JSON here."
            />
          </Field>

          {aistImportError && <div className="error-box">{aistImportError}</div>}

          <div className={`import-export-preview import-export-restore-preview import-export-preview-${aistImportPreview ? "ready" : aistImportError ? "error" : "empty"}`}>
            {!aistImportPreview && !aistImportError && (
              <p className="muted">Choose an exported AIST adventure JSON file to preview what will open.</p>
            )}
            {aistImportPreview && (
              <>
                <div>
                  <span className="muted">Ready to import</span>
                  <strong>{aistImportPreview.title}</strong>
                  <small>Last saved {new Date(aistImportPreview.updatedAt).toLocaleString()}</small>
                </div>
                <dl>
                  <div><dt>Turn</dt><dd>{aistImportPreview.activeState.turn}</dd></div>
                  <div><dt>Messages</dt><dd>{aistImportPreview.messages.length}</dd></div>
                  <div><dt>Story Cards</dt><dd>{aistImportPreview.storyCards.length}</dd></div>
                  <div><dt>Brains</dt><dd>{aistImportPreview.brains.length}</dd></div>
                  <div><dt>Plot Blocks</dt><dd>{aistImportPreview.components.length}</dd></div>
                </dl>
              </>
            )}
          </div>

          <div className="toolbar">
            <button
              type="button"
              className="primary-action"
              disabled={!aistImportPreview || !onCreateAdventureFromImport}
              onClick={createAdventureFromAist}
            >
              Import and open
            </button>
            <button type="button" onClick={() => setView("create")}>
              Back
            </button>
          </div>
        </article>
      </section>
    );
  }

  if (view === "github") {
    return (
      <section className="page">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <button type="button" onClick={() => { setView("list"); onDismissError?.(); }}>← Library</button>
              <p className="eyebrow">GitHub Save Slots</p>
              <h3>Load a saved adventure</h3>
            </div>
            <div className="toolbar">
              <button type="button" disabled={!!loadingSlotId} onClick={() => onListSaves?.()}>Refresh</button>
              {loadingSlotId
                ? <span className="status-pill">Loading save…</span>
                : savesStatus && <span className="status-pill">{savesStatus}</span>
              }
            </div>
          </div>

          {loadError && (
            <div className="error-box error-dismissible" style={{ marginBottom: "0.75rem" }}>
              <span>{loadError}</span>
              <button type="button" className="error-dismiss" aria-label="Dismiss error" onClick={onDismissError}>×</button>
            </div>
          )}

          {(!saveSlots || saveSlots.length === 0) ? (
            <p className="muted">{savesStatus?.startsWith("Loading") ? "Loading…" : "No saves found."}</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Adventure</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Type</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Turn</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Saved (UTC)</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}></th>
                </tr>
              </thead>
              <tbody>
                {saveSlots.map((slot) => {
                  const isLoading = loadingSlotId === slot.saveId;
                  return (
                    <tr key={slot.saveId} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{slot.title}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{slot.saveType}</td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{slot.turnCount}</td>
                      <td style={{ padding: "0.35rem 0.5rem", fontFamily: "monospace" }}>{formatUtc(slot.savedAt)}</td>
                      <td style={{ padding: "0.35rem 0.5rem", display: "flex", gap: "0.35rem" }}>
                        <button
                          type="button"
                          disabled={isLoading || !!loadingSlotId}
                          onClick={() => onLoadSave?.(slot)}
                        >
                          {isLoading ? "Loading…" : "Load"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!!loadingSlotId}
                          onClick={() => { if (window.confirm(`Delete save "${slot.title}" (${slot.saveType}, turn ${slot.turnCount})?`)) onDeleteSave?.(slot); }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </article>
      </section>
    );
  }

  if (view === "premade") {
    return (
      <section className="page library-page">
        <header className="library-header">
          <div>
            <button type="button" onClick={() => setView("list")}>
              ← Library
            </button>
            <p className="eyebrow">Premade Library</p>
            <h2>Load a premade adventure</h2>
            <p className="muted">Bundled playtest seeds with components, story cards, opening scene, and tuned setup.</p>
          </div>
        </header>
        <div className="library-grid">
          {premadeAdventures.map((premade) => (
            <article key={premade.id} className="library-card">
              <div className="library-card-body">
                <div>
                  <p className="eyebrow">{premade.eyebrow}</p>
                  <h3>{premade.title}</h3>
                  <p className="muted">{premade.summary}</p>
                  <div className="toolbar" style={{ marginTop: "0.5rem" }}>
                    {premade.tags.map((tag) => (
                      <span key={tag} className="status-pill">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="library-card-actions">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={!onLoadPremadeAdventure}
                    onClick={() => void onLoadPremadeAdventure?.(premade.id)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadText(`${premade.id}-adventure.json`, premade.createAdventureJson())}
                  >
                    Download Adventure
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadText(`${premade.id}-story-cards.json`, premade.createStoryCardsJson())}
                  >
                    Download Cards
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="page library-page">
      <header className="library-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Choose an adventure</h2>
          <p className="muted">Continue a saved story, duplicate a setup, or start a new world.</p>
        </div>
        <div className="toolbar">
          {premadeAdventures.length > 0 && (
            <button type="button" onClick={() => setView("premade")}>
              Premade Library
            </button>
          )}
          {onListSaves && (
            <button type="button" onClick={() => setView("github")}>
              Load from GitHub
            </button>
          )}
          <button type="button" className="primary-action" onClick={() => setView("create")}>
            New Adventure
          </button>
        </div>
      </header>
      <div className="library-grid">
        {adventures.length === 0 && <p className="muted">No adventures saved yet.</p>}
        {adventures.map((adventure) => (
          <article key={adventure.id} className="library-card">
            <AdventureThumbnailFrame
              thumbnail={adventure.thumbnailImage}
              title={adventure.title}
              className="library-card-cover"
            />
            <div className="library-card-body">
            <div>
              <h3>{adventure.title}</h3>
              <p className="muted">
                {formatCount(adventure.turnCount, "turn")} ·{" "}
                {formatCount(adventure.storyEntryCount, "story entry", "story entries")} · Updated{" "}
                {new Date(adventure.updatedAt).toLocaleString()} · Created{" "}
                {new Date(adventure.createdAt).toLocaleString()}
              </p>
              {currentAdventure?.id === adventure.id && <p className="status-pill">Open</p>}
            </div>
            <div className="library-card-actions">
              <button type="button" className="primary-action" onClick={() => onOpen(adventure.id)}>
                Select
              </button>
              {onOpenEdit && (
                <button type="button" onClick={() => onOpenEdit(adventure.id)}>
                  Edit
                </button>
              )}
              <button type="button" onClick={() => onDuplicate(adventure.id)}>
                Duplicate
              </button>
              <button type="button" className="danger" onClick={() => onDelete(adventure.id)}>
                Delete
              </button>
            </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
