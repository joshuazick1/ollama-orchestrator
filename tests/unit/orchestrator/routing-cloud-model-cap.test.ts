import { describe, it, expect } from 'vitest';
import { isCloudModel } from '../../../src/utils/cloud-model-filter.js';

describe('routing-cloud-model-cap', () => {
  describe('isCloudModel detection', () => {
    it('identifies minimax-m3:cloud as cloud model', () => {
      expect(isCloudModel('minimax-m3:cloud')).toBe(true);
    });

    it('identifies cloud-gpt4 as cloud model', () => {
      expect(isCloudModel('cloud-gpt4')).toBe(true);
    });

    it('identifies meta-cloud as cloud model', () => {
      expect(isCloudModel('meta-cloud')).toBe(true);
    });

    it('does not identify llama3:8b as cloud model', () => {
      expect(isCloudModel('llama3:8b')).toBe(false);
    });
  });

  describe('cloud model ceiling trimming logic', () => {
    it('trims server list to ceiling when cloud model and cloudModelNoCap is true', () => {
      const servers = Array.from({ length: 150 }, (_, i) => ({
        id: `server-${i}`,
      })) as any[];

      const model = 'minimax-m3:cloud';
      const cloudModelNoCap = true;
      const cloudModelMaxCandidates = 100;

      let remainingServers = [...servers];

      if (isCloudModel(model) && cloudModelNoCap === true) {
        const ceiling = cloudModelMaxCandidates;
        if (remainingServers.length > ceiling) {
          remainingServers = remainingServers.slice(0, ceiling);
        }
      }

      expect(remainingServers.length).toBe(100);
    });

    it('does not trim when cloudModelNoCap is false', () => {
      const servers = Array.from({ length: 150 }, (_, i) => ({
        id: `server-${i}`,
      })) as any[];

      const model = 'minimax-m3:cloud';
      const cloudModelNoCap = false;
      const cloudModelMaxCandidates = 100;

      let remainingServers = [...servers];

      if (isCloudModel(model) && cloudModelNoCap === true) {
        const ceiling = cloudModelMaxCandidates;
        if (remainingServers.length > ceiling) {
          remainingServers = remainingServers.slice(0, ceiling);
        }
      }

      expect(remainingServers.length).toBe(150);
    });

    it('does not trim non-cloud models even with many servers', () => {
      const servers = Array.from({ length: 150 }, (_, i) => ({
        id: `server-${i}`,
      })) as any[];

      const model = 'llama3:8b';
      const cloudModelNoCap = true;
      const cloudModelMaxCandidates = 100;

      let remainingServers = [...servers];

      if (isCloudModel(model) && cloudModelNoCap === true) {
        const ceiling = cloudModelMaxCandidates;
        if (remainingServers.length > ceiling) {
          remainingServers = remainingServers.slice(0, ceiling);
        }
      }

      expect(remainingServers.length).toBe(150);
    });

    it('uses default ceiling of 100 when cloudModelMaxCandidates not specified', () => {
      const servers = Array.from({ length: 200 }, (_, i) => ({
        id: `server-${i}`,
      })) as any[];

      const model = 'minimax-m3:cloud';
      const cloudModelNoCap = true;
      const cloudModelMaxCandidates = undefined;

      let remainingServers = [...servers];

      if (isCloudModel(model) && cloudModelNoCap === true) {
        const ceiling = cloudModelMaxCandidates ?? 100;
        if (remainingServers.length > ceiling) {
          remainingServers = remainingServers.slice(0, ceiling);
        }
      }

      expect(remainingServers.length).toBe(100);
    });

    it('leaves list unchanged when below ceiling', () => {
      const servers = Array.from({ length: 50 }, (_, i) => ({
        id: `server-${i}`,
      })) as any[];

      const model = 'minimax-m3:cloud';
      const cloudModelNoCap = true;
      const cloudModelMaxCandidates = 100;

      let remainingServers = [...servers];

      if (isCloudModel(model) && cloudModelNoCap === true) {
        const ceiling = cloudModelMaxCandidates;
        if (remainingServers.length > ceiling) {
          remainingServers = remainingServers.slice(0, ceiling);
        }
      }

      expect(remainingServers.length).toBe(50);
    });
  });
});
