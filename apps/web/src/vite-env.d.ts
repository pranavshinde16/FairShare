/// <reference types="vite-plugin-pwa/react" />

// Build-time settings. Only VITE_* variables reach the browser, and they are public: never a secret.
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Where privacy requests go, shown on the privacy notice and terms. */
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
