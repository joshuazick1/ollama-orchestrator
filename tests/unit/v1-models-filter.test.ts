import { describe, it, expect } from 'vitest';
import { filterValidModels } from '../../src/utils/model-validator.js';

describe('v1-models filter (B17)', () => {
  it('filterValidModels removes attack/cloud patterns', () => {
    const clean = ['llama3', 'mistral'];
    const dirty = ['http://evil.com', '192.168.1.1', 'payload:cloud', 'exploit-kit'];
    const result = filterValidModels([...clean, ...dirty]);
    expect(result).toEqual(clean);
  });

  it('keepValidModels passes a real-world mix', () => {
    const models = [
      'llama3.2:3b',
      'qwen2.5:7b',
      'malicious:shell',
      'nemo:12b',
      'http://phishing.com',
      'installs.sh',
      'gemma2:27b',
    ];
    const result = filterValidModels(models);
    expect(result).toEqual([
      'llama3.2:3b',
      'qwen2.5:7b',
      'malicious:shell',
      'nemo:12b',
      'gemma2:27b',
    ]);
  });
});
