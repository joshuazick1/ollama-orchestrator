/**
 * K6 Stress Test: System Limits Testing
 *
 * Tests system behavior under extreme load conditions.
 * Pushes the system beyond normal operating limits to find breaking points.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const highLoadErrors = new Rate('high_load_errors');

// Test configuration
export const options = {
  stages: [
    // Start with normal load
    { duration: '1m', target: 5 },
    // Gradually increase to high load
    { duration: '2m', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '2m', target: 100 },
    // Stress phase - maximum load
    { duration: '3m', target: 200 },
    // Recovery phase
    { duration: '2m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // Under stress, we expect higher latency but still reasonable error rates
    http_req_duration: ['p(95)<2000'], // 95% under 2s during stress
    http_req_failed: ['rate<0.3'], // Allow up to 30% errors during stress
    high_load_errors: ['rate<0.5'], // Custom metric for high load periods
  },
};

// Base URL for the orchestrator
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Stress test scenarios
const scenarios = [
  'tags', // Fast, informational requests
  'generate', // CPU-intensive inference
  'chat', // Conversation requests
  'embeddings', // Vector operations
  'mixed', // Random mix
];

export default function () {
  // Select scenario based on VU ID to distribute load patterns
  const scenario = scenarios[__VU % scenarios.length];

  switch (scenario) {
    case 'tags':
      performTagsStress();
      break;
    case 'generate':
      performGenerateStress();
      break;
    case 'chat':
      performChatStress();
      break;
    case 'embeddings':
      performEmbeddingsStress();
      break;
    case 'mixed':
      performMixedStress();
      break;
  }

  // Track high load errors (when response time > 1s)
  const isHighLoad =
    responseTime.values.length > 0 &&
    responseTime.values[responseTime.values.length - 1].value > 1000;
  if (isHighLoad) {
    highLoadErrors.add(errorRate.values[errorRate.values.length - 1].value);
  }

  // Shorter sleep during stress testing
  sleep(Math.random() * 0.5 + 0.1);
}

function performTagsStress() {
  // High-frequency informational requests
  const responses = [];
  for (let i = 0; i < 5; i++) {
    const response = http.get(`${BASE_URL}/api/tags`);
    responses.push(response);
    responseTime.add(response.timings.duration);
  }

  // Check that at least some requests succeed under stress
  const successCount = responses.filter(r => r.status === 200).length;
  check(responses[0], {
    'tags stress: at least 3/5 succeed': () => successCount >= 3,
    'tags stress: response time reasonable': r => r.timings.duration < 1000,
  }) || errorRate.add(1);
}

function performGenerateStress() {
  // CPU-intensive generation requests with varying prompt lengths
  const prompts = [
    'Hello',
    'Write a short story about a robot learning to paint.',
    'Explain quantum computing in simple terms.',
    'What are the benefits of renewable energy?',
  ];

  const prompt = prompts[Math.floor(Math.random() * prompts.length)];
  const payload = {
    model: 'smollm2:135m',
    prompt: prompt,
    stream: false,
    options: {
      temperature: 0.7,
      top_p: 0.9,
    },
  };

  const response = http.post(`${BASE_URL}/api/generate`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  check(response, {
    'generate stress: status ok': r => r.status === 200,
    'generate stress: has response': r => r.json().response,
    'generate stress: reasonable latency': r => r.timings.duration < 5000,
  }) || errorRate.add(1);

  responseTime.add(response.timings.duration);
}

function performChatStress() {
  // Conversation requests under stress
  const messages = [
    [{ role: 'user', content: 'Hi' }],
    [{ role: 'user', content: 'What is AI?' }],
    [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ],
  ];

  const messageHistory = messages[Math.floor(Math.random() * messages.length)];
  const payload = {
    model: 'smollm2:135m',
    messages: messageHistory,
    stream: false,
  };

  const response = http.post(`${BASE_URL}/api/chat`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  check(response, {
    'chat stress: status ok': r => r.status === 200,
    'chat stress: has message': r => r.json().message,
    'chat stress: reasonable latency': r => r.timings.duration < 3000,
  }) || errorRate.add(1);

  responseTime.add(response.timings.duration);
}

function performEmbeddingsStress() {
  // Vector embedding requests
  const documents = [
    'This is a short document.',
    'This is a longer document that contains more text and should require more processing time to embed properly.',
    'AI and machine learning are transforming industries across the globe.',
  ];

  const prompt = documents[Math.floor(Math.random() * documents.length)];
  const payload = {
    model: 'nomic-embed-text:latest',
    prompt: prompt,
  };

  const response = http.post(`${BASE_URL}/api/embeddings`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  check(response, {
    'embeddings stress: status ok': r => r.status === 200,
    'embeddings stress: has embedding': r =>
      r.json().embedding && Array.isArray(r.json().embedding),
    'embeddings stress: reasonable latency': r => r.timings.duration < 2000,
  }) || errorRate.add(1);

  responseTime.add(response.timings.duration);
}

function performMixedStress() {
  // Random mix of all request types
  const requestTypes = ['tags', 'generate', 'chat', 'embeddings'];
  const requestType = requestTypes[Math.floor(Math.random() * requestTypes.length)];

  switch (requestType) {
    case 'tags':
      performTagsStress();
      break;
    case 'generate':
      performGenerateStress();
      break;
    case 'chat':
      performChatStress();
      break;
    case 'embeddings':
      performEmbeddingsStress();
      break;
  }
}
