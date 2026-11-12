/**
 * A UUIDv7 for a new row (RFC 9562): 48 bits of Unix milliseconds, then random bits. Creates send
 * a client-made ID, so a retried request can't create the thing twice.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
