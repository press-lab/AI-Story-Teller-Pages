import { PRIMARY_STORY_CARD_TYPES } from "../memory/storyCardArchitecture";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Adventure, MemoryDraftRequest, ProviderConfig, StoryCard, StoryCardAIBuilderIntent } from "../types/adventure";
import { DRAFT_COMPONENT_TYPES, draftPreview, SINGLETON_DRAFT_TYPES } from "../memory/memoryDraft";
import { MAX_CHAINED_STORY_CARDS_PER_BUILD } from "../contextBuilder/chainedStoryCardTriggers";
import { CheckboxField, Field, NumberInput } from "./shared";

const cardTypes = PRIMARY_STORY_CARD_TYPES;
const purposes: Array<[StoryCardAIBuilderIntent, string]> = [["auto", "Let AI choose"], ["relationship", "Relationship / dynamic"],
  ["character", "Character / voice"], ["subplot", "Ongoing subplot / status"], ["secret", "Secret / reveal"],
  ["rule", "Rule / lore"], ["location", "Location"], ["faction", "Faction"], ["object", "Object"], ["event", "Completed event"]];

function CardPicker({ cards, selected, onChange, single = false, onClose }: {
  cards: StoryCard[]; selected: string[]; onChange: (ids: string[]) => void; single?: boolean; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const results = useMemo(() => cards.filter(c => (type === "all" || c.type === type) && (!selectedOnly || selected.includes(c.id))
    && `${c.title} ${c.keys.join(" ")} ${c.content}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title)), [cards, selected, search, type, selectedOnly]);
  const lastPage = Math.max(0, Math.ceil(results.length / 40) - 1);
  const currentPage = Math.min(page, lastPage);
  return <dialog ref={dialogRef} onCancel={onClose} aria-label={single ? "Choose destination card" : "Choose reference cards"} className="panel memory-card-picker">
    <div className="toolbar"><h3>{single ? "Choose destination card" : "Choose reference cards"}</h3><button autoFocus type="button" onClick={onClose}>Done</button></div>
    <Field label="Search cards"><input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></Field>
    <Field label="Filter card type"><select value={type} onChange={e => { setType(e.target.value); setPage(0); }}><option value="all">All types</option>{cardTypes.map(t => <option key={t}>{t}</option>)}</select></Field>
    <CheckboxField label="Show selected only" checked={selectedOnly} onChange={v => { setSelectedOnly(v); setPage(0); }} />
    <p>{selected.length} selected · {results.length} matching</p>
    {!single && <div className="toolbar"><button type="button" onClick={() => onChange([...new Set([...selected, ...results.map(c => c.id)])])}>Select all {results.length} results</button><button type="button" onClick={() => onChange([])}>Clear selection</button></div>}
    <div className="memory-picker-results">{results.slice(currentPage * 40, currentPage * 40 + 40).map(card => <label key={card.id} className="memory-picker-row">
      <input type={single ? "radio" : "checkbox"} name={single ? "destination-card" : undefined} checked={selected.includes(card.id)} onChange={() => onChange(single ? [card.id] : selected.includes(card.id) ? selected.filter(id => id !== card.id) : [...selected, card.id])} />
      <span>{card.title}<small>{card.type}{card.active ? "" : " · inactive"}</small></span>
    </label>)}</div>
    <div className="toolbar"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next page</button></div>
    <button type="button" onClick={onClose}>Done selecting</button>
  </dialog>;
}

export function MemorySuggestionBuilder({ adventure, providerConfig, loading, onCreate }: {
  adventure: Adventure; providerConfig?: ProviderConfig; loading?: boolean; onCreate: (request: MemoryDraftRequest) => Promise<boolean>;
}) {
  const [request, setRequest] = useState<MemoryDraftRequest>({ action: "draft", destination: "component", componentType: "custom", storyCardType: "character",
    intent: "auto", description: "", inclusionPolicy: "always", context: { components: "all", componentIds: [], storyCardIds: [], recentEntryCount: 20 } });
  const [picker, setPicker] = useState<"references" | "target">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  function patch(update: Partial<MemoryDraftRequest>) {
    setRequest(r => {
      const next = { ...r, ...update };
      if (next.destination === "component" && SINGLETON_DRAFT_TYPES.has(next.componentType) && !next.targetId)
        next.targetId = adventure.components.find(c => c.type === next.componentType)?.id;
      if (next.destination === "component" && next.targetId !== r.targetId && next.targetId) {
        const target = adventure.components.find(c => c.id === next.targetId);
        if (target) next.inclusionPolicy = target.inclusionPolicy;
      }
      if (next.action !== "suggest" || next.destination !== "storyCard") next.reviewSelectedCards = false;
      if (next.reviewSelectedCards) next.targetId = undefined;
      return next;
    });
    setStatus(""); setError("");
  }
  const contextPatch = (update: Partial<MemoryDraftRequest["context"]>) => patch({ context: { ...request.context, ...update } });
  const targets = adventure.components.filter(c => c.type === request.componentType);
  const preview = useMemo(() => {
    try { return { value: draftPreview(adventure, request, providerConfig) }; }
    catch (e) { return { error: e instanceof Error ? e.message : "Unable to prepare context." }; }
  }, [adventure, request, providerConfig]);
  const targetCard = adventure.storyCards.find(c => c.id === request.targetId);
  async function create() {
    setBusy(true); setError(""); setStatus("");
    try { const created = await onCreate(request); setStatus(created ? "Draft added below. Review and approve each suggestion to save the memory." : "No supported update found in the selected context."); }
    catch (e) { setError(e instanceof Error ? e.message : "Draft generation failed."); }
    finally { setBusy(false); }
  }
  return <details className="panel memory-suggestion-builder"><summary>Create suggestion with AI</summary>
    <fieldset disabled={loading || busy}>
    <div className="grid two">
      <Field label="Action"><select value={request.action} onChange={e => patch({ action: e.target.value as MemoryDraftRequest["action"], targetId: undefined,
        componentType: e.target.value === "suggest" ? "plotEssentials" : request.componentType,
        ...(e.target.value === "suggest" && request.destination === "component" ? { targetId: adventure.components.find(c => c.type === "plotEssentials")?.id } : {}) })}><option value="draft">Draft from my instructions</option><option value="suggest">Suggest updates from recent play</option></select></Field>
      <Field label="Destination"><select value={request.destination} onChange={e => patch({ destination: e.target.value as MemoryDraftRequest["destination"],
        targetId: e.target.value === "component" && SINGLETON_DRAFT_TYPES.has(request.componentType) ? adventure.components.find(c => c.type === request.componentType)?.id : undefined })}><option value="component">Plot component</option><option value="storyCard">Story Card</option></select></Field>
      {request.destination === "component" ? <>
        <Field label="Component type"><select value={request.componentType} onChange={e => {
          const componentType = e.target.value as MemoryDraftRequest["componentType"];
          patch({ componentType, targetId: SINGLETON_DRAFT_TYPES.has(componentType) ? adventure.components.find(c => c.type === componentType)?.id : undefined });
        }}>{Object.entries(DRAFT_COMPONENT_TYPES).filter(([type]) => request.action !== "suggest" || type === "plotEssentials").map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></Field>
        <Field label="Component target"><select value={request.targetId ?? ""} onChange={e => patch({ targetId: e.target.value || undefined })}>
          <option value="" disabled={SINGLETON_DRAFT_TYPES.has(request.componentType) && targets.length > 0}>Create new component</option>
          {targets.map(c => <option key={c.id} value={c.id}>Update: {c.title}</option>)}
        </select></Field>
        <Field label="Component inclusion"><select value={request.inclusionPolicy} onChange={e => patch({ inclusionPolicy: e.target.value as MemoryDraftRequest["inclusionPolicy"] })}>
          <option value="always">Always</option><option value="triggered">Triggered</option><option value="manual">Manual</option><option value="systemSuggested">System suggested</option>
        </select></Field>
      </> : <>
        <Field label="Story Card type"><select value={request.storyCardType} onChange={e => patch({ storyCardType: e.target.value as MemoryDraftRequest["storyCardType"], targetId: undefined })}>{cardTypes.map(type => <option key={type}>{type}</option>)}</select></Field>
        <Field label="Writing purpose"><select value={request.intent} onChange={e => patch({ intent: e.target.value as StoryCardAIBuilderIntent })}>{purposes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {request.action === "suggest" && <Field label="Update scope"><select value={request.reviewSelectedCards ? "selected" : "single"} onChange={e => patch({ reviewSelectedCards: e.target.value === "selected" })}><option value="single">One destination</option><option value="selected">Relevant selected cards of this type</option></select></Field>}
        {!request.reviewSelectedCards && <div><p>Target: {request.targetId ? targetCard?.title ?? "Missing card" : "Create new Story Card"}</p><div className="toolbar"><button type="button" onClick={() => setPicker("target")}>Choose existing card</button>{request.targetId && <button type="button" onClick={() => patch({ targetId: undefined })}>Create new instead</button>}</div></div>}
      </>}
    </div>
    <Field label="Your instructions"><textarea rows={4} value={request.description} onChange={e => patch({ description: e.target.value })} placeholder="Describe the character, component, or change you want. For a subplot, explain the situation and what can develop." /></Field>
    <details className="editor-tools-panel"><summary>Context to send · {request.context.storyCardIds.length} selected cards · {preview.value?.triggeredCards.length ?? 0} triggered cards · {request.context.recentEntryCount} previous entries</summary>
      <Field label="Reference components"><select value={request.context.components} onChange={e => contextPatch({ components: e.target.value as MemoryDraftRequest["context"]["components"] })}><option value="none">None</option><option value="all">All components</option><option value="selected">Selected components</option></select></Field>
      {request.context.components === "selected" && adventure.components.filter(c => c.type in DRAFT_COMPONENT_TYPES).map(c => <CheckboxField key={c.id} label={c.title} checked={request.context.componentIds.includes(c.id)} onChange={v => contextPatch({ componentIds: v ? [...request.context.componentIds, c.id] : request.context.componentIds.filter(id => id !== c.id) })} />)}
      <button type="button" onClick={() => setPicker("references")}>Choose reference cards ({request.context.storyCardIds.length} selected)</button>
      <Field label="Previous entries"><NumberInput min={0} max={adventure.messages.length} value={request.context.recentEntryCount} onChange={value => contextPatch({ recentEntryCount: Math.max(0, Math.round(value)) })} /></Field>
      <p className="muted">Entries are saved messages, not exchanges. Full selected content is sent. {request.reviewSelectedCards ? "You explicitly chose to review selected cards of this type as update targets. Other references only inform the drafts." : "References inform this draft; they are not update targets."}</p>
      <p className="muted">Like Play, one-hop matching adds up to {MAX_CHAINED_STORY_CARDS_PER_BUILD} active, non-manual cards referenced by the selected components, cards, destination, instructions, or previous entries. Added cards do not trigger another round.</p>
      {preview.value && <div aria-label="Draft context manifest">
        <p>Components: {preview.value.components.map(c => c.title).join(", ") || "None"}</p>
        <p>Selected Story Cards: {preview.value.cards.map(c => c.title).join(", ") || "None"}</p>
        <p>One-hop triggered Story Cards: {preview.value.triggeredCards.length === 0 ? "None" : ""}</p>
        {preview.value.triggeredCards.length > 0 && <ul>{preview.value.triggeredCards.map(({ card, match }) => <li key={card.id}>
          {match.sourceTitle} → {card.title} · matched “{match.matchedTriggerPhrase}” · full content included
        </li>)}</ul>}
        <p>Previous entries: {preview.value.entries.length} available of {request.context.recentEntryCount} requested.</p>
        <p>Destination: {request.reviewSelectedCards ? `Selected ${request.storyCardType} cards` : preview.value.target?.title ?? "Create new"} · full saved content included when updating.</p>
        <details><summary>Full request sent to AI</summary>{preview.value.messages.map((message, index) => <section key={index}>
          <h4>{message.role}</h4><pre className="memory-draft-payload">{message.content}</pre>
        </section>)}</details>
      </div>}
    </details>
    {preview.value && <p>Input: {preview.value.estimatedCharacters.toLocaleString()} characters · estimated {preview.value.estimatedTokens.toLocaleString()} tokens · allowance: {preview.value.availableTokens.toLocaleString()} tokens{request.destination === "storyCard" ? " (advisory)" : ""}.</p>}
    {preview.value?.overAllowance && <p role="status">Above the displayed allowance. Card suggestions can still be sent in full; this tool will not shorten or block them. The model provider’s own limits still apply.</p>}
    {preview.error && <p role="alert">{preview.error}</p>}
    {request.destination === "component" && <p className="muted">Always means available in context, subject to the existing budget rules. It does not require a mention every response.</p>}
    <button type="button" className="primary-action" disabled={Boolean(preview.error) || request.action === "draft" && !request.description.trim()} onClick={() => void create()}>{busy ? "Creating…" : "Create suggestion"}</button>
    <p className="muted">This tool creates a pending draft. Your approval settings do not apply it automatically.</p>
    </fieldset>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {picker && <CardPicker cards={picker === "target" ? adventure.storyCards.filter(c => c.type === request.storyCardType) : adventure.storyCards}
      selected={picker === "target" ? request.targetId ? [request.targetId] : [] : request.context.storyCardIds} single={picker === "target"}
      onChange={ids => picker === "target" ? patch({ targetId: ids[0] }) : contextPatch({ storyCardIds: ids })} onClose={() => setPicker(undefined)} />}
  </details>;
}
