import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { sessionQuery } from './features/auth/session';
import { createQueryClient } from './lib/query-client';
import { initTheme } from './lib/theme';
import { createAppRouter } from './router';
import './index.css';

// Error tracking, only when configured, and loaded in parallel so it never delays the first render.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) void import('./lib/sentry').then(({ initSentry }) => initSentry(sentryDsn));

initTheme();

// A 401 from the API (session expired, or ended on another device): forget the session and sign
// in again, coming back to where the user was.
const queryClient = createQueryClient(() => {
  queryClient.setQueryData(sessionQuery.queryKey, null);
  const { pathname, href } = router.state.location;
  if (!pathname.startsWith('/sign-in')) {
    void router.navigate({ to: '/sign-in', search: { returnTo: href }, replace: true });
  }
});
const router = createAppRouter(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
