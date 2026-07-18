/**
 * Professional capture: fullView (no sidebar), element parts + full main canvas.
 * Outputs under screenshots/parts/ and screenshots/full/
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, 'screenshots');
const partsDir = path.join(root, 'parts');
const fullDir = path.join(root, 'full');
fs.mkdirSync(partsDir, { recursive: true });
fs.mkdirSync(fullDir, { recursive: true });

const base = process.env.FLYER_BASE_URL || 'http://127.0.0.1:3000';

function withFullView(url) {
  const u = new URL(url, base);
  u.searchParams.set('fullView', '1');
  return u.toString();
}

async function goto(page, pathAndQuery, wait = 2000) {
  await page.goto(withFullView(pathAndQuery), { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(wait);
}

async function shotEl(page, selector, file, fallbackFull = false) {
  const out = path.join(partsDir, file);
  try {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await loc.screenshot({ path: out });
    console.log('part', file);
    return true;
  } catch (e) {
    console.warn('part fail', file, e.message);
    if (fallbackFull) {
      await page.screenshot({ path: out, fullPage: false });
      console.log('part fallback', file);
      return true;
    }
    return false;
  }
}

async function shotMain(page, file) {
  const out = path.join(fullDir, file);
  // Prefer main content; Layout uses <main>
  try {
    const main = page.locator('main').first();
    await main.waitFor({ state: 'visible', timeout: 5000 });
    await main.screenshot({ path: out });
  } catch {
    await page.screenshot({ path: out, fullPage: false });
  }
  console.log('full', file);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1.25,
});

// —— Blast Radius ——
await goto(page, '/impact/modules-vpc?slice=lineage', 3000);
await shotEl(page, 'header, [class*="Header"]', 'blast-01-header.png', true);
await shotEl(page, 'main .card, main > div > div', 'blast-02-controls.png', true);
await shotEl(page, 'canvas, svg, [class*="Dependency"]', 'blast-03-graph.png', true);
await shotMain(page, 'blast-radius.png');

// —— Pattern Layer 1 ——
await goto(page, '/graph/infra?tab=patterns', 3200);
await shotEl(page, 'header', 'pattern-01-header.png', true);
await shotEl(page, 'main', 'pattern-02-catalog.png', true);
// try stamp / architecture area
await shotEl(page, 'text=Architect', 'pattern-03-forums.png', true);
await shotMain(page, 'pattern-layer1.png');

// —— Layer 2 ——
await goto(page, '/graph/infra?tab=application', 3200);
await shotEl(page, 'header', 'layer2-01-header.png', true);
await shotEl(page, 'canvas, svg', 'layer2-02-graph.png', true);
await shotMain(page, 'layer2-component.png');

// —— Dependency Tree ——
await goto(page, '/dependencies', 2500);
await shotEl(page, 'header', 'deptree-01-header.png', true);
await shotEl(page, 'main', 'deptree-02-tree.png', true);
await shotMain(page, 'dependency-tree.png');

// —— Release Tag ——
await goto(page, '/releases/v3.0.0', 2000);
await shotEl(page, 'header', 'tag-01-header.png', true);
await shotEl(page, 'main', 'tag-02-impact.png', true);
await shotMain(page, 'release-tag-impact.png');

// —— Release Compare + AI ——
await goto(page, '/release-compare', 2500);
await shotEl(page, 'header', 'compare-01-header.png', true);
await shotEl(page, 'main .card', 'compare-02-selectors.png', true);
try {
  await page.locator('button:has-text("Compare")').first().click({ timeout: 5000 });
  await page.waitForTimeout(4000);
} catch (e) {
  console.warn('Compare click skipped', e.message);
}
await shotEl(page, 'main', 'compare-03-diff.png', true);
await shotEl(page, 'text=AI recommendations', 'compare-04-ai.png', true);
await shotMain(page, 'release-compare-ai.png');

// —— FinOps ——
await goto(page, '/finops', 1800);
await shotEl(page, 'header', 'finops-01-header.png', true);
await shotEl(page, 'main', 'finops-02-breakdown.png', true);
await shotMain(page, 'finops.png');

// —— Subscriptions ——
await goto(page, '/repos', 1800);
await shotEl(page, 'header', 'subs-01-header.png', true);
await shotEl(page, 'main table, main .card', 'subs-02-table.png', true);
await shotMain(page, 'subscriptions.png');

// —— Change Plan ——
await goto(page, '/plans/change', 1500);
await shotMain(page, 'change-plan.png');

await browser.close();
console.log('Capture complete →', root);
