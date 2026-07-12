import { describe, it, expect } from 'vitest';
import { AIOrchestrator } from '../../../src/orchestrator/orchestrator.js';
import type { AIServer } from '../../../src/orchestrator/orchestrator.js';

const makeServer = (id: string): AIServer =>
  ({
    id,
    url: `http://${id}:11434`,
    healthy: true,
    models: [],
  }) as unknown as AIServer;

describe('cloud-model-routing', () => {
  describe('isCloudModel', () => {
    it('returns true for minimax-m3:cloud', () => {
      const result = AIOrchestrator.computeCandidatePoolTrim(
        [makeServer('s1')],
        'minimax-m3:cloud',
        undefined
      );
      expect(result.length).toBe(1);
    });

    it('returns true for cloud-gpt4', () => {
      const result = AIOrchestrator.computeCandidatePoolTrim(
        [makeServer('s1')],
        'cloud-gpt4',
        undefined
      );
      expect(result.length).toBe(1);
    });

    it('returns true for meta-cloud', () => {
      const result = AIOrchestrator.computeCandidatePoolTrim(
        [makeServer('s1')],
        'meta-cloud',
        undefined
      );
      expect(result.length).toBe(1);
    });

    it('returns false for llama3:8b', () => {
      const servers = Array.from({ length: 5 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(
        servers,
        'llama3:8b',
        undefined
      );
      expect(result.length).toBe(5);
    });

    it('returns false for llama3', () => {
      const servers = Array.from({ length: 5 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(
        servers,
        'llama3',
        undefined
      );
      expect(result.length).toBe(5);
    });
  });

  describe('trim block with cloudModelNoCap === true', () => {
    it('applies ceiling when eligibleServers > ceiling', () => {
      const servers = Array.from({ length: 150 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'minimax-m3:cloud', {
        cloudModelNoCap: true,
        cloudModelMaxCandidates: 100,
      });
      expect(result.length).toBe(100);
    });

    it('leaves remainingServers.length === eligibleServers.length when eligible <= ceiling', () => {
      const servers = Array.from({ length: 50 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'minimax-m3:cloud', {
        cloudModelNoCap: true,
        cloudModelMaxCandidates: 100,
      });
      expect(result.length).toBe(50);
    });

    it('uses default ceiling of 100 when cloudModelMaxCandidates not set', () => {
      const servers = Array.from({ length: 200 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'minimax-m3:cloud', {
        cloudModelNoCap: true,
      });
      expect(result.length).toBe(100);
    });
  });

  describe('trim block with cloudModelNoCap === false (default)', () => {
    it('applies 20-cap for non-cloud models when eligibleServers > 20', () => {
      const servers = Array.from({ length: 25 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'llama3:8b', {
        cloudModelNoCap: false,
        cloudModelMaxCandidates: 100,
      });
      expect(result.length).toBe(20);
    });

    it('preserves all servers when non-cloud model eligibleServers <= 20', () => {
      const servers = Array.from({ length: 15 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'llama3:8b', {
        cloudModelNoCap: false,
        cloudModelMaxCandidates: 100,
      });
      expect(result.length).toBe(15);
    });

    it('applies 20-cap for cloud models when cloudModelNoCap is false', () => {
      const servers = Array.from({ length: 25 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'minimax-m3:cloud', {
        cloudModelNoCap: false,
        cloudModelMaxCandidates: 100,
      });
      expect(result.length).toBe(20);
    });
  });

  describe('existing behavior preserved', () => {
    it('non-cloud-model with 25 eligible servers trims to 20', () => {
      const servers = Array.from({ length: 25 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'llama3', undefined);
      expect(result.length).toBe(20);
    });

    it('non-cloud-model with 20 eligible servers is unchanged', () => {
      const servers = Array.from({ length: 20 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'llama3', undefined);
      expect(result.length).toBe(20);
    });

    it('non-cloud-model with 10 eligible servers is unchanged', () => {
      const servers = Array.from({ length: 10 }, (_, i) => makeServer(`s${i}`));
      const result = AIOrchestrator.computeCandidatePoolTrim(servers, 'llama3', undefined);
      expect(result.length).toBe(10);
    });
  });
});
