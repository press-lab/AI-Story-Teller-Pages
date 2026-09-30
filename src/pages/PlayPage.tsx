import { useEffect, useRef, useState } from "react";
import type { InputMode, Message } from "../types/adventure";
import type { PlayRuntimeProps } from "./pageTypes";
import { CheckboxField, Field, NumberInput } from "./shared";

function StoryParagraphs({ content, trailing }: { content: string; trailing?: React.ReactNode }) {
  const paras = content.split(/\n\n+/);
  if (paras.length === 1) return <p>{content}{trailing}</p>;
  return (
    <>
      {paras.map((para, i) => (
        <p key={i}>{para}{i === paras.length - 1 && trailing}</p>
      ))}
    </>
  );
}

const MODES: InputMode[] = ["do", "story", "comms"];

const MODE_LABELS: Record<InputMode, string> = {
  do: "Do",
  story: "Story",
  comms: "Author",
};

const MODE_TOOLTIPS: Record<InputMode, string> = {
  do: "Do — describe your character's action. Type in first or second person, the AI narrates in second person.",
  story: "Story — directly add or guide the next story beat, as the narrator.",
  comms: "Author — out-of-character message to the AI. Use for questions or instructions about the story.",
};

const MODE_PLACEHOLDERS: Record<InputMode, string> = {
  do: "What does your character do?",
  story: "Guide the next story beat...",
  comms: "Ask the AI a question or give it direction (out of character)...",
};

const PLAY_TOOLKIT_COMPACT_WIDTH = 160;
const PLAY_TOOLKIT_MIN_WIDTH = 120;
const PLAY_TOOLKIT_PANEL_MIN_WIDTH = 420;
const PLAY_TOOLKIT_MAX_WIDTH = 600;
const MOBILE_COMPOSER_QUERY = "(max-width: 640px), (hover: none) and (pointer: coarse)";

