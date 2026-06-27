import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const URL = 'http://203.202.237.106:11434';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    console.log('1. Navigating to servers page...');
    await page.goto(`${BASE}/servers`, { timeout: 15000 });
    await page.waitForTimeout(3000);

    console.log('2. Page title:', await page.title());
    console.log('   URL:', page.url());

    await page.screenshot({ path: '/tmp/playwright-servers-before.png' });

    console.log('3. Looking for Add Server button...');
    const addBtn = page.locator('button:has-text("Add Server")').first();
    const addBtnCount = await addBtn.count();
    console.log('   Add Server button found:', addBtnCount > 0);

    if (addBtnCount === 0) {
      console.log('ERROR: Add Server button not found');
      await browser.close();
      return;
    }

    console.log('4. Taking screenshot before click...');
    await page
      .screenshot({ path: '/tmp/playwright-before-add-click.png' })
      .catch(e => console.log('   Screenshot error:', e.message));

    console.log('5. Clicking Add Server button...');
    await addBtn.click({ force: true }).catch(e => console.log('   Click error:', e.message));
    console.log('   Click done');

    console.log('6. Looking for URL input...');
    const inputCount = await page.locator('input').count();
    console.log('   Input fields found:', inputCount);

    if (inputCount > 0) {
      const urlInputEl = page.locator('input[type="text"]').nth(1);
      await urlInputEl.click({ clickCount: 3 });
      await urlInputEl.fill(URL);
      console.log('7. URL filled via Playwright:', URL);
    }

    console.log('8. Looking for "Add Server & Probe Now" button...');
    const probeBtn = page.locator('button:has-text("Add Server & Probe Now")');
    const probeBtnCount = await probeBtn.count();
    console.log('   "Add Server & Probe Now" button found:', probeBtnCount > 0);

    if (probeBtnCount > 0) {
      console.log('9. Clicking "Add Server & Probe Now" button via evaluate...');
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const probeBtn = buttons.find(
          b => b.textContent?.includes('Add Server') && b.textContent?.includes('Probe')
        );
        if (probeBtn) {
          console.log('Found button:', probeBtn.textContent);
          probeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      });
      console.log('   Click dispatched, waiting...');
      await page.waitForTimeout(5000);

      const finalUrl = page.url();
      console.log('10. Final URL:', finalUrl);

      const taskIdMatch = finalUrl.match(/taskId=([^&]+)/);
      const taskId = taskIdMatch ? taskIdMatch[1] : null;
      console.log('    Task ID:', taskId);

      await page.screenshot({ path: '/tmp/playwright-after-submit.png' });
      console.log('    Screenshot saved');
    } else {
      console.log('   Searching all buttons for "Probe"...');
      const allButtons = await page.locator('button').allTextContents();
      const probeButtons = allButtons.filter(b => b.includes('Probe'));
      console.log('   Buttons containing "Probe":', probeButtons);
    }

    console.log('\n=== FINAL RESULTS ===');
    console.log('Page title:', await page.title());
    console.log('Final URL:', page.url());
    console.log('"Add Server & Probe Now" button found:', probeBtnCount > 0);
    console.log('Console errors:', errors.length > 0 ? errors : 'none');
    console.log(
      'Screenshots: /tmp/playwright-servers-before.png, /tmp/playwright-modal-open.png, /tmp/playwright-after-submit.png'
    );

    await browser.close();
  } catch (e) {
    console.error('Error:', e.message);
    try {
      await browser.close();
    } catch {}
    throw e;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
