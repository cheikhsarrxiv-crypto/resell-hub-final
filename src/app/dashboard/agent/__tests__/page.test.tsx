/**
 * Renders the REAL AgentPage (not a mock) via renderToStaticMarkup — this
 * exercises useAgentConversation at its real initial state, so it
 * genuinely proves "the Agent page renders" and "the empty state
 * renders", not just that a mocked stand-in does.
 *
 * next/navigation's useRouter/usePathname/useSearchParams need a real
 * mounted Next.js router context, which doesn't exist under
 * renderToStaticMarkup ("invariant expected app router to be mounted") —
 * mocked here exactly like @anthropic-ai/sdk/@/lib/prisma are mocked in
 * ai-agent-service.test.ts (vi.fn() placeholders inside the factory,
 * then imported and cast — this codebase's established fix for the
 * "vi.mock factory referencing a hoisted external variable" pitfall).
 *
 * IMPORTANT LIMITATION (same category as every other Phase 11 render
 * test): renderToStaticMarkup performs exactly one synchronous render
 * pass — React never runs useEffect during it. This means the actual
 * Phase 11D history-fetch effect (in useAgentConversation) never fires
 * here, so these tests can only prove the very first synchronous paint,
 * not the loading/hydration behavior that happens a moment later in a
 * real browser. That behavior (fetchConversationHistory,
 * deserializeHistoryResponse, the HYDRATE_* reducer actions) is instead
 * covered exhaustively at the pure-logic level in
 * agentConversation.test.ts, which is what actually drives it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import AgentPage from '@/app/dashboard/agent/page';

const useSearchParamsMock = useSearchParams as unknown as ReturnType<typeof vi.fn>;
const useRouterMock = useRouter as unknown as ReturnType<typeof vi.fn>;
const usePathnameMock = usePathname as unknown as ReturnType<typeof vi.fn>;

function setUrlSearchParams(params: Record<string, string> = {}) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(params));
}

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUrlSearchParams();
    useRouterMock.mockReturnValue({ replace: vi.fn(), push: vi.fn() });
    usePathnameMock.mockReturnValue('/dashboard/agent');
  });

  it('renders without crashing (no conversationId in the URL)', () => {
    expect(() => renderToStaticMarkup(<AgentPage />)).not.toThrow();
  });

  it('renders the Agent heading and intro copy', () => {
    const html = renderToStaticMarkup(<AgentPage />);

    expect(html).toContain('Agent ADKSY');
    expect(html).toContain('Votre assistant pour rechercher et analyser des produits de revente.');
  });

  it('renders the empty-state example prompts on first load (no messages yet)', () => {
    const html = renderToStaticMarkup(<AgentPage />);

    expect(html).toContain('Trouve-moi une sneaker Prada avec une bonne marge.');
  });

  it('does not show "Nouvelle conversation" before any message has been sent', () => {
    const html = renderToStaticMarkup(<AgentPage />);

    expect(html).not.toContain('Nouvelle conversation');
  });

  it('does not show an error banner on first load', () => {
    const html = renderToStaticMarkup(<AgentPage />);

    expect(html).not.toContain('role="alert"');
  });

  it('renders a composer with an accessible send control', () => {
    const html = renderToStaticMarkup(<AgentPage />);

    expect(html).toContain('aria-label="Envoyer le message"');
  });

  describe('Phase 11D: with ?conversationId= in the URL', () => {
    it('renders without crashing when a conversationId is present in the URL', () => {
      setUrlSearchParams({ conversationId: 'conv-123' });

      expect(() => renderToStaticMarkup(<AgentPage />)).not.toThrow();
    });

    it('reads conversationId from useSearchParams, never fabricates its own', () => {
      setUrlSearchParams({ conversationId: 'conv-123' });

      renderToStaticMarkup(<AgentPage />);

      expect(useSearchParamsMock).toHaveBeenCalled();
    });
  });
});
