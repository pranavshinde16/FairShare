import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { ErrorState } from '../components/common/error-state';
import { Logo } from '../components/common/logo';
import { Button } from '../components/ui/button';
import { Toaster } from '../components/ui/toaster';
import { OfflineBanner } from '../features/pwa/offline-banner';
import { UpdatePrompt } from '../features/pwa/update-prompt';

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <OfflineBanner />
      <Outlet />
      <Toaster />
      <UpdatePrompt />
    </>
  ),
  notFoundComponent: NotFound,
  errorComponent: ({ error, reset }) => (
    <>
      <OfflineBanner />
      <CenteredPage>
        <ErrorState error={error} onRetry={reset} />
      </CenteredPage>
    </>
  ),
});

function NotFound() {
  return (
    <CenteredPage>
      <section className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-[22px] shadow-card">
        <span className="inline-flex size-12 items-center justify-center rounded-[14px] bg-muted text-muted-foreground">
          <Compass aria-hidden className="size-6" strokeWidth={1.9} />
        </span>
        <h1 className="text-[22px] leading-7 font-extrabold tracking-[-0.02em]">Page not found</h1>
        <p className="text-[15px] leading-[22px] text-muted-foreground">This page doesn’t exist.</p>
        <Button asChild variant="secondary" className="mt-1">
          <Link to="/">Go to Home</Link>
        </Button>
      </section>
    </CenteredPage>
  );
}

/** Signed-out and error pages: the logo above one centred card (D13). */
function CenteredPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center gap-7 bg-background px-6 py-10">
      <Logo size="lg" />
      {children}
    </main>
  );
}
