import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import router from './src/routes/orchestrator.js';
import { getConfigManager } from './src/config/config.js';
import { getOrchestratorInstance, resetOrchestratorInstance } from './src/orchestrator/orchestrator-instance.js';
import { getPrometheusMetrics } from './src/controllers/metrics-controller.js';

async function test() {
  resetOrchestratorInstance();
  getConfigManager().updateConfig({ enablePersistence: false });
  const orchestrator = getOrchestratorInstance();
  orchestrator.setSuppressPersistence(true);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  
  // Add a simple logging middleware
  app.use((req, res, next) => {
    console.log('REQUEST:', req.method, req.path);
    next();
  });
  
  app.use('/api', router);
  app.use('/api/orchestrator', router);
  app.get('/metrics', getPrometheusMetrics);

  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, 'localhost', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://localhost:${address.port}`;

  // Try GET /api/orchestrator/servers first (requireAuth, not requireAdmin)
  const getResp = await fetch(`${baseUrl}/api/orchestrator/servers`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });
  console.log('GET /servers Status:', getResp.status);
  const getBody = await getResp.json();
  console.log('GET /servers Body:', JSON.stringify(getBody, null, 2).substring(0, 200));

  // Try POST /api/orchestrator/servers/add (requireAdmin)
  const postResp = await fetch(`${baseUrl}/api/orchestrator/servers/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'test-server', url: 'http://localhost:11434', type: 'ollama' })
  });
  console.log('POST /servers/add Status:', postResp.status);
  const postBody = await postResp.json();
  console.log('POST /servers/add Body:', JSON.stringify(postBody, null, 2));

  await new Promise<void>(resolve => server.close(() => resolve()));
  orchestrator.shutdown();
  resetOrchestratorInstance();
}

test().catch(console.error);
