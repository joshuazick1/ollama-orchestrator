/**
 * K6 Load Test: Basic Load Testing
 *
 * Tests system performance under normal and peak load conditions.
 * Simulates realistic user traffic patterns.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

// Test configuration
export const options = {
  stages: [
    // Ramp up to normal load
    { duration: '2m', target: 10 },
    // Stay at normal load
    { duration: '5m', target: 10 },
    // Ramp up to peak load
    { duration: '2m', target: 50 },
    // Stay at peak load
    { duration: '5m', target: 50 },
    // Ramp down
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.1'], // Error rate should be below 10%
  },
};

// Base URL for the orchestrator
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Mock servers to test against
const mockServers = [
  { url: 'http://localhost:11440', healthy: true },
  { url: 'http://localhost:11441', healthy: true },
  { url: 'http://localhost:11442', healthy: true },
];

export default function () {
  // Simulate different types of requests that would go through the orchestrator

  // 1. API tags requests (most common)
  const tagsResponse = http.get(`${BASE_URL}/api/tags`);
  check(tagsResponse, {
    'tags status is 200': r => r.status === 200,
    'tags response time < 300ms': r => r.timings.duration < 300,
    'tags has models array': r => r.json().models && Array.isArray(r.json().models),
  }) || errorRate.add(1);

  responseTime.add(tagsResponse.timings.duration);

  // 2. Generate requests (inference requests)
  const generatePayload = {
    model: 'smollm2:135m',
    prompt: 'Hello, how are you?',
    stream: false,
  };

  const generateResponse = http.post(`${BASE_URL}/api/generate`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(generatePayload),
  });

  check(generateResponse, {
    'generate status is 200': r => r.status === 200,
    'generate response time < 2000ms': r => r.timings.duration < 2000,
    'generate has response': r => r.json().response,
  }) || errorRate.add(1);

  responseTime.add(generateResponse.timings.duration);

  // 3. Chat requests (conversation)
  const chatPayload = {
    model: 'smollm2:135m',
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
    stream: false,
  };

  const chatResponse = http.post(`${BASE_URL}/api/chat`, {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chatPayload),
  });

  check(chatResponse, {
    'chat status is 200': r => r.status === 200,
    'chat response time < 1500ms': r => r.timings.duration < 1500,
    'chat has message': r => r.json().message,
  }) || errorRate.add(1);

  responseTime.add(chatResponse.timings.duration);

  // 4. Embeddings requests (less frequent)
  if (Math.random() < 0.3) {
    // Only 30% of iterations
    const embeddingsPayload = {
      model: 'nomic-embed-text:latest',
      prompt: 'This is a test document for embeddings.',
    };

    const embeddingsResponse = http.post(`${BASE_URL}/api/embeddings`, {
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(embeddingsPayload),
    });

    check(embeddingsResponse, {
      'embeddings status is 200': r => r.status === 200,
      'embeddings response time < 1000ms': r => r.timings.duration < 1000,
      'embeddings has embedding array': r =>
        r.json().embedding && Array.isArray(r.json().embedding),
    }) || errorRate.add(1);

    responseTime.add(embeddingsResponse.timings.duration);
  }

  // Random sleep between 1-3 seconds to simulate user think time
  sleep(Math.random() * 2 + 1);
}
