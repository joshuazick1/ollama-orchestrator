import { describe, it, expect, beforeEach, vi } from 'vitest';

import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';
import type { ProbeEndpoint } from '../../../src/probe/types.js';

describe('EndpointRegistry soft-revoke', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('softRevoke', () => {
    it('sets confirmed = false but keeps the entry in capabilities map', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      // Entry should still exist
      expect(registry.getCapabilities('srv1').has('ollama_chat')).toBe(true);
      // But confirmed should be false
      expect(registry.getCapabilities('srv1').get('ollama_chat')?.confirmed).toBe(false);
    });

    it('sets lastSeen = 0 on soft-revoke', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.lastSeen).toBeGreaterThan(0);
      registry.softRevoke('srv1', 'ollama_chat');
      expect(registry.getCapabilities('srv1').get('ollama_chat')?.lastSeen).toBe(0);
    });

    it('does not delete the entry (preserved for inspection)', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      // Entry preserved
      expect(registry.getCapabilities('srv1').size).toBe(1);
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.declared).toBe(true);
      expect(cap?.confirmed).toBe(false);
    });
  });

  describe('getActiveEndpoints after soft-revoke', () => {
    it('excludes soft-revoked entries', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      const active = registry.getActiveEndpoints('srv1', 'llama3');
      expect(active).not.toContain('ollama_chat');
    });

    it('returns empty array when all endpoints are soft-revoked', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_generate');
      registry.softRevoke('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_generate');
      const active = registry.getActiveEndpoints('srv1', 'llama3');
      expect(active).toEqual([]);
    });
  });

  describe('confirm after soft-revoke', () => {
    it('restores confirmed = true', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_chat');
      expect(registry.getCapabilities('srv1').get('ollama_chat')?.confirmed).toBe(true);
    });

    it('resets consecutiveFailures to 0', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(2);
      registry.confirm('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(0);
    });
  });

  describe('recordFailure with threshold', () => {
    it('increments consecutiveFailures', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(2);
    });

    it('auto soft-revokes when consecutiveFailures >= threshold', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      // With threshold=3, after 3 failures it should auto soft-revoke
      registry.recordFailure('srv1', 'ollama_chat', 3);
      registry.recordFailure('srv1', 'ollama_chat', 3);
      registry.recordFailure('srv1', 'ollama_chat', 3);
      // Should be soft-revoked (confirmed = false)
      expect(registry.getCapabilities('srv1').get('ollama_chat')?.confirmed).toBe(false);
      // Entry still exists
      expect(registry.getCapabilities('srv1').has('ollama_chat')).toBe(true);
    });

    it('without threshold does NOT auto-soft-revoke', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      // Record multiple failures without threshold
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      // Should still be confirmed (manual only)
      expect(registry.getCapabilities('srv1').get('ollama_chat')?.confirmed).toBe(true);
    });
  });

  describe('getConsecutiveFailures', () => {
    it('returns current count', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(0);
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(2);
    });

    it('returns 0 for unknown endpoint', () => {
      const registry = new EndpointRegistry();
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(0);
    });
  });

  describe('resetConsecutiveFailures', () => {
    it('resets count to 0', () => {
      const registry = new EndpointRegistry();
      registry.declare('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(2);
      registry.resetConsecutiveFailures('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(0);
    });
  });

  describe('getCapabilities preserves soft-revoked entries', () => {
    it('returns soft-revoked entries for inspection', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      const caps = registry.getCapabilities('srv1');
      expect(caps.size).toBe(1);
      const cap = caps.get('ollama_chat');
      expect(cap?.declared).toBe(true);
      expect(cap?.confirmed).toBe(false);
      expect(cap?.lastSeen).toBe(0);
    });
  });

  describe('evictCold with soft-revoked entries', () => {
    it('does not crash on soft-revoked entries', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      // Should not throw
      expect(() => registry.evictCold(30_000)).not.toThrow();
    });

    it('soft-revoked entries already have confirmed=false and lastSeen=0', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.softRevoke('srv1', 'ollama_chat');
      vi.advanceTimersByTime(60_000);
      registry.evictCold(30_000);
      // State should remain soft-revoked (not change further)
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.confirmed).toBe(false);
      expect(cap?.lastSeen).toBe(0);
    });
  });

  describe('consecutiveFailures field in EndpointCapability', () => {
    it('confirm resets consecutiveFailures to 0', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.confirm('srv1', 'ollama_chat');
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(0);
    });

    it('consecutiveFailures is tracked separately from failureCount', () => {
      const registry = new EndpointRegistry();
      registry.confirm('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      registry.recordFailure('srv1', 'ollama_chat');
      const cap = registry.getCapabilities('srv1').get('ollama_chat');
      expect(cap?.failureCount).toBe(2);
      expect(registry.getConsecutiveFailures('srv1', 'ollama_chat')).toBe(2);
    });
  });
});
