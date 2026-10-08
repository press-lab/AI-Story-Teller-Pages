import { useId } from 'react';
import type { Adventure, AdventureAction } from '../types/adventure';
import { effectiveDirectorMode, normalizeDirectorMode, STORY_DIRECTOR_MODES, STORY_MODE_LABELS } from '../memory/storyDirectorState';

export function StoryDirectorModeControl({ adventure, dispatch, compact = false }: { adventure: Adventure; dispatch: (action: AdventureAction) => void; compact?: boolean }) {
  const id = useId();
  const selected = normalizeDirectorMode(adventure.activeState.storyDirectorMode);
  return <div className={`director-mode-control${compact ? ' compact' : ''}`}>
    <label htmlFor={id}>Story Director mode</label>
    <select id={id} value={selected} onChange={e => dispatch({ type: 'SET_STORY_DIRECTOR_MODE', mode: normalizeDirectorMode(e.target.value) })}>
      {STORY_DIRECTOR_MODES.map(mode => <option key={mode} value={mode}>{STORY_MODE_LABELS[mode]}</option>)}
    </select>
    <span className="muted">{selected === 'AUTO' ? `Now: ${STORY_MODE_LABELS[effectiveDirectorMode(adventure)]}` : 'Manual override'}</span>
    {!compact && <p className="muted">Manual modes apply to the next generation and remain until you select Auto. Evaluation and evidence checks continue; mode changes do not approve memory updates.</p>}
  </div>;
}
