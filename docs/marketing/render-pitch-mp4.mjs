/**
 * Render white pitch slides → PNG → MP4 (ffmpeg).
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flyerDir = path.join(__dirname, 'flyer');
const framesDir = path.join(flyerDir, 'frames-white');
const outMp4 = path.join(flyerDir, 'InfraGraph-Professional-Pitch.mp4');
const htmlPath = path.join(flyerDir, 'pitch-slideshow-white.html');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

fs.mkdirSync(framesDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(2000);

const slides = await page.$$('.slide');
const durations = [];
console.log('Rendering', slides.length, 'frames…');

for (let i = 0; i < slides.length; i++) {
  const dur = Number(await slides[i].getAttribute('data-dur')) || 5;
  durations.push(dur);
  const file = path.join(framesDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
  await slides[i].screenshot({ path: file, type: 'png' });
  console.log('frame', i + 1, 'dur', dur);
}

await browser.close();

// concat demuxer with per-slide duration
const listPath = path.join(framesDir, 'concat.txt');
const lines = [];
for (let i = 0; i < durations.length; i++) {
  const name = `slide-${String(i + 1).padStart(2, '0')}.png`;
  lines.push(`file '${name.replace(/'/g, "'\\''")}'`);
  lines.push(`duration ${durations[i]}`);
}
// last frame must be repeated without duration for concat demuxer
const last = `slide-${String(durations.length).padStart(2, '0')}.png`;
lines.push(`file '${last}'`);
fs.writeFileSync(listPath, lines.join('\n'), 'utf8');

const ffmpeg =
  process.env.FFMPEG_PATH ||
  'ffmpeg';

const args = [
  '-y',
  '-f', 'concat',
  '-safe', '0',
  '-i', 'concat.txt',
  '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-movflags', '+faststart',
  path.resolve(outMp4),
];

console.log('Encoding MP4…');
const res = spawnSync(ffmpeg, args, { cwd: framesDir, encoding: 'utf8', shell: true });
if (res.status !== 0) {
  console.error(res.stderr || res.stdout);
  process.exit(1);
}
console.log('Wrote', outMp4);
const total = durations.reduce((a, b) => a + b, 0);
console.log('Approx duration:', total, 'seconds');
