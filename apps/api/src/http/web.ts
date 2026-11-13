// Serving the built web app from the API, so production is one origin (Blueprint C1).

import { serveStatic } from '@hono/node-server/serve-static';
import { compress } from 'hono/compress';
import type { Context, MiddlewareHandler } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type WebAssets = {
  /** Absolute path of the web build (apps/web/dist). */
  root: string;
  /** index.html, read once at boot and returned for every app route. */
  indexHtml: string;
};

/** Reads the build at boot. Throws if index.html is missing, so a broken image never goes live. */
export function loadWebAssets(root: string): WebAssets {
  return { root, indexHtml: readFileSync(join(root, 'index.html'), 'utf8') };
}

export const isApiPath = (path: string) => path === '/api' || path.startsWith('/api/');

// Vite puts content-hashed files under /assets, so they never change and can be cached for a year.
// Everything else (index.html, favicon) must be revalidated so a deploy shows up immediately.
const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

/** Serves files from the build. Never touches /api paths. */
export function webFiles({ root }: WebAssets): MiddlewareHandler {
  const files = serveStatic({ root });
  return async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    // A found file comes back as a Response; a miss passes the request on with next().
    // (serveStatic's onFound hook runs after the response is built, too late to add headers.)
    const res = await files(c, next);
    if (res instanceof Response) {
      res.headers.set('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE);
      return res;
    }
  };
}

/**
 * Compresses what the web build serves (scripts, styles, index.html: about a third of the bytes
 * on a slow phone connection). API responses are left alone, so nothing private is ever compressed
 * alongside something a request put there (BREACH).
 */
export function compressWeb(): MiddlewareHandler {
  const gzip = compress();
  return (c, next) => (isApiPath(c.req.path) ? next() : gzip(c, next));
}

/**
 * True when a request that matched nothing should get index.html, so the client-side router can
 * handle it (e.g. a reload on /groups/123). Only browser page loads qualify: a missing script or
 * image still gets a 404 instead of HTML.
 */
export function wantsAppPage(c: Context): boolean {
  return (
    (c.req.method === 'GET' || c.req.method === 'HEAD') &&
    !isApiPath(c.req.path) &&
    (c.req.header('Accept') ?? '').includes('text/html')
  );
}
