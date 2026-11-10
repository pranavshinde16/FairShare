import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../testing/app';
import { loadWebAssets, type WebAssets } from './web';

const INDEX = '<!doctype html><title>FairShare</title><div id="root"></div>';
let dir: string;
let web: WebAssets;

// A stand-in for apps/web/dist.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fairshare-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), INDEX);
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  web = loadWebAssets(dir);
});
afterAll(() => rmSync(dir, { recursive: true }));

const page = { headers: { Accept: 'text/html,application/xhtml+xml' } };

describe('serving the web app', () => {
  it('serves index.html at the root, revalidated on every load', async () => {
    const { app } = testApp({ web });

    const res = await app.request('/', page);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  });

  it('caches content-hashed assets for a year, and other files not at all', async () => {
    const { app } = testApp({ web });

    const asset = await app.request('/assets/index-abc123.js');
    const icon = await app.request('/favicon.svg');

    expect(asset.status).toBe(200);
    expect(asset.headers.get('Content-Type')).toMatch(/javascript/);
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(icon.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('answers a page load on any app route with index.html, for the client-side router', async () => {
    const { app } = testApp({ web });

    for (const path of ['/groups/123', '/invite/abc', '/sign-in']) {
      const res = await app.request(path, page);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(INDEX);
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
    }
  });

  it('still returns 404 for a missing file, an API path, or a non-GET request', async () => {
    const { app } = testApp({ web });

    const missingAsset = await app.request('/assets/gone.js');
    const apiPage = await app.request('/api/v1/groups', page);
    const post = await app.request('/groups/123', { ...page, method: 'POST' });

    for (const res of [missingAsset, apiPage, post]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    }
  });

  it('never serves files from outside the build', async () => {
    const { app } = testApp({ web });

    const res = await app.request('/%2e%2e/%2e%2e/etc/passwd', page);

    expect(await res.text()).not.toContain('root:');
  });

  it('leaves the API alone', async () => {
    const { app } = testApp({ web });

    const res = await app.request('/api/health');

    expect(await res.json()).toEqual({ ok: true, db: 'up' });
  });

  it('is off without a build: page loads get the JSON 404', async () => {
    const { app } = testApp({ web: null });

    const res = await app.request('/groups/123', page);

    expect(res.status).toBe(404);
  });
});

describe('loadWebAssets', () => {
  it('refuses to start without index.html', () => {
    expect(() => loadWebAssets(join(dir, 'assets'))).toThrow(/index\.html/);
  });
});
