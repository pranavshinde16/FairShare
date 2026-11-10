/**
 * 32-bit FNV-1a over the string's UTF-16 code units. Small, fast and identical in every JavaScript
 * engine, so the browser preview and the server always derive the same rounding rotation.
 * Not cryptographic, and doesn't need to be.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
