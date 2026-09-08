/**
 * AiChatWidget.tsx cannot be imported directly under this repo's Vitest
 * setup (tsconfig.json sets "jsx": "preserve", required for Next.js's own
 * JSX transform — esbuild/Vitest refuses to parse a .tsx file under that
 * setting). Matching the convention already established for MarketplaceConnectionsCard.tsx
 * (src/components/marketplace/__tests__/MarketplaceConnectionsCard.test.ts),
 * this does source-level checks against the real component file.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/AiChatWidget.tsx'),
  'utf-8'
);

describe('AiChatWidget — welcome message', () => {
  it('shows the exact specified greeting as the initial assistant message', () => {
    expect(componentSource).toContain("I'm ADKSY AI");
    expect(componentSource).toContain('What can I help you with?');
  });
});

describe('AiChatWidget — chat mechanics', () => {
  it('Enter sends the message, Shift+Enter inserts a newline', () => {
    const handlerStart = componentSource.indexOf('const handleKeyDown');
    const handlerEnd = componentSource.indexOf('};', handlerStart);
    const handler = componentSource.slice(handlerStart, handlerEnd);
    expect(handler).toContain("e.key === 'Enter' && !e.shiftKey");
    expect(handler).toContain('e.preventDefault()');
    expect(handler).toContain('handleSend()');
  });

  it('has a visible close button', () => {
    expect(componentSource).toContain("aria-label=\"Close\"");
  });

  it('has a loading state shown while a request is in flight', () => {
    expect(componentSource).toContain('{sending &&');
  });

  it('has an error state that renders a message when the request fails', () => {
    expect(componentSource).toContain('{error &&');
    expect(componentSource).toContain('setError(');
  });

  it('keeps conversation history in component state for the session only (no persistence call)', () => {
    expect(componentSource).toContain('useState<ChatMessage[]>');
    expect(componentSource).not.toContain('localStorage');
    expect(componentSource).not.toContain('sessionStorage');
  });
});

describe('AiChatWidget — request shape (never sends a workspaceId)', () => {
  it("posts message/currentPage/history to /api/ai/chat, with no workspaceId field", () => {
    const fetchCallStart = componentSource.indexOf("fetch('/api/ai/chat'");
    expect(fetchCallStart).toBeGreaterThan(-1);
    const fetchCallEnd = componentSource.indexOf('});', fetchCallStart);
    const fetchCall = componentSource.slice(fetchCallStart, fetchCallEnd);

    expect(fetchCall).toContain('message: trimmed');
    expect(fetchCall).toContain('currentPage: getCurrentPage(pathname');
    expect(fetchCall).toContain('history,');
    expect(fetchCall).not.toContain('workspaceId');
  });
});

describe('AiChatWidget — responsive layout (mobile + desktop from the same component)', () => {
  it('the trigger button is fixed-positioned and reachable on any viewport', () => {
    expect(componentSource).toContain('fixed bottom-5 right-5 sm:bottom-6 sm:right-6');
  });

  it('the panel is a full-screen sheet below the sm breakpoint and a floating card at sm and up', () => {
    const panelClassStart = componentSource.indexOf('fixed inset-0 sm:inset-auto');
    expect(panelClassStart).toBeGreaterThan(-1);
    const panelClassLine = componentSource.slice(panelClassStart, panelClassStart + 200);
    // Mobile: full-viewport overlay (inset-0, no rounding/border/shadow).
    expect(panelClassLine).toContain('inset-0');
    // Desktop (sm:): anchored floating card with its own size/border/shadow.
    expect(panelClassLine).toContain('sm:w-[380px]');
    expect(panelClassLine).toContain('sm:h-[560px]');
    expect(panelClassLine).toContain('sm:border');
    expect(panelClassLine).toContain('sm:rounded-2xl');
  });

  it('the message list scrolls independently of the panel (flex-1 overflow-y-auto)', () => {
    expect(componentSource).toContain('flex-1 overflow-y-auto');
  });
});

describe('AiChatWidget — visual consistency with the existing dark dashboard theme', () => {
  it('reuses the same accent color and card tokens already used elsewhere in the dashboard', () => {
    expect(componentSource).toContain('#FF5A1F');
    expect(componentSource).toContain('bg-[#0a0a0c]');
    expect(componentSource).toContain('border-white/[0.08]');
  });
});

describe('DashboardLayout — mounts the widget for the merchant dashboard only', () => {
  const layoutSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/Layout/DashboardLayout.tsx'),
    'utf-8'
  );

  it('imports and renders AiChatWidget, gated on !isAdmin', () => {
    expect(layoutSource).toContain("import { AiChatWidget } from '@/components/dashboard/AiChatWidget'");
    expect(layoutSource).toContain('{!isAdmin && <AiChatWidget />}');
  });
});
