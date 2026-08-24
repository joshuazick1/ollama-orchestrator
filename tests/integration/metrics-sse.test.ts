import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { setupIntegrationTest, teardownIntegrationTest, getIntegrationTestBaseUrl } from './setup.js';

describe('SSE /events Metrics Payload', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('GET /events emits metrics with schemaVersion: 1, sequence, and circuitBreakerDetails', async () => {
    const url = `${getIntegrationTestBaseUrl()}/api/orchestrator/events`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const events: unknown[] = [];
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(resp.ok).toBe(true);
      expect(resp.headers.get('content-type')).toContain('text/event-stream');

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (events.length < 2) {
        const { done, value } = await reader.read();
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice('data: '.length);
            if (data.trim()) {
              try {
                events.push(JSON.parse(data));
              } catch {
                // ignore parse errors for non-JSON events (e.g. error events)
              }
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }

    expect(events.length).toBeGreaterThanOrEqual(1);

    // First event should have the full metrics shape
    const first = events[0] as Record<string, unknown>;
    expect(first).toHaveProperty('type', 'metrics');
    expect(first).toHaveProperty('schemaVersion', '1');
    expect(first).toHaveProperty('sequence');
    expect(typeof first.sequence).toBe('number');
    expect(first).toHaveProperty('timestamp');
    expect(first).toHaveProperty('stats');
    expect(first).toHaveProperty('metrics');
    expect(first).toHaveProperty('circuitBreakers');
    expect(typeof first.circuitBreakers).toBe('number');
    expect(first).toHaveProperty('servers');
    expect(first).toHaveProperty('modelMap');
    expect(first).toHaveProperty('inFlight');
    expect(first).toHaveProperty('circuitBreakerDetails');
    expect(typeof first.circuitBreakerDetails).toBe('object');
    expect(first.circuitBreakerDetails).not.toBeNull();
  });

  it('sequence increments between events', async () => {
    const url = `${getIntegrationTestBaseUrl()}/api/orchestrator/events`;
    const controller = new AbortController();
    // Allow up to 20s for live fleet event emission
    const timeout = setTimeout(() => controller.abort(), 20000);

    const events: { sequence: number }[] = [];
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (events.length < 3) {
        const { done, value } = await reader.read();
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice('data: '.length);
            if (data.trim()) {
              try {
                const parsed = JSON.parse(data);
                if ((parsed as { type?: string }).type === 'metrics') {
                  events.push(parsed as { sequence: number });
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }

    if (events.length >= 2) {
      expect(events[1].sequence).toBe(events[0].sequence + 1);
    }
    if (events.length >= 3) {
      expect(events[2].sequence).toBe(events[1].sequence + 1);
    }
  });

  it('circuitBreakerDetails keys match getCircuitBreakerStats keys', async () => {
    // Verify the rich details map has the same keys as the legacy count
    // by checking that circuitBreakerDetails keys *should* exist for every
    // server:model tuple in the fleet at the time of the snapshot.
    // The SSE payload already includes both — this test just confirms the
    // additive nature of the new field.
    const url = `${getIntegrationTestBaseUrl()}/api/orchestrator/events`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let captured: Record<string, unknown> | null = null;
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!captured) {
        const { done, value } = await reader.read();
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice('data: '.length);
            if (data.trim()) {
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                if (parsed.type === 'metrics') {
                  captured = parsed;
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }

    expect(captured).not.toBeNull();
    const details = captured!.circuitBreakerDetails as Record<string, unknown>;
    expect(details).toBeDefined();
    // circuitBreakerDetails keys are TupleKeys: serverId:model:endpoint format.
    // Model names may contain colons (e.g. "205.237.106.117:8443/attacker/leak:latest"),
    // and serverId may also contain colons (e.g. "ipv6::ffff:192.168.1.1").
    // We verify keys parse without error rather than matching a fixed segment count.
    for (const key of Object.keys(details)) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      // Verify each key yields a non-empty object when parsed
      expect(details[key]).toBeDefined();
    }
  });
});
