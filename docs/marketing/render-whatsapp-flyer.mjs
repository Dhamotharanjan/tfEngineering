/**
 * How AI + Milvus are used in InfraGraph (for flyer / stakeholder brief).
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flyerDir = path.join(__dirname, 'flyer');
const outDir = path.join(flyerDir, 'whatsapp');
fs.mkdirSync(outDir, { recursive: true });

const htmlPath = path.join(flyerDir, 'whatsapp-flyer.html');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
});

await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);

const pages = await page.$$('.page');
console.log('Rendering', pages.length, 'WhatsApp pages…');
for (let i = 0; i < pages.length; i++) {
  const file = path.join(outDir, `infragraph-whatsapp-${String(i + 1).padStart(2, '0')}.png`);
  await pages[i].screenshot({ path: file });
  console.log('Wrote', file);
}

await browser.close();
console.log('Share these PNGs on WhatsApp (carousel).');
