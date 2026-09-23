import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isExpired,
  isTerminalActionStatus,
  TERMINAL_ACTION_STATUSES,
  ACTION_CONFIRMATION_TTL_MS,
  type AgentActionStatus,
} from '@/lib/ai/agentActionStateMachine';

const ALL_STATUSES: AgentActionStatus[] = [
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
];

describe('canTransition — the only valid path is the real one', () => {
  it('PENDING_CONFIRMATION -> CONFIRMED -> EXECUTING -> COMPLETED is fully valid', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'EXECUTING')).toBe(true);
    expect(canTransition('EXECUTING', 'COMPLETED')).toBe(true);
  });

  it('EXECUTING -> FAILED is valid (execution can genuinely fail)', () => {
    expect(canTransition('EXECUTING', 'FAILED')).toBe(true);
  });

  it('PENDING_CONFIRMATION -> CANCELLED and -> EXPIRED are valid', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'CANCELLED')).toBe(true);
    expect(canTransition('PENDING_CONFIRMATION', 'EXPIRED')).toBe(true);
  });

  it('COMPLETED -> EXECUTING is refused (the spec\'s own explicit example of an illegal transition)', () => {
    expect(canTransition('COMPLETED', 'EXECUTING')).toBe(false);
  });

  it('no terminal status can transition anywhere', () => {
    for (const from of TERMINAL_ACTION_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('CONFIRMED cannot skip straight to COMPLETED (must go through EXECUTING)', () => {
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(false);
  });

  it('PENDING_CONFIRMATION cannot skip straight to EXECUTING or COMPLETED', () => {
    expect(canTransition('PENDING_CONFIRMATION', 'EXECUTING')).toBe(false);
    expect(canTransition('PENDING_CONFIRMATION', 'COMPLETED')).toBe(false);
  });

  it('nothing can transition to itself (no-op "transitions" are not a real transition)', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('CANCELLED/EXPIRED can never later become CONFIRMED (a cancelled/expired action cannot be revived)', () => {
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransition('EXPIRED', 'CONFIRMED')).toBe(false);
  });
});

describe('isTerminalActionStatus', () => {
  it('COMPLETED, FAILED, CANCELLED, EXPIRED are terminal', () => {
    expect(isTerminalActionStatus('COMPLETED')).toBe(true);
    expect(isTerminalActionStatus('FAILED')).toBe(true);
    expect(isTerminalActionStatus('CANCELLED')).toBe(true);
    expect(isTerminalActionStatus('EXPIRED')).toBe(true);
  });

  it('PENDING_CONFIRMATION, CONFIRMED, EXECUTING are not terminal', () => {
    expect(isTerminalActionStatus('PENDING_CONFIRMATION')).toBe(false);
    expect(isTerminalActionStatus('CONFIRMED')).toBe(false);
    expect(isTerminalActionStatus('EXECUTING')).toBe(false);
  });
});

describe('isExpired', () => {
  it('a confirmation window in the future is not expired', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const expiresAt = new Date('2026-01-01T12:10:00Z');
    expect(isExpired(expiresAt, now)).toBe(false);
  });

  it('a confirmation window in the past is expired', () => {
    const now = new Date('2026-01-01T12:20:00Z');
    const expiresAt = new Date('2026-01-01T12:10:00Z');
    expect(isExpired(expiresAt, now)).toBe(true);
  });

  it('the exact expiry instant counts as expired (never a one-tick grace window)', () => {
    const at = new Date('2026-01-01T12:10:00Z');
    expect(isExpired(at, at)).toBe(true);
  });
});

describe('ACTION_CONFIRMATION_TTL_MS', () => {
  it('is 15 minutes, as specified', () => {
    expect(ACTION_CONFIRMATION_TTL_MS).toBe(15 * 60 * 1000);
  });
});
