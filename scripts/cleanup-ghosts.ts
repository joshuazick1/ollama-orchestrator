import { getOrchestratorInstance } from '/root/project/ollama-orchestrator/src/orchestrator/orchestrator-instance.js';
import { getPsPollCoordinator } from '/root/project/ollama-orchestrator/src/probe/ps-poll-coordinator-instance.js';

async function main() {
  const orchestrator = getOrchestratorInstance();
  const psCoordinator = getPsPollCoordinator();
  const servers = orchestrator.getServers();
  
  console.log(`Total servers: ${servers.length}`);
  
  const toRemove: Array<{ id: string; url: string; reason: string }> = [];
  
  for (const server of servers) {
    const models = psCoordinator.getModelsOnServer(server.id);
    const hasModels = models.size > 0;
    const healthy = server.healthy;
    const serverModels = (server as any).models?.length ?? 0;
    
    if (!healthy) {
      toRemove.push({ id: server.id, url: server.url, reason: 'unhealthy' });
    } else if (!hasModels) {
      toRemove.push({ id: server.id, url: server.url, reason: `ghost (0 models, ${serverModels} in .models)` });
    }
  }
  
  console.log(`\nServers to remove: ${toRemove.length}`);
  if (toRemove.length === 0) {
    console.log('No servers to remove.');
    return;
  }
  
  const ghosts = toRemove.filter(r => r.reason.startsWith('ghost'));
  const unhealthy = toRemove.filter(r => r.reason === 'unhealthy');
  console.log(`  Unhealthy: ${unhealthy.length}`);
  console.log(`  Ghosts (0 models): ${ghosts.length}`);
  
  for (const target of toRemove) {
    try {
      orchestrator.removeServer(target.id);
      console.log(`  REMOVED: ${target.url} (${target.reason})`);
    } catch (err) {
      console.error(`  FAILED: ${target.url} - ${err}`);
    }
  }
  
  console.log(`\nRemaining servers: ${orchestrator.getServers().length}`);
}

main().catch(console.error);
