/**
 * Pitch captures — white chrome (?pitch=1), new Pattern architecture layout.
 * Hero: PAT-EC2-ORACLE-DR-PAIR AWS canvas (parts then full).
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, 'screenshots');
const parts = path.join(root, 'parts');
const full = path.join(root, 'full');
fs.mkdirSync(parts, { recursive: true });
fs.mkdirSync(full, { recursive: true });

const base = process.env.FLYER_BASE_URL || 'http://127.0.0.1:3010';
const PATTERN = 'PAT-EC2-ORACLE-DR-PAIR';

function url(p) {
  const u = new URL(p, base);
  u.searchParams.set('pitch', '1');
  u.searchParams.set('fullView', '1');
  return u.toString();
}

async function goto(page, p, wait = 2500) {
  console.log('→', url(p));
  await page.goto(url(p), { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(wait);
}

async function shot(page, file, dir, selector = null) {
  const out = path.join(dir, file);
  try {
    if (selector) {
      const loc = page.locator(selector).first();
      await loc.waitFor({ state: 'visible', timeout: 12000 });
      await loc.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      // Prefer a meaningful parent for stamp form
      const target = selector.includes('Stamp')
        ? loc.locator('xpath=ancestor::div[contains(@class,"card") or contains(@class,"space-y")][1]').first()
        : loc;
      try {
        await target.screenshot({ path: out });
      } catch {
        await loc.screenshot({ path: out });
      }
    } else {
      await page.locator('main').first().screenshot({ path: out });
    }
    console.log('✓', path.relative(root, out));
    return true;
  } catch (e) {
    console.warn('✗', file, e.message.split('\n')[0]);
    return false;
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: 1.25,
});

// —— HERO: New Pattern architecture layout ——
await goto(
  page,
  `/graph/infra?tab=patterns&patternId=${encodeURIComponent(PATTERN)}`,
  4500,
);

// Wait for architecture canvas
try {
  await page.locator('[data-testid="aws-architecture-canvas"]').waitFor({ state: 'visible', timeout: 20000 });
} catch {
  console.warn('Architecture canvas not ready — trying click pattern card');
  try {
    await page.locator(`text=${PATTERN}`).first().click({ timeout: 5000 });
    await page.waitForTimeout(3000);
  } catch {
    /* continue */
  }
}

await shot(page, 'pattern-hero-canvas.png', parts, '[data-testid="aws-architecture-canvas"]');
await shot(page, 'pattern-auditor-package.png', parts, 'text=Auditor architecture package');
await shot(page, 'pattern-stamp-panel.png', parts, 'text=Stamp / approve');
await shot(page, 'pattern-full-layout.png', full, null);
await shot(page, 'pattern-aws-only.png', full, '[data-testid="aws-architecture-canvas"]');
// Keep a copy named for slideshow fallbacks
fs.copyFileSync(
  path.join(full, 'pattern-aws-only.png'),
  path.join(parts, 'pattern-hero-canvas-fallback.png'),
);

// —— Other value screens (light pitch chrome) ——
await goto(page, '/impact/modules-vpc?slice=lineage', 3000);
await shot(page, 'blast-radius.png', full);

await goto(page, '/graph/infra?tab=application', 3000);
await shot(page, 'layer2-component.png', full);

await goto(page, '/dependencies', 2200);
await shot(page, 'dependency-tree.png', full);

await goto(page, '/releases/v3.0.0', 1800);
await shot(page, 'release-tag-impact.png', full);

await goto(page, '/release-compare', 2200);
try {
  await page.locator('button:has-text("Compare")').first().click({ timeout: 5000 });
  await page.waitForTimeout(3500);
} catch {
  /* ok */
}
await shot(page, 'release-compare-ai.png', full);

await goto(page, '/finops', 1500);
await shot(page, 'finops.png', full);

await goto(page, '/repos', 1500);
await shot(page, 'subscriptions.png', full);

await goto(page, '/plans/change', 1200);
await shot(page, 'change-plan.png', full);

await browser.close();
console.log('Done. Base was', base);
