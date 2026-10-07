/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDefaultAdventure } from '../state/defaults';
import { StoryDirectorPanel } from './StoryDirectorPanel';

afterEach(cleanup);
it('shows failed verdicts and exact rejected responses as text', () => {
  const adventure = createDefaultAdventure();
  const response = '<script>untrusted()</script> malformed JSON';
  adventure.activeState.storyDirectorEvaluations = [{
    sourceMessageId: 'removed', sourceContentFingerprint: 'original', turn: 7,
    createdAt: '2026-10-07T00:00:00Z', changes: [], playLoopSuspended: false,
    reconciliation: { status: 'notRequested' }, errors: ['Invalid JSON'],
    usage: { promptTokens: 0, completionTokens: 0 },
    rejectedResponses: [{ stage: 'evaluation', attempt: 1, response, error: 'Invalid JSON' }],
  }];
  const { container } = render(<StoryDirectorPanel adventure={adventure} dispatch={vi.fn()} />);
  expect(screen.getByText(/Turn 7.*NO VALID VERDICT/)).toBeInTheDocument();
  expect(screen.getByText(/Rejected evaluation response/)).toBeInTheDocument();
  expect(screen.getByText(response)).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
});
