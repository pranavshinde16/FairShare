import { ApiError } from '@fairshare/api-client';
import { useEffect, useState } from 'react';
import { api } from './lib/api';

type Status = 'checking' | 'ok' | 'db-down' | 'unreachable';

const STATUS_TEXT: Record<Status, string> = {
  checking: 'Checking server…',
  ok: 'Server and database are up',
  'db-down': 'Server is up, database is down',
  unreachable: 'Server is unreachable',
};

export function App() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let active = true;
    api
      .health()
      .then(() => active && setStatus('ok'))
      .catch((err: unknown) => {
        if (!active) return;
        setStatus(err instanceof ApiError && err.status === 503 ? 'db-down' : 'unreachable');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <h1>FairShare</h1>
      <p className="tagline">Split expenses. No limits.</p>
      <p className={`status status-${status}`} role="status">
        {STATUS_TEXT[status]}
      </p>
    </main>
  );
}
