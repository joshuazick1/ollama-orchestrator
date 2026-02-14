/**
 * K6 Soak Test: Long-Running Stability Testing
 *
 * Tests system stability over extended periods under moderate load.
 * Identifies memory leaks, performance degradation, and other issues
 * that only manifest over time.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const memoryTrend = new Trend('memory_usage');

// Test configuration
export const options = {
  stages: [
    // Ramp up to moderate load
    { duration: '5m', target: 10 },
    // Sustained load for extended period (2 hours in real scenarios)
    { duration: '30m', target: 10 },
    // Ramp down
    { duration: '5m', target: 0 },
  ],
  thresholds: {
    // Soak tests focus on stability over time
    http_req_duration: ['p(95)<1000'], // Consistent performance
    http_req_failed: ['rate<0.05'], // Very low error rate
    // Custom threshold for detecting performance degradation
    'response_time{p(95)}': ['max<1500'], // No significant slowdown
  },
};

// Base URL for the orchestrator
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Track performance over time
let requestCount = 0;
const performanceWindows = [];

export default function () {
  requestCount++;

  // Periodic performance checks
  if (requestCount % 100 === 0) {
    checkSystemHealth();
  }

  // Mix of request types to simulate realistic usage
  const requestType = getWeightedRandomRequestType();

  switch (requestType) {
    case 'tags':
      performTagsRequest();
      break;
    case 'generate':
      performGenerateRequest();
      break;
    case 'chat':
      performChatRequest();
      break;
    case 'embeddings':
      performEmbeddingsRequest();
      break;
    case 'ps':
      performPsRequest();
      break;
  }

  // Simulate realistic user behavior with varying think times
  sleep(getRandomThinkTime());
}

function getWeightedRandomRequestType() {
  // Weighted distribution based on typical API usage patterns
  const weights = {
    tags: 40, // Most common - checking available models
    generate: 30, // Text generation
    chat: 20, // Chat completions
    embeddings: 8, // Vector embeddings
    ps: 2, // Process status (rare)
  };

  const random = Math.random() * 100;
  let cumulative = 0;

  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (random <= cumulative) {
      return type;
    }
  }

  return 'tags'; // fallback
}

function getRandomThinkTime() {
  // Simulate user think time: mostly 1-5 seconds, occasional longer pauses
  const rand = Math.random();
  if (rand < 0.7) {
    return 1 + Math.random() * 4; // 1-5 seconds (70% of requests)
  } else if (rand < 0.9) {
    return 5 + Math.random() * 10; // 5-15 seconds (20% of requests)
  } else {
    return 15 + Math.random() * 30; // 15-45 seconds (10% of requests)
  }
}

function performTagsRequest() {
  const startTime = new Date().getTime();

  const response = http.get(`${BASE_URL}/api/tags`);

  const duration = new Date().getTime() - startTime;

  check(response, {
    'soak tags: status 200': r => r.status === 200,
    'soak tags: has models': r => r.json().models && Array.isArray(r.json().models),
    'soak tags: reasonable time': r => r.timings.duration < 500,
    'soak tags: no degradation': r => checkPerformanceDegradation('tags', duration),
  }) || errorRate.add(1);

  responseTime.add(duration);
}

function performGenerateRequest() {
  const prompts = [
    'Explain what a neural network is.',
    'Write a haiku about programming.',
    'What are the benefits of exercise?',
    'Describe how photosynthesis works.',
    'What is the meaning of life?',
  ];

  const payload = {
    model: 'smollm2:135m',
    prompt: prompts[Math.floor(Math.random() * prompts.length)],
    stream: false,
    options: {
      temperature: 0.7,
      num_predict: 100, // Limit response length for soak testing
    },
  };

  const startTime = new Date().getTime();

  const response = http.post(`${BASE_URL}/api/generate`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const duration = new Date().getTime() - startTime;

  check(response, {
    'soak generate: status 200': r => r.status === 200,
    'soak generate: has response': r => r.json().response,
    'soak generate: reasonable time': r => r.timings.duration < 3000,
    'soak generate: no degradation': r => checkPerformanceDegradation('generate', duration),
  }) || errorRate.add(1);

  responseTime.add(duration);
}

function performChatRequest() {
  const conversations = [
    [{ role: 'user', content: 'Hello!' }],
    [{ role: 'user', content: 'How does AI work?' }],
    [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello! How can I help you?' },
      { role: 'user', content: 'Tell me a joke' },
    ],
  ];

  const messages = conversations[Math.floor(Math.random() * conversations.length)];
  const payload = {
    model: 'smollm2:135m',
    messages: messages,
    stream: false,
  };

  const startTime = new Date().getTime();

  const response = http.post(`${BASE_URL}/api/chat`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const duration = new Date().getTime() - startTime;

  check(response, {
    'soak chat: status 200': r => r.status === 200,
    'soak chat: has message': r => r.json().message,
    'soak chat: reasonable time': r => r.timings.duration < 2500,
    'soak chat: no degradation': r => checkPerformanceDegradation('chat', duration),
  }) || errorRate.add(1);

  responseTime.add(duration);
}

function performEmbeddingsRequest() {
  const texts = [
    'This is a test document.',
    'Machine learning is a subset of artificial intelligence.',
    'The quick brown fox jumps over the lazy dog.',
  ];

  const payload = {
    model: 'nomic-embed-text:latest',
    prompt: texts[Math.floor(Math.random() * texts.length)],
  };

  const startTime = new Date().getTime();

  const response = http.post(`${BASE_URL}/api/embeddings`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const duration = new Date().getTime() - startTime;

  check(response, {
    'soak embeddings: status 200': r => r.status === 200,
    'soak embeddings: has embedding': r => r.json().embedding && Array.isArray(r.json().embedding),
    'soak embeddings: reasonable time': r => r.timings.duration < 1000,
    'soak embeddings: no degradation': r => checkPerformanceDegradation('embeddings', duration),
  }) || errorRate.add(1);

  responseTime.add(duration);
}

function performPsRequest() {
  const response = http.get(`${BASE_URL}/api/ps`);

  check(response, {
    'soak ps: status 200': r => r.status === 200,
    'soak ps: has processes': r => r.json().models || Array.isArray(r.json().models),
  }) || errorRate.add(1);

  responseTime.add(response.timings.duration);
}

function checkSystemHealth() {
  // Periodic health checks
  const healthResponse = http.get(`${BASE_URL}/api/tags`);
  check(healthResponse, {
    'system health: api reachable': r => r.status === 200,
    'system health: returns data': r => r.json().models && r.json().models.length > 0,
  });

  // Track performance windows for degradation detection
  const currentWindow = {
    timestamp: new Date().getTime(),
    avgResponseTime: responseTime.values.slice(-50).reduce((sum, v) => sum + v.value, 0) / 50,
    errorRate: errorRate.values.slice(-50).reduce((sum, v) => sum + v.value, 0) / 50,
  };

  performanceWindows.push(currentWindow);

  // Keep only last 10 windows
  if (performanceWindows.length > 10) {
    performanceWindows.shift();
  }
}

function checkPerformanceDegradation(requestType, currentDuration) {
  // Check if performance is degrading over time
  if (performanceWindows.length < 3) {
    return true; // Not enough data yet
  }

  // Get recent performance windows
  const recent = performanceWindows.slice(-3);
  const avgRecent = recent.reduce((sum, w) => sum + w.avgResponseTime, 0) / recent.length;

  // Allow 20% degradation before flagging
  const threshold = avgRecent * 1.2;

  return currentDuration <= threshold;
}
