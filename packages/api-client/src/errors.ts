import { ErrorCode, ErrorEnvelope, VersionConflictDetails } from '@fairshare/contracts';

/**
 * The codes an ApiError can carry: the server's codes, plus two the client produces itself.
 * NETWORK_ERROR means no response arrived (offline, DNS failure); INVALID_RESPONSE means the
 * response didn't match the contract.
 */
export type ApiErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

/**
 * Every failed API call surfaces as an ApiError with a stable `code`, so the UI can map codes to
 * friendly copy in one place. `status` is 0 when the request never got a response.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/**
 * Turns a non-2xx response into an ApiError, reading the server's error envelope when present. A
 * code this client doesn't know (from a newer server) becomes INTERNAL, keeping the message.
 */
export async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const envelope = ErrorEnvelope.safeParse(body);
  if (!envelope.success) {
    return new ApiError(res.status, 'INTERNAL', `Request failed with status ${res.status}`);
  }
  const { code, message, details, requestId } = envelope.data.error;
  const known = ErrorCode.safeParse(code);
  return new ApiError(
    res.status,
    known.success ? known.data : 'INTERNAL',
    message,
    details,
    requestId,
  );
}

/** For a VERSION_CONFLICT, the version someone else saved, so the UI can offer a reload. */
export function conflictVersion(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'VERSION_CONFLICT') return null;
  const details = VersionConflictDetails.safeParse(error.details);
  return details.success ? details.data.currentVersion : null;
}
