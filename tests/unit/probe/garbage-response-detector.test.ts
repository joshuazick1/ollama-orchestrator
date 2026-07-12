import { describe, it, expect } from 'vitest';

import {
  detectGarbageResponse,
  DEFAULT_GARBAGE_DETECTOR_CONFIG,
  type GarbageDetectorConfig,
} from '../../../src/probe/garbage-response-detector.js';

describe('GarbageResponseDetector', () => {
  describe('signal: cjk-overrun', () => {
    it('fires when response is mostly CJK and prompt is clearly non-CJK', () => {
      const prompt = 'Write a short story about a robot.';
      const response = '这是一个关于机器人的故事。它很强壮很勇敢。'.repeat(10);
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).toContain('cjk-overrun');
      expect(result.isGarbage).toBe(true);
    });

    it('does NOT fire when prompt itself contains CJK', () => {
      const prompt = '写一个关于机器人的短故事';
      const response = '这是一个关于机器人的故事。'.repeat(10);
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).not.toContain('cjk-overrun');
    });

    it('does NOT fire when prompt is null', () => {
      const response = '这是一个关于机器人的故事。'.repeat(10);
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('cjk-overrun');
    });

    it('does NOT fire on legitimate multilingual response with mixed Latin prompt', () => {
      const prompt = 'Explain quantum physics in simple terms. 解释量子物理学.';
      const response = '量子物理学是描述微观粒子行为的科学。The basic idea is that particles can behave like waves.';
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).not.toContain('cjk-overrun');
    });
  });

  describe('signal: high-profanity', () => {
    it('fires when profanity token ratio exceeds threshold', () => {
      const response = 'fuck shit damn hell'.repeat(5);
      const result = detectGarbageResponse(response, null);
      expect(result.signals).toContain('high-profanity');
    });

    it('does not fire on low-density profanity below threshold', () => {
      const response = 'The weather is nice today. damn it.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('high-profanity');
    });

    it('matches whole words only, case-insensitively', () => {
      const response = 'What the fuck is going on. That is bullshit.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).toContain('high-profanity');
    });

    it('does not fire on clean text', () => {
      const response = 'The quick brown fox jumps over the lazy dog. This is a perfectly normal sentence.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('high-profanity');
    });
  });

  describe('signal: repetition-loop', () => {
    it('fires when a 4-gram repeats 3 or more times', () => {
      const response = 'the quick brown fox the quick brown fox the quick brown fox';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).toContain('repetition-loop');
    });

    it('does not fire when repetition count is below threshold', () => {
      const response = 'the quick brown fox the quick brown fox hello world';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('repetition-loop');
    });

    it('does not fire on natural text with occasional repeated phrases', () => {
      const response =
        'The theory of general relativity was developed by Albert Einstein. ' +
        'It describes the gravitational force as a curvature of spacetime. ' +
        'General relativity has been confirmed by many experiments.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('repetition-loop');
    });
  });

  describe('signal: mostly-control-chars', () => {
    it('fires when control char ratio exceeds threshold', () => {
      const response = 'a\x00b\x01c\x02d\x03e\x04f\x05g\x06h\x07'.repeat(5);
      const result = detectGarbageResponse(response, null);
      expect(result.signals).toContain('mostly-control-chars');
    });

    it('does not fire on normal text with newlines and tabs', () => {
      const response = 'Hello world\n\tThis is a test.\nAnother line.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('mostly-control-chars');
    });

    it('does not fire when control chars are below threshold', () => {
      const response = 'Normal text with one control char\x00 at the end.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('mostly-control-chars');
    });
  });

  describe('signal: near-empty', () => {
    it('fires when non-whitespace char count is below minimum', () => {
      const response = '   hi   ';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).toContain('near-empty');
    });

    it('does not fire on response with enough non-whitespace chars', () => {
      const response = 'This is a reasonable response with enough characters.';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('near-empty');
    });

    it('fires on empty string', () => {
      const result = detectGarbageResponse('', null);
      expect(result.signals).toContain('near-empty');
    });
  });

  describe('signal: token-storm', () => {
    it('fires when response is 5x longer than a non-trivial prompt', () => {
      const prompt = 'What is the capital of France and what are the main attractions that tourists should visit while there?';
      const response = Array.from({ length: 200 }, (_, i) => `Item number ${i + 1}: Paris.`).join(' ');
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).toContain('token-storm');
    });

    it('does not fire when prompt is trivial (under 50 non-whitespace chars)', () => {
      const prompt = 'Hi';
      const response = 'Hello '.repeat(100);
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).not.toContain('token-storm');
    });

    it('does not fire when response length is proportional to prompt', () => {
      const prompt = 'Write a detailed explanation of photosynthesis including the chemical equations.';
      const response =
        'Photosynthesis is the process by which green plants convert light energy into chemical energy. ' +
        'The overall equation is: 6CO2 + 6H2O + light energy → C6H12O6 + 6O2. ' +
        'This occurs in the chloroplasts of plant cells.';
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).not.toContain('token-storm');
    });

    it('does not fire when prompt is null', () => {
      const response = 'x'.repeat(10000);
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('token-storm');
    });
  });

  describe('decision rule: isGarbage', () => {
    it('is false when fewer than 2 signals fire', () => {
      const response = 'The weather is nice today. damn it.';
      const result = detectGarbageResponse(response, null);
      if (result.signals.length < 2) {
        expect(result.isGarbage).toBe(false);
      }
    });

    it('is true when 2 or more signals fire', () => {
      const response = 'fuck';
      const result = detectGarbageResponse(response, null);
      expect(result.signals.length).toBeGreaterThanOrEqual(2);
      expect(result.isGarbage).toBe(true);
    });

    it('single signal alone is enough for diagnostic signals (cjk-overrun)', () => {
      const prompt = 'Write a story about a cat.';
      const response = '这是一个关于猫的故事。'.repeat(3);
      const result = detectGarbageResponse(response, prompt);
      expect(result.signals).toContain('cjk-overrun');
      expect(result.isGarbage).toBe(true);
    });
  });

  describe('qwen3.6 incident scenario', () => {
    it('detects garbage response with high confidence when English prompt gets Chinese profanity', () => {
      const prompt = 'What is machine learning?';
      const response =
        '傻逼玩意儿滚蛋吧混蛋去你妈的王八蛋滚 '.repeat(10) + 'fuck shit damn hell '.repeat(5);
      const result = detectGarbageResponse(response, prompt);
      expect(result.isGarbage).toBe(true);
      expect(result.signals).toContain('cjk-overrun');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.evidence).not.toBeNull();
    });

    it('detects garbage when Chinese profanity response also triggers token-storm', () => {
      const prompt = 'What is machine learning and what are its key applications in modern AI systems?';
      const response = '狗屎废物去死吧混账王八蛋'.repeat(30);
      const result = detectGarbageResponse(response, prompt);
      expect(result.isGarbage).toBe(true);
      expect(result.signals).toContain('cjk-overrun');
    });
  });

  describe('legitimate responses', () => {
    it('does not flag a normal Llama-style response', () => {
      const prompt = 'Explain why the sky is blue.';
      const response =
        'The sky appears blue because of a phenomenon called Rayleigh scattering. ' +
        'Shorter wavelengths of light (blue) are scattered in all directions by molecules ' +
        'in the atmosphere much more efficiently than longer wavelengths. ' +
        'This is why we see a blue sky during the day.';
      const result = detectGarbageResponse(response, prompt);
      expect(result.isGarbage).toBe(false);
      expect(result.signals).toHaveLength(0);
    });

    it('does not flag a normal Mistral response', () => {
      const prompt = 'What are the benefits of exercise?';
      const response =
        'Regular exercise provides numerous health benefits including improved cardiovascular health, ' +
        'stronger muscles and bones, better mental health, and reduced risk of chronic diseases.';
      const result = detectGarbageResponse(response, prompt);
      expect(result.isGarbage).toBe(false);
    });

    it('does not flag a GPT-style structured response', () => {
      const prompt = 'List three planets in the solar system.';
      const response = '1. Mercury\n2. Venus\n3. Earth';
      const result = detectGarbageResponse(response, prompt);
      expect(result.isGarbage).toBe(false);
    });

    it('does not flag a long valid essay', () => {
      const prompt = 'Write an essay about the history of the internet.';
      const response =
        'The Internet began as ARPANET in the 1960s, funded by the US Department of Defense. ' +
        'It was designed to allow computers to communicate across universities and research institutions. ' +
        'In the 1980s, TCP/IP became the standard protocol, and the World Wide Web was invented by Tim Berners-Lee in 1989. ' +
        'The 1990s saw the explosion of consumer internet access through dial-up modems. ' +
        'Today, the internet connects billions of devices worldwide.';
      const result = detectGarbageResponse(response, prompt);
      expect(result.isGarbage).toBe(false);
    });

    it('does not flag intentional 4-gram repetition below threshold', () => {
      const response = 'the quick brown fox the quick brown fox hello world goodbye world';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).not.toContain('repetition-loop');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = detectGarbageResponse('', null);
      expect(result.signals).toContain('near-empty');
      expect(result.isGarbage).toBe(false);
    });

    it('handles single word response', () => {
      const result = detectGarbageResponse('Hello', null);
      expect(result.signals).toContain('near-empty');
    });

    it('handles response with only control characters', () => {
      const response = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a';
      const result = detectGarbageResponse(response, null);
      expect(result.signals).toContain('mostly-control-chars');
      expect(result.signals).toContain('near-empty');
    });

    it('handles Unicode surrogate pairs correctly', () => {
      const response = 'Hello 😀 World 🌍 Test 🔥'.repeat(5);
      const result = detectGarbageResponse(response, null);
      expect(result.isGarbage).toBe(false);
    });
  });

  describe('config overrides', () => {
    it('custom cjkThreshold changes cjk-overrun behaviour', () => {
      const prompt = 'Write a story.';
      const response = '这是一个关于机器人的故事。'.repeat(3);
      const config: GarbageDetectorConfig = { cjkThreshold: 0.3 };
      const result = detectGarbageResponse(response, prompt, config);
      expect(result.signals).toContain('cjk-overrun');
    });

    it('custom repetitionCount changes repetition-loop behaviour', () => {
      const response = 'the quick brown fox the quick brown fox the quick brown fox';
      const config: GarbageDetectorConfig = { repetitionCount: 4 };
      const result = detectGarbageResponse(response, null, config);
      expect(result.signals).not.toContain('repetition-loop');
    });

    it('custom minCharsForAnalysis changes near-empty behaviour', () => {
      const response = 'This is a short response.';
      const config: GarbageDetectorConfig = { minCharsForAnalysis: 50 };
      const result = detectGarbageResponse(response, null, config);
      expect(result.signals).toContain('near-empty');
    });

    it('custom tokenStormRatio changes token-storm behaviour', () => {
      const prompt = 'What is AI?';
      const response = 'AI stands for Artificial Intelligence. '.repeat(20);
      const config: GarbageDetectorConfig = { tokenStormRatio: 50 };
      const result = detectGarbageResponse(response, prompt, config);
      expect(result.signals).not.toContain('token-storm');
    });
  });

  describe('DEFAULT_GARBAGE_DETECTOR_CONFIG', () => {
    it('matches the default values used in the implementation', () => {
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.cjkThreshold).toBe(0.6);
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.profanityThreshold).toBe(0.15);
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.repetitionNgram).toBe(4);
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.repetitionCount).toBe(3);
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.controlCharThreshold).toBe(0.1);
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.minCharsForAnalysis).toBe(20);
      expect(DEFAULT_GARBAGE_DETECTOR_CONFIG.tokenStormRatio).toBe(5);
    });
  });

  describe('evidence field', () => {
    it('returns first 200 chars of response as evidence when signals fire', () => {
      const response = 'fuck '.repeat(50);
      const result = detectGarbageResponse(response, null);
      expect(result.evidence).toBe('fuck '.repeat(50).slice(0, 200));
    });

    it('returns null evidence when no signals fire', () => {
      const response = 'This is a perfectly normal response.';
      const result = detectGarbageResponse(response, null);
      expect(result.evidence).toBeNull();
    });

    it('returns full response as evidence when shorter than 200 chars', () => {
      const response = 'Short response.';
      const result = detectGarbageResponse(response, null);
      expect(result.evidence).toBe('Short response.');
    });
  });

  describe('confidence score', () => {
    it('computes confidence as sum of weights / max possible', () => {
      const response = 'fuck';
      const result = detectGarbageResponse(response, null);
      expect(result.confidence).toBeCloseTo(0.25, 2);
    });

    it('caps confidence at 1.0', () => {
      const response = 'fuck';
      const result = detectGarbageResponse(response, null);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});
