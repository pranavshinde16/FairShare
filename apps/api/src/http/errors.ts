import { ERROR_HTTP_STATUS, type ErrorCode } from '@fairshare/contracts';

/**
 * An error the client should see: a stable code, a message fit to show, optional details. The
 * status comes from the contracts table, so a code can't be sent with the wrong status.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly status: (typeof ERROR_HTTP_STATUS)[ErrorCode];

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = ERROR_HTTP_STATUS[code];
  }
}
