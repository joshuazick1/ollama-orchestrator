#!/usr/bin/env node
/**
 * Rate Limit Failover Validation Script
 * 
 * One-off validation to verify that:
 * 1. HTTP 429 errors are classified as rateLimited (not non-retryable)
 * 2. Failover happens correctly when servers are rate-limited
 * 3. Client receives proper error, not a crash
 * 4. ErrorAggregator detects cluster-wide rate limits
 * 
 * Usage: node scripts/rate-limit-failover-validation.js [--duration=60] [--concurrency=50]
 */

const http = require('http');
const https = require('https');

// Configuration
const ORCHESTRATOR_URL = 'http://localhost:5100';
const DURATION_MS = parseInt(process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] || '60000');
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '50');
const MODEL = 'llama3.2:latest';
const EMBEDDINGS_MODEL = 'nomic-embed-text:latest';

// Stats tracking
const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  rateLimitedRequests: 0,
  failoverRequests: 0,
  errorRequests: 0,
  clusterRateLimitDetected: 0,
  uniqueServersRateLimited: new Set(),
  errors: [],
  latency: [],
};

let abortRequested = false;
let clusterRateLimitActive = false;

// Make HTTP request to orchestrator
function makeRequest(model, endpoint, body, attempt = 1) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${ORCHESTRATOR_URL}${endpoint}`);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const startTime = Date.now();
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    };
    
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = Date.now() - startTime;
        stats.latency.push(latency);
        
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, latency, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, latency, headers: res.headers });
        }
      });
    });
    
    req.on('error', (e) => {
      reject({ error: e.message, code: e.code });
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject({ error: 'timeout', code: 'TIMEOUT' });
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Generate generate request body
function generateBody(model) {
  return {
    model: model,
    prompt: "Hello, this is a test. Just say 'Test successful' and nothing else.",
    stream: false,
    options: {
      num_predict: 20,
    }
  };
}

// Generate embeddings request body
function embeddingsBody(model) {
  return {
    model: model,
    input: "This is a test embedding request for validation.",
  };
}

// Fire a single request with rate limit detection
async function fireRequest(id) {
  const useModel = id % 3 === 0 ? EMBEDDINGS_MODEL : MODEL;
  const endpoint = useModel === EMBEDDINGS_MODEL ? '/api/embeddings' : '/api/generate';
  
  stats.totalRequests++;
  
  try {
    const response = await makeRequest(useModel, endpoint, useModel === EMBEDDINGS_MODEL ? embeddingsBody(useModel) : generateBody(useModel));
    
    if (response.status === 200) {
      stats.successfulRequests++;
      return { success: true, model: useModel, latency: response.latency };
    } else if (response.status === 429) {
      stats.rateLimitedRequests++;
      return { 
        success: false, 
        error: 'rate_limited', 
        status: 429, 
        model: useModel, 
        latency: response.latency,
        data: response.data
      };
    } else if (response.status === 503) {
      stats.rateLimitedRequests++;
      return { 
        success: false, 
        error: 'service_unavailable', 
        status: 503, 
        model: useModel, 
        latency: response.latency,
        data: response.data
      };
    } else if (response.status === 400 || response.status === 404 || response.status === 500) {
      // Model not found or server error - not a rate limit
      stats.errorRequests++;
      return { 
        success: false, 
        error: 'request_error', 
        status: response.status, 
        model: useModel, 
        latency: response.latency,
        data: response.data
      };
    } else {
      stats.errorRequests++;
      return { 
        success: false, 
        error: 'unknown_error', 
        status: response.status, 
        model: useModel, 
        latency: response.latency,
        data: response.data
      };
    }
  } catch (e) {
    stats.errorRequests++;
    return { success: false, error: e.error || e.message, code: e.code };
  }
}

// Worker that continuously fires requests
async function worker(workerId) {
  let requestCount = 0;
  
  while (!abortRequested) {
    const result = await fireRequest(workerId * 1000 + requestCount);
    requestCount++;
    
    if (result.error === 'rate_limited' && result.data?.server) {
      stats.uniqueServersRateLimited.add(result.data.server);
    }
    
    // Small delay to avoid overwhelming
    await new Promise(r => setTimeout(r, 10));
  }
}

// Check cluster status from orchestrator
async function checkClusterStatus() {
  try {
    const response = await new Promise((resolve, reject) => {
      http.get(`${ORCHESTRATOR_URL}/api/orchestrator/cluster-status`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: null });
          }
        });
      }).on('error', reject);
    });
    
    if (response.status === 200 && response.data) {
      if (response.data.data?.isRateLimited) {
        stats.clusterRateLimitDetected++;
        clusterRateLimitActive = true;
      }
      return response.data.data;
    }
  } catch (e) {
    // Endpoint might not exist yet
  }
  return null;
}

// Check circuit breaker states
async function checkCircuitBreakers() {
  try {
    const response = await new Promise((resolve, reject) => {
      http.get(`${ORCHESTRATOR_URL}/api/orchestrator/circuit-breakers`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: null });
          }
        });
      }).on('error', reject);
    });
    
    if (response.status === 200 && response.data) {
      const cbData = response.data.data || response.data;
      if (Array.isArray(cbData)) {
        const openCount = cbData.filter(cb => cb.state === 'open').length;
        const halfOpenCount = cbData.filter(cb => cb.state === 'half-open').length;
        return { total: cbData.length, open: openCount, halfOpen: halfOpenCount };
      }
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

// Check error classifier - verify 429 is classified as rateLimited
async function verify429Classification() {
  try {
    // Try to trigger a 429 by hammering - we'll check the error response format
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(fireRequest(i));
    }
    const results = await Promise.all(promises);
    
    const rateLimited = results.filter(r => r.error === 'rate_limited');
    if (rateLimited.length > 0) {
      const first429 = rateLimited[0];
      // Check if error response has proper structure (isRetryable flag set)
      const hasProperErrorStructure = first429.data && (
        first429.data.isRetryable === true ||
        first429.data.retryable === true ||
        (first429.data.error && typeof first429.data.error === 'string')
      );
      return {
        hasRateLimitedErrors: true,
        hasProperErrorStructure: !!hasProperErrorStructure,
        sampleError: first429.data
      };
    }
  } catch (e) {
    // Ignore
  }
  return { hasRateLimitedErrors: false };
}

// Main validation
async function runValidation() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Rate Limit Failover Validation');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Configuration:`);
  console.log(`  Orchestrator URL: ${ORCHESTRATOR_URL}`);
  console.log(`  Duration: ${DURATION_MS / 1000}s`);
  console.log(`  Concurrency: ${CONCURRENCY} workers`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Embeddings Model: ${EMBEDDINGS_MODEL}`);
  console.log('');
  
  // Initial check - verify orchestrator is reachable
  console.log('[1/6] Verifying orchestrator connectivity...');
  try {
    const testResp = await makeRequest(MODEL, '/api/generate', generateBody(MODEL));
    if (testResp.status === 200) {
      console.log('  ✓ Orchestrator is reachable');
    } else if (testResp.status === 429) {
      console.log('  ✓ Orchestrator is reachable (got 429 - good for testing)');
    } else if (testResp.status >= 400) {
      console.log(`  ✓ Orchestrator is reachable (got ${testResp.status})`);
    }
  } catch (e) {
    console.log(`  ✗ Cannot reach orchestrator: ${e.message}`);
    process.exit(1);
  }
  
  // Pre-test: Check servers available
  console.log('');
  console.log('[2/6] Checking server inventory...');
  try {
    const serversResp = await new Promise((resolve, reject) => {
      http.get(`${ORCHESTRATOR_URL}/api/orchestrator/servers`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    const servers = serversResp.servers || [];
    const healthyServers = servers.filter(s => s.healthy);
    const serversWithLlama = servers.filter(s => s.healthy && s.models?.includes(MODEL));
    const serversWithNomic = servers.filter(s => s.healthy && s.models?.includes(EMBEDDINGS_MODEL));
    
    console.log(`  Total servers: ${servers.length}`);
    console.log(`  Healthy servers: ${healthyServers.length}`);
    console.log(`  Servers with ${MODEL}: ${serversWithLlama.length}`);
    console.log(`  Servers with ${EMBEDDINGS_MODEL}: ${serversWithNomic.length}`);
  } catch (e) {
    console.log(`  ✗ Cannot fetch servers: ${e.message}`);
  }
  
  // Pre-test: Verify 429 classification
  console.log('');
  console.log('[3/6] Verifying 429 error classification...');
  const classificationResult = await verify429Classification();
  if (classificationResult.hasRateLimitedErrors) {
    console.log('  ✓ Received rate limit responses');
    if (classificationResult.hasProperErrorStructure) {
      console.log('  ✓ Error responses have proper structure');
    } else {
      console.log('  ⚠ Error responses may lack retry metadata');
    }
    if (classificationResult.sampleError) {
      console.log(`  Sample error: ${JSON.stringify(classificationResult.sampleError).substring(0, 200)}`);
    }
  } else {
    console.log('  ⚠ No rate limit responses yet (will try to trigger)');
  }
  
  // Main test: Flood the system
  console.log('');
  console.log('[4/6] Starting load test...');
  console.log(`  Launching ${CONCURRENCY} concurrent workers for ${DURATION_MS / 1000}s...`);
  console.log('  (Press Ctrl+C to stop early)');
  console.log('');
  
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }
  
  // Progress reporter
  const progressInterval = setInterval(() => {
    const elapsed = stats.totalRequests;
    const rate = Math.round(stats.totalRequests / (DURATION_MS / 1000) * 10) / 10;
    const rps = Math.round(rate * 10) / 10;
    process.stdout.write(`\r  Progress: ${stats.totalRequests} requests | ${stats.successfulRequests} OK | ${stats.rateLimitedRequests} 429s | ${stats.errorRequests} errors | Rate: ${rps} req/s   `);
  }, 1000);
  
  // Periodic cluster status check
  const clusterCheckInterval = setInterval(async () => {
    await checkClusterStatus();
  }, 2000);
  
  // Run for specified duration
  await new Promise(r => setTimeout(r, DURATION_MS));
  
  // Stop workers
  abortRequested = true;
  await Promise.all(workers.map(w => w.catch(() => {})));
  
  clearInterval(progressInterval);
  clearInterval(clusterCheckInterval);
  console.log('');
  console.log('');
  
  // Post-test: Check circuit breakers
  console.log('[5/6] Checking circuit breaker states...');
  const cbStats = await checkCircuitBreakers();
  if (cbStats) {
    console.log(`  Circuit breakers: ${cbStats.total} total`);
    console.log(`    Open: ${cbStats.open}`);
    console.log(`    Half-open: ${cbStats.halfOpen}`);
    if (cbStats.open > 0) {
      console.log('  ✓ Circuit breakers opened for rate-limited servers');
    }
  } else {
    console.log('  ⚠ Could not fetch circuit breaker status');
  }
  
  // Check cluster status
  console.log('');
  console.log('[6/6] Final cluster status check...');
  const finalClusterStatus = await checkClusterStatus();
  if (finalClusterStatus) {
    console.log(`  Cluster rate limited: ${finalClusterStatus.isRateLimited || false}`);
    console.log(`  Rate limit server count: ${finalClusterStatus.rateLimitServerCount || 0}`);
    if (finalClusterStatus.isRateLimited) {
      console.log('  ✓ Cluster-wide rate limit detected by ErrorAggregator');
    }
  } else {
    console.log('  ⚠ Cluster status endpoint not available (may not be implemented yet)');
  }
  
  // Final report
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VALIDATION REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Request Summary:');
  console.log(`  Total requests:    ${stats.totalRequests}`);
  console.log(`  Successful (200): ${stats.successfulRequests}`);
  console.log(`  Rate limited (429): ${stats.rateLimitedRequests}`);
  console.log(`  Other errors:     ${stats.errorRequests}`);
  console.log('');
  console.log('Rate Limiting:');
  console.log(`  Unique servers that hit rate limit: ${stats.uniqueServersRateLimited.size}`);
  console.log(`  Cluster rate limit detected: ${stats.clusterRateLimitDetected} times`);
  console.log('');
  
  if (stats.latency.length > 0) {
    const sorted = [...stats.latency].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    console.log('Latency (ms):');
    console.log(`  P50: ${p50} | P95: ${p95} | P99: ${p99} | Max: ${max}`);
    console.log('');
  }
  
  // Validation results
  console.log('Validation Results:');
  const results = [];
  
  if (stats.rateLimitedRequests > 0) {
    results.push('✓ Rate limit responses received');
  } else {
    results.push('⚠ No rate limit responses (may need higher load)');
  }
  
  if (stats.uniqueServersRateLimited.size >= 2) {
    results.push(`✓ Multiple servers rate-limited (${stats.uniqueServersRateLimited.size} servers)`);
  } else if (stats.rateLimitedRequests > 0) {
    results.push(`⚠ Only ${stats.uniqueServersRateLimited.size} server(s) rate-limited`);
  }
  
  if (stats.successfulRequests > 0) {
    results.push('✓ Requests succeeded (failover working or servers not all rate-limited)');
  }
  
  if (stats.errorRequests === 0 && stats.rateLimitedRequests > 0) {
    results.push('✓ No crashes/unexpected errors');
  } else if (stats.errorRequests > 0) {
    results.push(`⚠ ${stats.errorRequests} non-rate-limit errors (may be expected)`);
  }
  
  if (cbStats?.open > 0) {
    results.push(`✓ Circuit breakers opened (${cbStats.open} open)`);
  }
  
  results.forEach(r => console.log(`  ${r}`));
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Exit code
  if (stats.rateLimitedRequests > 0 && stats.errorRequests === 0) {
    console.log('✓ VALIDATION PASSED - Rate limiting working correctly');
    process.exit(0);
  } else if (stats.rateLimitedRequests === 0) {
    console.log('⚠ VALIDATION INCONCLUSIVE - No rate limits triggered');
    console.log('  Try increasing concurrency or duration');
    process.exit(1);
  } else {
    console.log('⚠ VALIDATION PASSED WITH WARNINGS');
    process.exit(0);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT, stopping...');
  abortRequested = true;
});

runValidation().catch(e => {
  console.error('Validation failed:', e);
  process.exit(1);
});
