import { formatIfMatch } from '@fairshare/contracts';
import type { z } from 'zod';
import { ApiError, toApiError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query parameters. undefined and null are left out; booleans become "true" / "false". */
export type Query = Record<string, string | number | boolean | null | undefined>;

export type RequestOptions = {
  method?: HttpMethod;
  query?: Query;
  /** Sent as JSON. */
  body?: unknown;
  /** The version being edited. Sent as `If-Match: "<version>"`; a stale one gets VERSION_CONFLICT. */
  ifMatch?: number;
  /** Cancels the request; the AbortError is rethrown as-is so callers can tell it apart. */
  signal?: AbortSignal;
};

export type TransportOptions = {
  /** Origin of the API, e.g. '' for same-origin in the browser or 'https://fairshare.app'. */
  baseUrl: string;
  /** Injectable for tests and non-browser clients. */
  fetch?: typeof fetch;
};

export function createTransport(options: TransportOptions) {
  // A detached `fetch` throws "Illegal invocation" in browsers, so bind it.
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function send(path: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.ifMatch !== undefined) headers['If-Match'] = formatIfMatch(opts.ifMatch);

    let res: Response;
    try {
      res = await fetchImpl(options.baseUrl + path + queryString(opts.query), {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: 'include',
        signal: opts.signal,
      });
    } catch (cause) {
      if (opts.signal?.aborted) throw cause;
      throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server.', cause);
    }
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  /** Sends a request and returns the response body, validated against `schema`. */
  async function request<S extends z.ZodType>(
    schema: S,
    path: string,
    opts: RequestOptions = {},
  ): Promise<z.output<S>> {
    const res = await send(path, opts);
    let body: unknown;
    try {
      body = await res.json();
    } catch (cause) {
      throw new ApiError(
        res.status,
        'INVALID_RESPONSE',
        'The server sent a response that isn’t JSON.',
        cause,
      );
    }
    // Validate responses too: contract drift shows up as one clear error, not a broken screen.
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        res.status,
        'INVALID_RESPONSE',
        'The server’s response didn’t match the expected shape.',
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  /** Sends a request whose success response has no body (204). */
  async function requestNoContent(path: string, opts: RequestOptions = {}): Promise<void> {
    await send(path, opts);
  }

  return { request, requestNoContent };
}

export type Transport = ReturnType<typeof createTransport>;

function queryString(query: Query | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}
