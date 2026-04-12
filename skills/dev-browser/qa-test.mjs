import { chromium } from 'playwright';
import { spawn } from 'child_process';

// Start the Vite preview server (serves built files)
const server = spawn('npm', ['run', 'preview'], {
  cwd: '/root/ollama-orchestrator/frontend',
  detached: true,
  stdio: 'ignore'
});
server.unref();

// Wait for server to be ready
await new Promise(resolve => setTimeout(resolve, 5000));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') {
    errors.push(`Console error: ${msg.text()}`);
  }
});
page.on('pageerror', err => errors.push(`Page error: ${err.message}`));

const results = [];

try {
  // Test Dashboard
  console.log('Testing Dashboard...');
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const dashTitle = await page.title();
  results.push({ page: 'Dashboard', title: dashTitle, url: page.url() });
  await page.screenshot({ path: '/root/ollama-orchestrator/tmp/dashboard.png', fullPage: true });

  // Test Servers page
  console.log('Testing Servers...');
  await page.goto('http://localhost:4173/servers', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const serversTitle = await page.title();
  results.push({ page: 'Servers', title: serversTitle, url: page.url() });
  await page.screenshot({ path: '/root/ollama-orchestrator/tmp/servers.png', fullPage: true });

  // Check for skeleton loaders
  const skeletons = await page.locator('.animate-pulse, [class*="skeleton"]').count();

  // Check for buttons and badges
  const buttons = await page.locator('button').count();
  const badges = await page.locator('[class*="badge"]').count();

  console.log('\n=== QA RESULTS ===');
  console.log('Pages tested:', results.map(r => r.page).join(', '));
  console.log('Skeletons found:', skeletons);
  console.log('Buttons found:', buttons);
  console.log('Badges found:', badges);
  console.log('Console errors found:', errors.length);
  if (errors.length > 0) {
    console.log('Error details:');
    errors.forEach(e => console.log('  -', e));
  }

} catch (err) {
  console.error('Test failed:', err.message);
  console.error('Errors collected:', errors);
} finally {
  await browser.close();
  process.exit(0);
}