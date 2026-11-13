// Renders the PWA's PNG icons from their SVG sources with Playwright's Chromium, so no image
// library is needed. Run after changing an icon, and commit the PNGs:
//   node --experimental-strip-types scripts/render-icons.ts   (from e2e/)
//
// - favicon.svg (rounded square) → pwa-192x192.png, pwa-512x512.png: "any" purpose.
// - icons/maskable.svg (full bleed; the plus sign inside the central 80% safe zone) →
//   maskable-512x512.png for Android's adaptive shapes, apple-touch-icon.png (iOS rounds it).

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = (path: string) => fileURLToPath(new URL(`../../apps/web/${path}`, import.meta.url));

const ICONS = [
  { source: 'public/favicon.svg', out: 'public/pwa-192x192.png', size: 192 },
  { source: 'public/favicon.svg', out: 'public/pwa-512x512.png', size: 512 },
  { source: 'icons/maskable.svg', out: 'public/maskable-512x512.png', size: 512 },
  { source: 'icons/maskable.svg', out: 'public/apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    const svg = readFileSync(web(icon.source), 'utf8');
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<style>*{margin:0}svg{display:block;width:${icon.size}px;height:${icon.size}px}</style>${svg}`,
    );
    writeFileSync(web(icon.out), await page.locator('svg').screenshot({ omitBackground: true }));
    console.log(`${icon.out} (${icon.size}×${icon.size})`);
  }
} finally {
  await browser.close();
}
