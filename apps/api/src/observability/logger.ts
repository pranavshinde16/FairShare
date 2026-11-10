import { pino, type DestinationStream, type Level, type Logger } from 'pino';

/** Keys whose values never reach the logs, wherever they appear up to three levels deep. */
export const REDACTED_KEYS = ['email', 'otp', 'token', 'cookie', 'authorization'] as const;

const REDACT_PATHS = REDACTED_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

export type LoggerOptions = {
  level: Level | 'silent';
  /** Human-readable output for local development (needs the pino-pretty dev dependency). */
  pretty?: boolean;
  /** Where JSON lines go. Defaults to stdout; tests pass a buffer. */
  destination?: DestinationStream;
};

/** The app's structured JSON logger. One line per event; the platform collects stdout. */
export function createLogger({ level, pretty = false, destination }: LoggerOptions): Logger {
  const options = { level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } };
  if (pretty) return pino({ ...options, transport: { target: 'pino-pretty' } });
  return destination ? pino(options, destination) : pino(options);
}
