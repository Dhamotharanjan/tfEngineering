import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'screenshots');
const base = process.env.FLYER_BASE_URL || 'http://localhost:3000';
fs.mkdirSync(outDir, { recursive: true });

async function shot(page, file, url, { wait = 2000, scrollTo = null, click = null, after = null } = {}) {
  console.log(file, url);
  await page.goto(`${base}${url}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(wait);
  if (click) {
    try {
      await page.click(click, { timeout: 5000 });
      await page.waitForTimeout(1200);
    } catch {
      /* optional */
    }
  }
  if (scrollTo) {
    try {
      const el = page.locator(scrollTo).first();
      await el.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(800);
    } catch {
      /* optional */
    }
  }
  if (after) await after(page);
  await page.screenshot({ path: path.join(outDir, file), fullPage: false });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
});

await shot(page, 'blast-radius.png', '/impact/modules-vpc?slice=lineage', { wait: 2800 });
await shot(page, 'pattern-layer1.png', '/graph/infra?tab=patterns', { wait: 2800 });
await shot(page, 'layer2-component.png', '/graph/infra?tab=application', { wait: 2800 });
await shot(page, 'dependency-tree.png', '/dependencies', { wait: 2200 });
await shot(page, 'infragraph.png', '/graph/infra?tab=patterns', { wait: 2000 });
await shot(page, 'release-tag-impact.png', '/releases/v3.0.0', { wait: 1800 });
await shot(page, 'release-compare-ai.png', '/release-compare', {
  wait: 2500,
  after: async (p) => {
    try {
      const compareBtn = p.locator('button:has-text("Compare")').first();
      await compareBtn.click({ timeout: 5000 });
      await p.waitForTimeout(3500);
      const ai = p.locator('text=AI recommendations').first();
      if (await ai.count()) await ai.scrollIntoViewIfNeeded();
      await p.waitForTimeout(800);
    } catch (e) {
      console.warn('Compare/AI scroll skipped:', e.message);
    }
  },
});
await shot(page, 'finops.png', '/finops', { wait: 1500 });
await shot(page, 'subscriptions.png', '/repos', { wait: 1500 });
await shot(page, 'pitch.png', '/pitch', { wait: 1200 });
await shot(page, 'change-plan.png', '/plans/change', { wait: 1200 });

await browser.close();
console.log('Done →', outDir);
