import { secureHeaders } from 'hono/secure-headers';

/**
 * Content Security Policy for every response, the web app's index.html included (Blueprint 9.1).
 * Scripts (the service worker too) load only from our own origin; no inline script or style
 * element; nothing may frame the app. The one outside connection is Sentry, where the browser SDK
 * sends error reports; the one outside image source is Google's profile pictures.
 */
export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'https://*.googleusercontent.com'],
  connectSrc: ["'self'", 'https://*.sentry.io'],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

/** HTTPS only, for a year, on every subdomain too (Blueprint 9.1). Not preloaded. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

/** Browser features the app never uses, turned off so injected content couldn't use them. */
export const PERMISSIONS_POLICY = {
  camera: false,
  microphone: false,
  geolocation: false,
  payment: false,
  usb: false,
  serial: false,
  bluetooth: false,
};

/** HSTS, nosniff, no-referrer and the rest of Hono's defaults, plus the policies above. */
export const securityHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
    strictTransportSecurity: STRICT_TRANSPORT_SECURITY,
    permissionsPolicy: PERMISSIONS_POLICY,
    xFrameOptions: 'DENY',
  });
