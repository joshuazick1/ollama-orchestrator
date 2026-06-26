/**
 * K6 Base Load Test Script - Parameterized for all stress phases (B1-B4, C1-C3, C5)
 *
 * Supports custom VUs, duration, target URL, custom headers, and multi-model request patterns.
 * Run via: k6 run --vus 10 --duration 30s scripts/stress/k6-base.js
 *
 * Environment Variables:
 *   BASE_URL       - Target URL (default: http://localhost:5100)
 *   MODEL          - Model to test (default: llama3.2:3b)
 *   ENDPOINT       - Endpoint path (default: /api/chat)
 *   API_KEY        - Optional X-API-Key header
 *   RAMP_UP        - Ramp-up duration in seconds (default: 30s)
 *   STAGES         - JSON array of k6 stages (overrides VUS/duration if provided)
 *   PHASE          - Phase name for tagging (e.g., B1, C2)
 *   MAX_TOKENS     - max_tokens for chat/generate (default: 50)
 *   SLEEP_MIN      - Min sleep between iterations (default: 0.5)
 *   SLEEP_MAX      - Max sleep between iterations (default: 1.5)
 *
 * Output: k6 run --out json=scripts/stress/output/<name>.json scripts/stress/k6-base.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errors = new Rate('errors');
const response_time = new Trend('response_time');
const ttfb = new Trend('ttfb');

// Configuration from environment
const BASE_URL = __ENV.BASE_URL || 'http://localhost:5100';
const MODEL = __ENV.MODEL || 'llama3.2:3b';
const ENDPOINT = __ENV.ENDPOINT || '/api/chat';
const API_KEY = __ENV.API_KEY || '';
const PHASE = __ENV.PHASE || 'base';
const MAX_TOKENS = parseInt(__ENV.MAX_TOKENS || '50', 10);
const SLEEP_MIN = parseFloat(__ENV.SLEEP_MIN || '0.5');
const SLEEP_MAX = parseFloat(__ENV.SLEEP_MAX || '1.5');

// Request tags for filtering
const tags = {
  phase: PHASE,
  model: MODEL,
  endpoint: ENDPOINT,
};

// Build headers
function getHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }
  return headers;
}

// Build request body based on endpoint
function getRequestBody(endpoint, model, maxTokens) {
  switch (endpoint) {
    case '/api/chat':
      return JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: maxTokens,
        stream: false,
      });

    case '/api/generate':
      return JSON.stringify({
        model: model,
        prompt: 'Hello',
        max_tokens: maxTokens,
        stream: false,
      });

    case '/api/embeddings':
      return JSON.stringify({
        model: 'nomic-embed-text:latest',
        prompt: 'test',
      });

    case '/v1/chat/completions':
      return JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: maxTokens,
        stream: false,
      });

    case '/v1/embeddings':
      return JSON.stringify({
        model: model,
        input: 'test',
      });

    case '/v1/completions':
      return JSON.stringify({
        model: model,
        prompt: 'Hello',
        max_tokens: maxTokens,
        stream: false,
      });

    default:
      // Default to /api/chat format
      return JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: maxTokens,
        stream: false,
      });
  }
}

// Determine if endpoint uses OpenAI format
function isOpenAIFormat(endpoint) {
  return endpoint.startsWith('/v1/');
}

// Get URL with proper protocol
function getUrl(baseUrl, endpoint) {
  if (endpoint.startsWith('http')) {
    return endpoint;
  }
  if (!baseUrl.endsWith('/') && !endpoint.startsWith('/')) {
    return `${baseUrl}/${endpoint}`;
  }
  return `${baseUrl}${endpoint}`;
}

// Export options - configurable via CLI flags or env vars
export const options = {
  // Use stages if provided via STAGES env var, otherwise use CLI-provided vus/duration
  // Example STAGES env var: '[{"duration":"30s","target":10},{"duration":"1m","target":50}]'
  stages: __ENV.STAGES ? JSON.parse(__ENV.STAGES) : undefined,

  thresholds: {
    // Standard metrics
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
    // Custom metrics
    errors: ['rate<0.2'],
    response_time: ['p(95)<1500'],
    ttfb: ['p(95)<500'],
  },
};

// Main test function
export default function () {
  const url = getUrl(BASE_URL, ENDPOINT);
  const body = getRequestBody(ENDPOINT, MODEL, MAX_TOKENS);
  const headers = getHeaders();

  // Make request with TTFB tracking
  const startTime = Date.now();
  const res = http.post(url, body, {
    headers: headers,
    tags: tags,
  });

  // Track TTFB (time to first byte)
  const ttfbMs = Date.now() - startTime;
  ttfb.add(ttfbMs, tags);

  // Check response status
  const statusOk = check(res, {
    'status 200': r => r.status === 200,
    'has body': r => r.body && r.body.length > 0,
  });

  if (!statusOk) {
    errors.add(1, tags);
    console.error(`[${PHASE}] Request failed: ${res.status} ${res.body}`);
  } else {
    errors.add(0, tags);
  }

  // Track response time
  response_time.add(res.timings.duration, tags);

  // Sleep between iterations to simulate real traffic
  const sleepDuration = SLEEP_MIN + Math.random() * (SLEEP_MAX - SLEEP_MIN);
  sleep(sleepDuration);
}

// Handle summary output
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

// Helper for text summary (built into k6)
function textSummary(data, opts) {
  const indent = opts.indent || '';
  let summary = `${indent}K6 Load Test Summary\n`;
  summary += `${indent}==================\n\n`;

  if (data.metrics.http_reqs) {
    summary += `${indent}Total Requests: ${data.metrics.http_reqs.values.count}\n`;
  }
  if (data.metrics.http_req_duration) {
    summary += `${indent}Request Duration (avg): ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
    summary += `${indent}Request Duration (p95): ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  }
  if (data.metrics.http_req_failed) {
    summary += `${indent}Failed Requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
  }
  if (data.metrics.ttfb) {
    summary += `${indent}TTFB (avg): ${data.metrics.ttfb.values.avg.toFixed(2)}ms\n`;
    summary += `${indent}TTFB (p95): ${data.metrics.ttfb.values['p(95)'].toFixed(2)}ms\n`;
  }
  if (data.metrics.response_time) {
    summary += `${indent}Response Time (avg): ${data.metrics.response_time.values.avg.toFixed(2)}ms\n`;
  }
  if (data.metrics.vus) {
    summary += `${indent}VUs: ${data.metrics.vus.values.current}\n`;
  }

  return summary;
}
