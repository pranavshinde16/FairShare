export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Shares a link with the system share sheet (which offers WhatsApp on phones), or copies it where
 * there's no share sheet, as on most desktops.
 */
export async function shareLink(url: string, title: string, text: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Some browsers refuse (no user gesture, not allowed): fall back to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