function transformInput(text: string, mode: InputMode): string {
  if (mode === "do" && !/^(you |i |i'|she |he |they |we )/i.test(text)) {
    return "You " + text.charAt(0).toLowerCase() + text.slice(1);
  }
  if (mode === "comms") return `[Out of Character: ${text}]`;
  return text;
}

function messageRows(message: Message): number {
  return Math.max(3, Math.min(12, message.content.split(/\n/).length + 2));
}

function isMobileComposerKeyboard(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function" && window.matchMedia(MOBILE_COMPOSER_QUERY).matches) return true;
  return window.innerWidth <= 640;
}

function usageTooltip(usage: NonNullable<Message["usage"]>): string {
  const total = usage.totalTokens || usage.promptTokens + usage.completionTokens;
  return [
    `Prompt: ${usage.promptTokens}`,
    `Completion: ${usage.completionTokens}`,
    `Total: ${total}`,
    usage.cacheReadTokens !== undefined ? `Cache read: ${usage.cacheReadTokens}` : undefined,
    usage.cacheCreationTokens !== undefined ? `Cache write: ${usage.cacheCreationTokens}` : undefined,
  ].filter(Boolean).join(" | ");
}

function usageInlineText(usage: NonNullable<Message["usage"]>): string {
  return [
    `in ${usage.promptTokens}`,
    `out ${usage.completionTokens}`,
    usage.cacheReadTokens ? `cache ${usage.cacheReadTokens}` : undefined,
    usage.cacheCreationTokens ? `write ${usage.cacheCreationTokens}` : undefined,
  ].filter(Boolean).join(" ");
}

export function PlayPage({
  adventure,
  dispatch,
  contextResult,
  loading,
  error,
  saveStatus,
  onSubmitTurn,
  onContinue,
  onRegenerate,
  onBuildContext,
  onOpenContext,
  onRememberThis,
  onOpenTab,
  onOpenPlayTool,
  onPullLatest,
  playPanelContent,
  playPanelTitle,
  onClosePlayPanel,
  onDismissError,
  providerPresets,
  activePresetId,
  onSelectPreset,
  uiPreferences,
  onUiPreferencesChange,
}: PlayRuntimeProps) {
  const draftKey = `play-input-draft-${adventure.id}`;
  const [input, setInput] = useState(() => { try { return localStorage.getItem(draftKey) ?? ""; } catch { return ""; } });
  function updateInput(value: string) {
    setInput(value);
    try { if (value) { localStorage.setItem(draftKey, value); } else { localStorage.removeItem(draftKey); } } catch { /* ignore */ }
  }
  const [inputMode, setInputMode] = useState<InputMode>("do");
  const [rememberInput, setRememberInput] = useState("");
  const [showRemember, setShowRemember] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | undefined>();
  const [editingOpeningScene, setEditingOpeningScene] = useState(false);
  const [toolkitWidth, setToolkitWidth] = useState(() => {
    try {
      const stored = localStorage.getItem("play-toolkit-width");
      return stored ? parseInt(stored, 10) : PLAY_TOOLKIT_COMPACT_WIDTH;
    } catch {
      return PLAY_TOOLKIT_COMPACT_WIDTH;
    }
  });

  const [composerHeight, setComposerHeight] = useState(() => {
    try {
      const stored = localStorage.getItem("play-composer-height");
      return stored ? parseInt(stored, 10) : 180;
    } catch {
      return 180;
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editingArticleRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setShowScrollBottom(!entry.isIntersecting), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const lastAssistant = [...adventure.messages].reverse().find((m) => m.role === "assistant");
  const latestMessageId = adventure.messages.at(-1)?.id;
  const nextTurnNote = adventure.activeState.nextTurnNote;
  const pendingMemoryCount = adventure.activeState.memoryProposals.filter((p) => p.status === "pending").length;

  const budgetDropped = contextResult?.excludedItems.filter((i) => i.reason === "budget_exceeded") ?? [];
  const droppedMessages = budgetDropped.filter((i) => i.sourceType === "message").length;
  const droppedCards = budgetDropped.filter((i) => i.sourceType === "storyCard").length;
  const totalDropped = budgetDropped.length;
  const trimTooltip = [
    droppedMessages > 0 && `${droppedMessages} story turn${droppedMessages !== 1 ? "s" : ""} dropped`,
    droppedCards > 0 && `${droppedCards} story card${droppedCards !== 1 ? "s" : ""} dropped`,
  ].filter(Boolean).join(" · ");

  function updateToolkitWidth(next: number) {
    setToolkitWidth(next);
    try { localStorage.setItem("play-toolkit-width", String(next)); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!playPanelContent || toolkitWidth >= PLAY_TOOLKIT_PANEL_MIN_WIDTH) return;
    updateToolkitWidth(PLAY_TOOLKIT_PANEL_MIN_WIDTH);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playPanelContent, toolkitWidth]);

  function startToolkitResize(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = toolkitWidth;
    const minWidth = playPanelContent ? PLAY_TOOLKIT_PANEL_MIN_WIDTH : PLAY_TOOLKIT_MIN_WIDTH;
    const el = e.currentTarget;
    el.onpointermove = (ev: PointerEvent) => {
      const next = Math.round(Math.max(minWidth, Math.min(PLAY_TOOLKIT_MAX_WIDTH, startWidth + startX - ev.clientX)));
      updateToolkitWidth(next);
    };
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; };
  }

  function startComposerResize(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = composerHeight;
    const el = e.currentTarget;
    el.onpointermove = (ev: PointerEvent) => {
      const next = Math.round(Math.max(100, Math.min(500, startHeight + startY - ev.clientY)));
      setComposerHeight(next);
      try { localStorage.setItem("play-composer-height", String(next)); } catch { /* ignore */ }
    };
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; };
  }

  function updateStoryLayout(patch: Partial<NonNullable<typeof uiPreferences>>) {
    if (!uiPreferences || !onUiPreferencesChange) return;
    onUiPreferencesChange({ ...uiPreferences, ...patch });
  }

  function startStoryWidthResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!uiPreferences || !onUiPreferencesChange) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = uiPreferences.storyContentWidth;
    const el = e.currentTarget;
    el.onpointermove = (ev: PointerEvent) => {
      const next = Math.round(Math.max(520, Math.min(1800, startWidth + startX - ev.clientX)));
      onUiPreferencesChange({ ...uiPreferences, storyContentWidth: next });
    };
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null; };
  }

  function openTool(tabId: string) {
    if (onOpenPlayTool) {
      onOpenPlayTool(tabId);
    } else {
      onOpenTab?.(tabId);
    }
  }

  useEffect(() => {
    const target = latestMessageRef.current ?? bottomRef.current;
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [latestMessageId]);

  useEffect(() => {
    if (composerOpen) textareaRef.current?.focus();
  }, [composerOpen]);

  useEffect(() => {
    if (!composerOpen) return;
    transcriptRef.current?.scrollBy({ top: composerHeight, behavior: "smooth" });
  // composerHeight intentionally omitted: only compensate when composer first opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen]);

  useEffect(() => {
    if (!editingMessageId) return;
    let startX = 0, startY = 0;
    function handlePointerDown(e: PointerEvent) { startX = e.clientX; startY = e.clientY; }
    function handlePointerUp(e: PointerEvent) {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) return;
      if (editingArticleRef.current && !editingArticleRef.current.contains(e.target as Node)) {
        setEditingMessageId(undefined);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [editingMessageId]);

  function cycleMode(dir: 1 | -1) {
    const idx = MODES.indexOf(inputMode);
    setInputMode(MODES[(idx + dir + MODES.length) % MODES.length]);
  }

  async function submit() {
    const text = input.trim();
    if (!text || loading) return;
    updateInput("");
    setComposerOpen(false);
    setInputMode("do");
    await onSubmitTurn(transformInput(text, inputMode), inputMode);
  }

  async function remember() {
    const text = rememberInput.trim();
    if (!text || loading) return;
    setRememberInput("");
    setShowRemember(false);
    await onRememberThis(text);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (isMobileComposerKeyboard()) return;
      event.preventDefault();
      void submit();
    }
  }

  function handleRememberKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void remember();
    if (event.key === "Escape") setShowRemember(false);
  }

  const toolButtons = (
    <>
      <button type="button" onClick={() => openTool("components")}>Plot</button>
      <button type="button" onClick={() => openTool("storyCards")}>Cards</button>
      <button type="button" onClick={() => openTool("brains")}>Characters</button>
      <button type="button" onClick={() => openTool("memoryInbox")}>
        Memory
        {pendingMemoryCount > 0 && <span className="nav-badge">{pendingMemoryCount > 99 ? "99+" : pendingMemoryCount}</span>}
      </button>
      <button
        type="button"
        onClick={() => { onBuildContext(); openTool("context"); }}
      >
        Context
      </button>
      <button type="button" onClick={() => onOpenTab?.("edit")}>Edit All</button>
    </>
  );

  return (
    <section className="page play-layout">
      {error && (
        <div className="error-box error-dismissible">
          <span>{error}</span>
          {onDismissError && (
            <button type="button" className="error-dismiss" aria-label="Dismiss error" onClick={onDismissError}>
              ×
            </button>
          )}
        </div>
      )}

      <div className="play-main">
        <div className="transcript-area">
        <div ref={transcriptRef} className="transcript" onClick={() => setComposerOpen(false)}>
          <div className="story-text-frame">
          {uiPreferences && onUiPreferencesChange && (
            <div
              className="story-width-handle"
              onPointerDown={startStoryWidthResize}
              title="Drag to resize story text width"
              role="separator"
              aria-orientation="vertical"
            />
          )}
          {adventure.openingScene && (
            <article className={`message assistant opening-scene-message${editingOpeningScene ? " editing" : ""}`}>
              <div className="message-actions">
                <button type="button" onClick={() => setEditingOpeningScene(!editingOpeningScene)}>
                  {editingOpeningScene ? "Done" : "Edit"}
                </button>
              </div>
              {editingOpeningScene ? (
                <textarea
                  className="message-editor"
                  rows={8}
                  value={adventure.openingScene}
                  onChange={(e) => dispatch({ type: "SET_OPENING_SCENE", content: e.target.value })}
                />
              ) : (
                <StoryParagraphs content={adventure.openingScene} />
              )}
            </article>
          )}
          {!adventure.openingScene && adventure.messages.length === 0 && (
            <p className="muted">No turns yet. Set up your world, then start playing below.</p>
          )}
          {adventure.messages.map((message) => (
            <article
              key={message.id}
              ref={(el) => {
                if (editingMessageId === message.id) editingArticleRef.current = el;
                if (message.id === latestMessageId) latestMessageRef.current = el;
              }}
              className={`message ${message.role}${message.inputMode === "comms" ? " comms" : ""}${message.inputMode === "do" ? " mode-do" : ""}${editingMessageId === message.id ? " editing" : ""}`}
            >
              <div className="message-actions">
                <button
                  type="button"
                  onClick={() => setEditingMessageId(editingMessageId === message.id ? undefined : message.id)}
                >
                  {editingMessageId === message.id ? "Done" : "Edit"}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => dispatch({ type: "DELETE_MESSAGE", messageId: message.id })}
                >
                  Delete
                </button>
              </div>
              {editingMessageId === message.id ? (
                <textarea
                  className="message-editor"
                  rows={messageRows(message)}
                  value={message.content}
                  onChange={(event) =>
                    dispatch({ type: "UPDATE_MESSAGE", messageId: message.id, content: event.target.value })
                  }
                />
              ) : (
                <div onDoubleClick={() => setEditingMessageId(message.id)}>
                  <StoryParagraphs
                    content={message.content}
                    trailing={message.role === "assistant" && message.id === lastAssistant?.id && totalDropped > 0 && (
                      <button
                        type="button"
                        className="context-drop-warning"
                        title={trimTooltip || "Context was trimmed to fit token budget"}
                        onClick={(e) => { e.stopPropagation(); onBuildContext(); onOpenContext(); }}
                      >
                        ⚠️
                      </button>
                    )}
                  />
                  {message.role === "assistant" && (message.usage || (message.id === lastAssistant?.id && pendingMemoryCount > 0)) && (
                    <span className="message-usage muted">
                      {message.usage && (
                        <span title={usageTooltip(message.usage)}>
                          {usageInlineText(message.usage)}
                        </span>
                      )}
                      {message.id === lastAssistant?.id && adventure.activeState.backgroundTokenUsage.promptTokens > 0 && (
                        <span title={`Background (cumulative): ${adventure.activeState.backgroundTokenUsage.promptTokens} prompt + ${adventure.activeState.backgroundTokenUsage.completionTokens} completion`}>
                          {" · "}bg ↑{adventure.activeState.backgroundTokenUsage.promptTokens} ↓{adventure.activeState.backgroundTokenUsage.completionTokens}
                        </span>
                      )}
                      {message.id === lastAssistant?.id && pendingMemoryCount > 0 && (
                        <button
                          type="button"
                          className="context-drop-warning"
                          title="Open memory inbox"
                          onClick={(e) => { e.stopPropagation(); openTool("memoryInbox"); }}
                        >
                          {" · "}{pendingMemoryCount} suggestion{pendingMemoryCount !== 1 ? "s" : ""}
                        </button>
                      )}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
          </div>
          <div ref={bottomRef} />
        </div>
        {showScrollBottom && (
          <button
            type="button"
            className="scroll-to-bottom-btn"
            onClick={() => transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" })}
            aria-label="Scroll to bottom"
          >
            ↓
          </button>
        )}
        {loading && (
          <div className="transcript-typing-indicator" aria-label="Generating…">
            <span /><span /><span />
          </div>
        )}
        </div>

        {/* Compact tool strip — visible on tablet/mobile, hidden on desktop */}
        <nav className="play-tool-row" aria-label="Adventure tools">
          {toolButtons}
        </nav>

        {composerOpen && (
          <div
            className="composer-resize-handle"
            onPointerDown={startComposerResize}
            title="Drag to resize"
            role="separator"
            aria-orientation="horizontal"
          />
        )}
        <div className={`composer panel${composerOpen ? "" : " composer-input-closed"}`} style={composerOpen ? { height: composerHeight } : {}}>
          <div className="mode-selector">
            {(["do", "story", "comms"] as InputMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                title={MODE_TOOLTIPS[mode]}
                className={`mode-btn mode-btn-full${inputMode === mode ? " active" : ""}`}
                onClick={() => setInputMode(mode)}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
            <label className="length-slider-label">
              <span className="muted length-label-text">{adventure.activeState.responseLengthHint ?? 250}w</span>
              <input
                type="range"
                className="length-slider"
                min={50}
                max={500}
                step={25}
                value={adventure.activeState.responseLengthHint ?? 250}
                onChange={(event) => dispatch({ type: "SET_RESPONSE_LENGTH_HINT", hint: Number(event.target.value) })}
                title={`Response length: ~${adventure.activeState.responseLengthHint ?? 250} words`}
              />
            </label>
          </div>
          <div className="mode-cycle-mobile">
            <button type="button" className="mode-cycle-close" onClick={() => setComposerOpen(false)} title="Close">✕</button>
            <button type="button" className="mode-cycle-arrow" onClick={() => cycleMode(-1)}>‹</button>
            <span className="mode-cycle-label">{MODE_LABELS[inputMode]}</span>
            <button type="button" className="mode-cycle-arrow" onClick={() => cycleMode(1)}>›</button>
          </div>
          <div className="composer-input-row">
            <textarea
              ref={textareaRef}
              rows={4}
              value={input}
              onChange={(event) => updateInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={MODE_PLACEHOLDERS[inputMode]}
            />
            <button
              type="button"
              className="composer-send-btn"
              aria-label="Send"
              disabled={loading || !input.trim()}
              onClick={submit}
              title={loading ? "Generating…" : "Send"}
            >
              {loading ? "…" : "↑"}
            </button>
          </div>
          {showRemember && (
            <div className="remember-inline-row">
              <input
                autoFocus
                value={rememberInput}
                onChange={(event) => setRememberInput(event.target.value)}
                onKeyDown={handleRememberKeyDown}
                placeholder="e.g. Mira and Kael are now married"
              />
              <button type="button" disabled={loading || !rememberInput.trim()} onClick={remember}>Save</button>
              <button type="button" onClick={() => setShowRemember(false)}>✕</button>
            </div>
          )}
          <div className="composer-actions">
            <button
              type="button"
              className={`take-a-turn-full${composerOpen ? " secondary-toggle" : ""}`}
              onClick={() => setComposerOpen((v) => { if (!v) setTimeout(() => textareaRef.current?.focus(), 0); return !v; })}
            >
              {composerOpen ? "Close Input" : "Take a Turn"}
            </button>
            <div className={`secondary-actions${showOverflow ? " show-overflow" : ""}`}>
              <button type="button" disabled={loading} onClick={onContinue}>Continue</button>
              <button type="button" disabled={loading || !lastAssistant} onClick={onRegenerate}>Retry</button>
              <button
                type="button"
                disabled={loading || adventure.messages.length === 0}
                onClick={() => dispatch({ type: "DELETE_LAST_MESSAGE" })}
              >
                Erase
              </button>
              <button
                type="button"
                className="length-cycle-btn"
                title="Response length — tap to cycle"
                onClick={() => {
                  const presets = [75, 100, 150, 200, 250, 300, 400, 500];
                  const cur = adventure.activeState.responseLengthHint ?? 250;
                  const idx = presets.indexOf(cur);
                  dispatch({ type: "SET_RESPONSE_LENGTH_HINT", hint: presets[(idx + 1) % presets.length] });
                }}
              >
                {adventure.activeState.responseLengthHint ?? 250}w
              </button>
              <button
                type="button"
                className="action-extra"
                disabled={loading || adventure.activeState.storyUndoStack.length === 0}
                onClick={() => dispatch({ type: "UNDO_STORY_EDIT" })}
              >
                Undo
              </button>
              <button
                type="button"
                className="action-extra"
                disabled={loading || adventure.activeState.storyRedoStack.length === 0}
                onClick={() => dispatch({ type: "REDO_STORY_EDIT" })}
              >
                Redo
              </button>
              <button
                type="button"
                className={`action-extra${showRemember ? " active-tool" : ""}`}
                onClick={() => { setShowRemember((v) => !v); setComposerOpen(true); }}
              >
                Remember
              </button>
              <button
                type="button"
                className="action-overflow-toggle"
                onClick={() => setShowOverflow((v) => !v)}
                title="More actions"
              >
                {showOverflow ? "✕" : "···"}
              </button>
            </div>
            <span className="muted hint">Enter to submit · Shift+Enter for newline</span>
          </div>
        </div>
      </div>

      {/* Drag handle between story column and Toolkit */}
      <div
        className="play-toolkit-handle"
        onPointerDown={startToolkitResize}
        title="Drag to resize Toolkit"
        role="separator"
        aria-orientation="vertical"
      />

      {/* Toolkit — compact nav + optional tool panel */}
      <aside
        className={`play-sidebar${playPanelContent ? " has-panel" : ""}`}
        style={{ width: toolkitWidth }}
      >
        <div className="play-status">
          <span className="muted">Turn {adventure.activeState.turn} · {saveStatus}</span>
          {providerPresets && providerPresets.length > 1 && onSelectPreset && (
            <select
              className="preset-select"
              value={activePresetId ?? ""}
              onChange={(e) => onSelectPreset(e.target.value)}
              title="Active model"
            >
              {providerPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.label || p.model}</option>
              ))}
            </select>
          )}
          <div className="token-strip">
            <span>{contextResult?.totalEstimatedTokens ?? 0} tokens</span>
            {totalDropped > 0 && (
              <span className="trim-warning" title={trimTooltip || "Context trimmed to fit token budget"}>
                ⚠ {totalDropped} dropped
              </span>
            )}
          </div>
          {uiPreferences && onUiPreferencesChange && (
            <details className="play-layout-controls">
              <summary>Story layout</summary>
              <Field label="Width">
                <input
                  type="range"
                  min={520}
                  max={1800}
                  step={20}
                  value={uiPreferences.storyContentWidth}
                  onChange={(event) => updateStoryLayout({ storyContentWidth: Number(event.target.value) })}
                />
              </Field>
              <div className="story-align-control" role="group" aria-label="Story position">
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    type="button"
                    className={uiPreferences.storyContentAlign === align ? "active" : ""}
                    onClick={() => updateStoryLayout({ storyContentAlign: align })}
                  >
                    {align}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>

        <nav className="play-tool-nav" aria-label="Adventure tools">
          {toolButtons}
        </nav>

        {playPanelContent && (
          <div className="play-sidebar-panel">
            <div className="play-sidebar-panel-header">
              <span className="play-sidebar-panel-title">{playPanelTitle ?? "Tool"}</span>
              <button type="button" onClick={onClosePlayPanel} title="Close panel">✕</button>
            </div>
            <div className="play-sidebar-panel-body">
              {playPanelContent}
            </div>
          </div>
        )}

        <details className="next-turn-note panel" style={{ flex: "0 0 auto" }}>
          <summary>Next Turn Note {nextTurnNote.content.trim() ? "· active" : "(empty)"}</summary>
          <Field label="Visible next-output steering note">
            <textarea
              rows={2}
              value={nextTurnNote.content}
              onChange={(event) => dispatch({ type: "SET_NEXT_TURN_NOTE", note: { content: event.target.value } })}
              placeholder="One-turn instruction for the next AI response. Expires after use."
            />
          </Field>
          <div className="next-turn-note-controls">
            <CheckboxField label="Active" checked={nextTurnNote.active} onChange={(active) => dispatch({ type: "SET_NEXT_TURN_NOTE", note: { active } })} />
            <CheckboxField label="Pinned" checked={nextTurnNote.pinned} onChange={(pinned) => dispatch({ type: "SET_NEXT_TURN_NOTE", note: { pinned } })} />
            <CheckboxField label="Protected" checked={nextTurnNote.protected} onChange={(protectedValue) => dispatch({ type: "SET_NEXT_TURN_NOTE", note: { protected: protectedValue } })} />
            <CheckboxField label="Expires after output" checked={nextTurnNote.expiresAfterUse} onChange={(expiresAfterUse) => dispatch({ type: "SET_NEXT_TURN_NOTE", note: { expiresAfterUse } })} />
          </div>
          <div className="toolbar">
            <Field label="Priority">
              <NumberInput value={nextTurnNote.priority} onChange={(priority) => dispatch({ type: "SET_NEXT_TURN_NOTE", note: { priority } })} />
            </Field>
            <button type="button" onClick={() => dispatch({ type: "CLEAR_NEXT_TURN_NOTE" })}>Clear</button>
          </div>
        </details>
      </aside>
    </section>
  );
}
