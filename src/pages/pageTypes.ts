import { stripRetiredTokenSettings } from "../state/legacyAdventureInput";
import type { ReactNode } from "react";
import type { Adventure, AdventureAction, ContextBuildResult, InputMode, MemoryDetectionSettings, ProviderConfig, SemanticEvaluationSettings, TokenBudgetSettings } from "../types/adventure";
import { defaultMemoryDetectionSettings, defaultSemanticEvaluationSettings, defaultTokenBudgetSettings } from "../state/defaults";

export interface UiPreferences {
  darkMode: boolean;
  darkModeTextColor: string;
  density: "compact" | "comfortable";
  storyFontSize: number;
  storyContentWidth: number;
  storyContentAlign: "left" | "center" | "right";
  maxContentWidth: number;
  showTokenEstimates: boolean;
  showAdvancedSettings: boolean;
}

export interface GlobalAdventureSettings {
  tokenBudgetSettings: TokenBudgetSettings;
  semanticEvaluationSettings: SemanticEvaluationSettings;
  memoryDetectionSettings: MemoryDetectionSettings;
}

export const defaultGlobalAdventureSettings: GlobalAdventureSettings = {
  tokenBudgetSettings: defaultTokenBudgetSettings,
  semanticEvaluationSettings: defaultSemanticEvaluationSettings,
  memoryDetectionSettings: defaultMemoryDetectionSettings,
};

export function normalizeGlobalAdventureSettings(settings: GlobalAdventureSettings): GlobalAdventureSettings {
  const { requireApprovalForAutoUpdates: _retired, ...semanticSettings } = (settings.semanticEvaluationSettings ?? {}) as Partial<SemanticEvaluationSettings> & { requireApprovalForAutoUpdates?: unknown };
  return {
    tokenBudgetSettings: { ...defaultTokenBudgetSettings, ...stripRetiredTokenSettings(settings.tokenBudgetSettings) },
    semanticEvaluationSettings: { ...defaultSemanticEvaluationSettings, ...semanticSettings },
    memoryDetectionSettings: { ...defaultMemoryDetectionSettings, ...settings.memoryDetectionSettings },
  };
}

export const defaultUiPreferences: UiPreferences = {
  darkMode: false,
  darkModeTextColor: "#d6ddd4",
  density: "comfortable",
  storyFontSize: 20,
  storyContentWidth: 1400,
  storyContentAlign: "center",
  maxContentWidth: 1100,
  showTokenEstimates: true,
  showAdvancedSettings: false,
};

export interface AdventurePageProps {
  adventure: Adventure;
  dispatch: (action: AdventureAction) => void;
}

export interface RuntimeProviderSettings extends ProviderConfig {
  apiKey: string;
}

export interface ProviderPreset extends RuntimeProviderSettings {
  id: string;
  label: string;
}

export interface MemoryWorkStatus {
  adventureId: string;
  status: "running" | "failed" | "paused";
  sourceIds: string[];
  remaining: number;
  group?: import("../types/adventure").MemoryEvaluationGroup;
  error?: string;
}

export interface PlayRuntimeProps extends AdventurePageProps {
  contextResult?: ContextBuildResult;
  loading: boolean;
  memoryWork?: MemoryWorkStatus;
  error?: string;
  onDismissError?: () => void;
  saveStatus: string;
  // False means no turn was accepted; keep the player draft.
  onSubmitTurn: (text: string, mode: InputMode) => Promise<boolean | void>;
  onContinue: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  onBuildContext: () => void;
  onOpenContext: () => void;
  onRememberThis: (fact: string) => Promise<void>;
  onPullLatest?: () => Promise<void>;
  onOpenTab?: (tabId: string) => void;
  /** Opens a tool in the play-page right panel (instead of navigating away). */
  onOpenPlayTool?: (tabId: string) => void;
  /** Content to render in the sidebar panel (below the nav buttons). */
  playPanelContent?: ReactNode;
  playPanelTitle?: string;
  onClosePlayPanel?: () => void;
  providerPresets?: ProviderPreset[];
  activePresetId?: string;
  onSelectPreset?: (id: string) => void;
  uiPreferences?: UiPreferences;
  onUiPreferencesChange?: (prefs: UiPreferences) => void;
}
