import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { ErrorState } from '../components/common/error-state';
import { Logo } from '../components/common/logo';

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: ({ error, reset }) => (
    <CenteredPage>
      <ErrorState error={error} onRetry={reset} />
    </CenteredPage>
  ),
});

function NotFound() {
  return (
    <CenteredPage>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">This page doesn’t exist.</p>
      <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
        Go to Home
      </Link>
    </CenteredPage>
  );
}

function CenteredPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <Logo />
      {children}
    </main>
  );
}
