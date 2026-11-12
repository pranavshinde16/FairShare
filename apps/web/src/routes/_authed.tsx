import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/layout/app-shell';
import { sessionQuery } from '../features/auth/session';

/** Every signed-in page. Without a session, go to sign-in and come back here afterwards. */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) {
      throw redirect({ to: '/sign-in', search: { returnTo: location.href }, replace: true });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
