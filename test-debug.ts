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
  app.use((req, _res, next) => next());
  app.use('/api', router);
  app.use('/api/orchestrator', router);
  app.get('/metrics', getPrometheusMetrics);

  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, 'localhost', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://localhost:${address.port}`;

  console.log('Server started at', baseUrl);
  console.log('ENABLE_AUTH:', process.env.ENABLE_AUTH);
  console.log('ORCHESTRATOR_AUTH_ENABLED:', process.env.ORCHESTRATOR_AUTH_ENABLED);

  const response = await fetch(`${baseUrl}/api/orchestrator/servers/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'test-server', url: 'http://localhost:11434', type: 'ollama' })
  });

  console.log('Status:', response.status);
  const body = await response.json();
  console.log('Body:', JSON.stringify(body, null, 2));

  await new Promise<void>(resolve => server.close(() => resolve()));
  orchestrator.shutdown();
  resetOrchestratorInstance();
}

test().catch(console.error);
