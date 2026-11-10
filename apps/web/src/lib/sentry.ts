import * as Sentry from '@sentry/react';

/**
 * Starts browser error tracking. main.tsx loads this module only when the build was given
 * VITE_SENTRY_DSN, so Sentry stays out of the main bundle. Uncaught render errors need no extra
 * wiring: React 19 passes them to window.reportError, which Sentry's global handler captures.
 *
 * Sentry 11 collects request and user data by default; all of it is off, as on the server.
 */
export function initSentry(dsn: string) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
  });
}
