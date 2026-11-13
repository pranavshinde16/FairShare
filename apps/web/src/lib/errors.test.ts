// @vitest-environment jsdom
import { ApiError } from '@fairshare/api-client';
import { ERROR_CODES } from '@fairshare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_COPY, errorMessage } from './errors';

describe('error copy (Blueprint 7.1)', () => {
  it('has friendly copy for every code the API and the client can return', () => {
    for (const code of [...ERROR_CODES, 'NETWORK_ERROR', 'INVALID_RESPONSE'] as const) {
      expect(ERROR_COPY[code], code).toMatch(/\S/);
    }
  });

  it('uses the copy, not the server’s message', () => {
    const error = new ApiError(409, 'VERSION_CONFLICT', 'Version 3 is current.');
    expect(errorMessage(error)).toBe(ERROR_COPY.VERSION_CONFLICT);
  });

  it('shows a newer server’s own message for a code it doesn’t know', () => {
    const error = new ApiError(422, 'SOMETHING_NEW' as never, 'Something new went wrong.');
    expect(errorMessage(error)).toBe('Something new went wrong.');
  });

  it('falls back to "Something went wrong" for anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });

  it('says the connection is the problem while offline', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(errorMessage(new TypeError('Failed to fetch'))).toBe(ERROR_COPY.NETWORK_ERROR);
    } finally {
      onLine.mockRestore();
    }
  });
});
