/**
 * Drive the built player and photograph what it says about itself.
 *
 * Every fault this project has had since it became a Unity build was
 * found here rather than by reading the code, and most of them could not
 * have been found any other way. A circuit whose scenery ended in
 * mid-air. Tyres at 226 °C. A start card that could not spell the name of
 * its own key. A lap clock that had been running since the world loaded.
 * All of them compiled, all of them passed every test, and all of them
 * were obvious within thirty seconds of looking at the instrument.
 *
 * So the instrument is the point. `F3` puts one line on screen with
 * everything a guess would have been about on it — input, revs, gear, how
 * many wheels are on the road, what they are carrying, what a probe
 * straight down finds — and this crops each screenshot to that line, so a
 * run produces a stack of small legible images instead of a stack of
 * frames to squint at.
 *
 * Three things happen, in order, and each answers a question that has
 * been wrong at some point:
 *
 *   - the grid, with nothing pressed. Does the car sit still?
 *   - full throttle at full lock, off the circuit. Does the wall hold it,
 *     or does it leave the world and fall for ever?
 *   - the autopilot, for as long as it takes. Does it complete a lap, and
 *     what has happened to the tyres by the time it does?
 *
 * Playwright is not a dependency of this repository and should not
 * become one: it would put a browser download into every CI run to serve
 * a script that CI does not run. Install it where you need it.
 *
 *   npm run site                       # fetch the player, lay out the site
 *   npx serve dist-site -l 8899        # or any static server
 *   node tools/drive.mjs               # and watch it drive
 */

import { chromium } from 'playwright';

const OUT = process.env.DRIVE_OUT ?? 'drive-out';
const URL = process.argv[2] ?? 'http://127.0.0.1:8899/';
const W = 1600;
const H = 800;

/* Where the HUD puts the F3 line: the layout unit is the short edge over
   22, and the strip sits `unit * 6.2` up from the bottom. Derived rather
   than measured, so it follows the HUD if the HUD moves. */
const unit = Math.min(W, H) / 22;
const STRIP = {
  x: 0,
  y: Math.round(H - unit * 6.2),
  width: W,
  height: Math.round(unit * 1.3)
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? undefined,
  args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader']
});

const page = await browser.newPage({ viewport: { width: W, height: H } });

/* Anything the player says about itself. A C# exception in the bootstrap
   arrives here and nowhere else — the game goes on rendering a black
   screen perfectly happily. */
const noise = [];
page.on('pageerror', (e) => noise.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => {
  const text = m.text();
  if (/error|exception|Error|NullReference|Assert/.test(text)) {
    noise.push(`CONSOLE ${text.slice(0, 400)}`);
  }
});

await page.goto(URL, { waitUntil: 'load', timeout: 90_000 });

/* Which build this is. Unity's output has fixed filenames, so without
   this there is no way to tell two builds apart from the outside — and
   "did my change reach the site" has cost more time here than any bug. */
console.log('serving:', await page.textContent('#stamp').catch(() => '(no stamp)'));

await page
  .waitForFunction(() => !document.getElementById('gate'), { timeout: 180_000 })
  .catch(() => {});
await page.waitForTimeout(16_000);

const shot = async (name, whole = false) =>
  page.screenshot({ path: `${OUT}/${name}.png`, clip: whole ? undefined : STRIP });

await shot('title', true);

const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.63);
await page.keyboard.press('F3');

// --- does it sit still? ---------------------------------------------
for (const n of [0, 1, 2, 3]) {
  await page.waitForTimeout(n === 0 ? 1500 : 2000);
  await shot(`grid-${n}`, true);
}

// --- does the wall hold it? ------------------------------------------
await page.keyboard.down('ArrowUp');
await page.keyboard.down('ArrowLeft');
for (const t of [3, 6, 10, 16, 24]) {
  await page.waitForTimeout(3000);
  await shot(`wall-${t}s`);
}
await shot('wall-scene', true);
await page.keyboard.up('ArrowUp');
await page.keyboard.up('ArrowLeft');

// --- and can it drive a lap? -----------------------------------------
await page.keyboard.press('r');
await page.waitForTimeout(2000);
await page.keyboard.press('p');

for (let i = 1; i <= 14; i++) {
  await page.waitForTimeout(15_000);
  await shot(`lap-${String(i).padStart(2, '0')}`);
  if (i % 4 === 0) await shot(`scene-${i}`, true);
}

console.log('log:', noise.length > 0 ? noise.slice(0, 8) : 'clean');
await browser.close();
