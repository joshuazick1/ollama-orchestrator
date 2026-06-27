#!/usr/bin/env ts-node

/**
 * test-circuit-breakers.ts
 * Script to test circuit breaker functionality by making many requests to force timeouts
 */

const ORCHESTRATOR_URL = 'http://localhost:5100';

interface ModelMapResponse {
  success: boolean;
  modelToServers: Record<string, string[]>;
  serverToModels: Record<string, string[]>;
  totalModels: number;
  totalServers: number;
}

interface CircuitBreakerStatus {
  serverId: string;
  state: string;
  failureCount: number;
  successCount: number;
  lastFailure: number;
  lastSuccess: number;
  nextRetryAt: number;
  errorRate: number;
  errorCounts: Record<string, number>;
  consecutiveSuccesses: number;
}

interface CircuitBreakersResponse {
  success: boolean;
  circuitBreakers: CircuitBreakerStatus[];
}

async function getModelMap(): Promise<ModelMapResponse> {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/model-map`);
  if (!response.ok) {
    throw new Error(`Failed to get model map: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ModelMapResponse>;
}

async function getCircuitBreakers(): Promise<CircuitBreakersResponse> {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/orchestrator/circuit-breakers`);
  if (!response.ok) {
    throw new Error(`Failed to get circuit breakers: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<CircuitBreakersResponse>;
}

async function makeGenerateRequest(model: string, requestId: number): Promise<boolean> {
  try {
    const response = await fetch(`${ORCHESTRATOR_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: `Test request ${requestId} for model ${model}`,
        stream: false,
      }),
    });

    // We expect this to fail with timeout, but check if it succeeded
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Request ${requestId} for ${model} succeeded unexpectedly`);
      return true;
    } else {
      // This is expected - timeout or other error
      console.log(`❌ Request ${requestId} for ${model} failed as expected: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Request ${requestId} for ${model} failed with error: ${error}`);
    return false;
  }
}

async function testModel(model: string, numRequests: number): Promise<void> {
  console.log(`\n🧪 Starting test for model: ${model} (${numRequests} requests)`);

  // Create all promises at once for concurrent execution
  const promises: Promise<boolean>[] = [];
  for (let i = 0; i < numRequests; i++) {
    promises.push(makeGenerateRequest(model, i + 1));
  }

  console.log(`🚀 Sending ${numRequests} concurrent requests for ${model}...`);

  const results = await Promise.all(promises);
  const successes = results.filter(Boolean).length;
  const failures = results.length - successes;

  console.log(`📊 Model ${model} results: ${successes} successes, ${failures} failures`);

  // Check circuit breaker status after test
  try {
    const cbResponse = await getCircuitBreakers();
    const relevantBreakers = cbResponse.circuitBreakers.filter(
      cb => cb.serverId.includes(model) || cb.serverId.includes(':' + model)
    );
    console.log(`🔌 Circuit breakers for ${model}:`);
    relevantBreakers.forEach(cb => {
      console.log(
        `  ${cb.serverId}: ${cb.state} (${cb.failureCount} failures, ${cb.errorRate.toFixed(2)} error rate)`
      );
    });
  } catch (error) {
    console.log(`⚠️  Could not check circuit breakers: ${error}`);
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting circuit breaker test script');

  try {
    // Get model map
    console.log('📋 Getting model map...');
    const modelMap = await getModelMap();

    // Count servers per model and sort
    const modelCounts = Object.entries(modelMap.modelToServers).map(([model, servers]) => ({
      model,
      serverCount: servers.length,
    }));

    modelCounts.sort((a, b) => b.serverCount - a.serverCount);

    console.log('📊 Top models by server availability:');
    modelCounts.slice(0, 20).forEach((item, index) => {
      console.log(`${index + 1}. ${item.model}: ${item.serverCount} servers`);
    });

    // Select top 20 models
    const selectedModels = modelCounts.slice(0, 20).map(item => item.model);

    console.log(`\n🎯 Selected ${selectedModels.length} models for testing`);

    // Test each model
    for (const model of selectedModels) {
      await testModel(model, 500); // 500 requests per model
    }

    console.log('\n🎉 Testing complete!');

    // Final circuit breaker status
    console.log('\n🔍 Final circuit breaker status:');
    const finalCbResponse = await getCircuitBreakers();
    const openBreakers = finalCbResponse.circuitBreakers.filter(cb => cb.state === 'OPEN');
    const halfOpenBreakers = finalCbResponse.circuitBreakers.filter(cb => cb.state === 'HALF_OPEN');

    console.log(`Total circuit breakers: ${finalCbResponse.circuitBreakers.length}`);
    console.log(`Open breakers: ${openBreakers.length}`);
    console.log(`Half-open breakers: ${halfOpenBreakers.length}`);
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
main();
