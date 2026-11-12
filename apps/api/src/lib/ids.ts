import { randomBytes } from 'node:crypto';

/**
 * Makes UUIDv7s (RFC 9562): 48 bits of Unix milliseconds, a 12-bit counter, then random bits.
 * IDs from one generator only ever increase (the RFC's "method 1"): within a millisecond the
 * counter goes up, and if it runs out the time moves on by a millisecond. So rows created together,
 * such as the people added with a new group, sort in the order they were made, and primary-key
 * indexes stay compact.
 */
export function createUuidV7(clock: () => number = Date.now): () => string {
  let lastMs = -1;
  let counter = 0;
  return () => {
    let ms = clock();
    if (ms > lastMs) {
      // A fresh millisecond: start the counter at a random point in its lower half, leaving room.
      counter = randomBytes(2).readUInt16BE(0) & 0x7ff;
    } else {
      ms = lastMs;
      counter++;
      if (counter > 0xfff) {
        ms++;
        counter = 0;
      }
    }
    lastMs = ms;

    const bytes = randomBytes(16);
    bytes.writeUIntBE(ms, 0, 6);
    bytes[6] = 0x70 | (counter >> 8); // version 7, then the counter's top 4 bits
    bytes[7] = counter & 0xff;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

/** The server's UUIDv7s: increasing across everything this process creates. */
export const uuidv7 = createUuidV7();
