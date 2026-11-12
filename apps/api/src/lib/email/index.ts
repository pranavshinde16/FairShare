import type { Env } from '../../config/env';
import { createMailpitSender } from './mailpit';
import { createResendSender } from './resend';
import type { EmailSender } from './sender';

/** The local sender address, when EMAIL_FROM isn't set (Mailpit accepts anything). */
const LOCAL_FROM = 'FairShare <codes@fairshare.local>';

/** Resend when it has a key, otherwise the local Mailpit inbox. loadEnv ensures one of them. */
export function createEmailSender(
  env: Pick<Env, 'RESEND_API_KEY' | 'MAILPIT_URL' | 'EMAIL_FROM'>,
): EmailSender {
  if (env.RESEND_API_KEY) {
    return createResendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? LOCAL_FROM });
  }
  if (env.MAILPIT_URL) {
    return createMailpitSender({ url: env.MAILPIT_URL, from: env.EMAIL_FROM ?? LOCAL_FROM });
  }
  throw new Error('No email transport: set RESEND_API_KEY or MAILPIT_URL');
}

export type { EmailMessage, EmailSender } from './sender';
