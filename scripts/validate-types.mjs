#!/usr/bin/env node
/**
 * validate-types.js
 * Validates that frontend types align with backend types
 * Run this in CI to catch drift
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const FRONTEND_TYPES_PATH = join(process.cwd(), 'frontend/src/types.ts');
const BACKEND_TYPES_PATH = join(process.cwd(), 'src/orchestrator.types.ts');

const FRONTEND_TYPES_TO_CHECK = [
  'AIServer',
  'ServerModelMetrics',
  'MetricsWindow',
  'LatencyPercentiles',
  'TimeWindow',
  'CircuitBreakerState',
];

// Patterns to match (interface OR type)
const TYPE_PATTERNS = [/export interface NAME\s*\{/, /export type NAME\s*=/];

console.log('Checking frontend-backend type alignment...\n');

const frontendTypes = readFileSync(FRONTEND_TYPES_PATH, 'utf-8');
const backendTypes = readFileSync(BACKEND_TYPES_PATH, 'utf-8');

let hasIssues = false;

for (const type of FRONTEND_TYPES_TO_CHECK) {
  const patterns = TYPE_PATTERNS.map(p => new RegExp(p.source.replace('NAME', type)));

  const frontendMatch = patterns.some(p => p.test(frontendTypes));
  const backendMatch = patterns.some(p => p.test(backendTypes));

  if (frontendMatch && !backendMatch) {
    console.log(`⚠️  ${type} exists in frontend but not in backend`);
    hasIssues = true;
  } else if (!frontendMatch && backendMatch) {
    console.log(`💡 ${type} exists in backend but not in frontend (consider importing)`);
  } else if (!frontendMatch && !backendMatch) {
    console.log(`❌ ${type} not found in either frontend or backend`);
    hasIssues = true;
  } else {
    console.log(`✅ ${type} exists in both (manual sync required)`);
  }
}

if (hasIssues) {
  console.log('\n❌ Type alignment issues found');
  process.exit(1);
} else {
  console.log('\n✅ Type alignment check passed');
}
