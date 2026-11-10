import { secureHeaders } from 'hono/secure-headers';

/**
 * Content Security Policy for every response, the web app's index.html included (Blueprint 9.1).
 * Scripts load only from our own origin; nothing may frame the app. The one outside connection is
 * Sentry, where the browser SDK sends error reports.
 */
export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'", 'https://*.sentry.io'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

/** HSTS, nosniff, no-referrer and the rest of Hono's defaults, plus the CSP above. */
export const securityHeaders = () =>
  secureHeaders({ contentSecurityPolicy: CONTENT_SECURITY_POLICY, xFrameOptions: 'DENY' });
