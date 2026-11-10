import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Error tracking, only when configured, and loaded in parallel so it never delays the first render.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) void import('./lib/sentry').then(({ initSentry }) => initSentry(sentryDsn));

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
