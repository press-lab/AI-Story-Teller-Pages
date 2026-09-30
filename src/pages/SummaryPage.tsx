import { useState } from "react";
import type { AdventurePageProps } from "./pageTypes";
import { CheckboxField, Field, NumberInput } from "./shared";

interface SummaryPageProps extends AdventurePageProps {
  onGenerateDurableSummary: () => Promise<string>;
  onGenerateSceneState: () => Promise<string>;
}

export function SummaryPage({ adventure, dispatch, onGenerateDurableSummary, onGenerateSceneState }: SummaryPageProps) {
  const [durableDraft, setDurableDraft] = useState<string | null>(null);
  const [durableLoading, setDurableLoading] = useState(false);
  const [durableError, setDurableError] = useState<string | undefined>();

  const [sceneDraft, setSceneDraft] = useState<string | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState<string | undefined>();

  async function handleGenerateDurable() {
    setDurableLoading(true);
    setDurableError(undefined);
    try {
      const text = await onGenerateDurableSummary();
      setDurableDraft(text);
    } catch (err) {
      setDurableError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setDurableLoading(false);
    }
  }

  async function handleGenerateScene() {
    setSceneLoading(true);
    setSceneError(undefined);
    try {
      const text = await onGenerateSceneState();
      setSceneDraft(text);
    } catch (err) {
      setSceneError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setSceneLoading(false);
    }
  }

  const durableValue = durableDraft ?? adventure.rollingSummary.content;
  const sceneValue = sceneDraft ?? adventure.sceneState?.content ?? "";
  const savedSceneContent = adventure.sceneState?.content ?? "";

  return (
    <section className="page">
      <article className="panel">
        <h3>Durable Story Summary</h3>
        <p className="muted">
          Long-term canon — arc beats, permanent changes, relationships, open plot threads.
          Sent every turn so older history stays alive. New facts are appended automatically.
          {" "}<strong>The summary defines what the story is "about" to the model.</strong> If it fills with relationship milestones and emotional beats, the model writes a relationship story. Keep at least one external arc, unresolved problem, or active threat visible here alongside any personal developments.
        </p>
        <div className="grid two">
          <CheckboxField
            label="Include in context"
            checked={adventure.tokenBudgetSettings.summaryEnabled !== false}
            onChange={(summaryEnabled) => dispatch({ type: "SET_TOKEN_BUDGET_SETTINGS", settings: { ...adventure.tokenBudgetSettings, summaryEnabled } })}
          />
          <CheckboxField
            label="Auto-summarize"
            disabled={adventure.tokenBudgetSettings.summaryEnabled === false}
            checked={adventure.tokenBudgetSettings.autoSummarize ?? true}
            onChange={(autoSummarize) => dispatch({ type: "SET_TOKEN_BUDGET_SETTINGS", settings: { ...adventure.tokenBudgetSettings, autoSummarize } })}
          />
          <Field label="Every N turns" style={adventure.tokenBudgetSettings.summaryEnabled === false ? { opacity: 0.4 } : undefined}>
            <NumberInput
              min={1}
              disabled={adventure.tokenBudgetSettings.summaryEnabled === false}
              value={adventure.tokenBudgetSettings.autoSummarizeEveryNTurns ?? 20}
              onChange={(autoSummarizeEveryNTurns) => dispatch({ type: "SET_TOKEN_BUDGET_SETTINGS", settings: { ...adventure.tokenBudgetSettings, autoSummarizeEveryNTurns } })}
            />
          </Field>
        </div>
      </article>

      <div className={`toolbar${adventure.tokenBudgetSettings.summaryEnabled === false ? " disabled-section" : ""}`}>
        <button type="button" disabled={durableLoading || adventure.tokenBudgetSettings.summaryEnabled === false} onClick={handleGenerateDurable}>
          {durableLoading ? "Generating..." : "Regenerate"}
        </button>
        {durableDraft !== null && durableDraft !== adventure.rollingSummary.content && (
          <>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "UPDATE_ROLLING_SUMMARY", content: durableDraft, lastSummarizedMessageIndex: adventure.messages.length });
                setDurableDraft(null);
              }}
            >
              Apply
            </button>
            <button type="button" onClick={() => setDurableDraft(null)}>Discard</button>
          </>
        )}
        <span className="muted">Updated {new Date(adventure.rollingSummary.updatedAt).toLocaleString()}</span>
      </div>
      {durableError && <p className="error">{durableError}</p>}
      <textarea
        rows={12}
        value={durableValue}
        disabled={adventure.tokenBudgetSettings.summaryEnabled === false}
        style={adventure.tokenBudgetSettings.summaryEnabled === false ? { opacity: 0.4 } : undefined}
        onChange={(e) => {
          if (durableDraft !== null) {
            setDurableDraft(e.target.value);
          } else {
            dispatch({ type: "UPDATE_ROLLING_SUMMARY", content: e.target.value });
          }
        }}
        placeholder="A durable summary of permanent story events, established facts, and open plot threads."
      />

      <article className="panel">
        <h3>Current Scene State</h3>
        <p className="muted">
          Immediate present — current location, present characters, last important beat.
          Placed just before Recent Messages to ground the model in the current moment.
        </p>
        <CheckboxField
          label="Include scene state in context and auto-update"
          checked={adventure.tokenBudgetSettings.sceneStateEnabled !== false}
          onChange={(sceneStateEnabled) => dispatch({ type: "SET_TOKEN_BUDGET_SETTINGS", settings: { ...adventure.tokenBudgetSettings, sceneStateEnabled } })}
        />
      </article>

      <div className={`toolbar${adventure.tokenBudgetSettings.sceneStateEnabled === false ? " disabled-section" : ""}`}>
        <button type="button" disabled={sceneLoading || adventure.tokenBudgetSettings.sceneStateEnabled === false} onClick={handleGenerateScene}>
          {sceneLoading ? "Generating..." : "Regenerate"}
        </button>
        {sceneDraft !== null && sceneDraft !== savedSceneContent && (
          <>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "UPDATE_SCENE_STATE", content: sceneDraft });
                setSceneDraft(null);
              }}
            >
              Apply
            </button>
            <button type="button" onClick={() => setSceneDraft(null)}>Discard</button>
          </>
        )}
        {adventure.sceneState?.updatedAt && (
          <span className="muted">Updated {new Date(adventure.sceneState.updatedAt).toLocaleString()}</span>
        )}
      </div>
      {sceneError && <p className="error">{sceneError}</p>}
      <textarea
        rows={6}
        value={sceneValue}
        disabled={adventure.tokenBudgetSettings.sceneStateEnabled === false}
        style={adventure.tokenBudgetSettings.sceneStateEnabled === false ? { opacity: 0.4 } : undefined}
        onChange={(e) => {
          if (sceneDraft !== null) {
            setSceneDraft(e.target.value);
          } else {
            dispatch({ type: "UPDATE_SCENE_STATE", content: e.target.value });
          }
        }}
        placeholder="Current location, present characters, last story beat."
      />
    </section>
  );
}
