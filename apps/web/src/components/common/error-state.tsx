import { errorMessage, errorRequestId } from '../../lib/errors';
import { Button } from '../ui/button';

/** "Something went wrong · Retry", with the request ID in small text (Blueprint 7.1). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const requestId = errorRequestId(error);
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-5">
      <p className="text-sm">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
      {requestId && <p className="text-xs text-muted-foreground">Request ID: {requestId}</p>}
    </div>
  );
}
