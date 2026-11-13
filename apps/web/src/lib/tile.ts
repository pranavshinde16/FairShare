/**
 * The tile colour for an avatar or a group (DESIGN_SPEC §4): one of four, picked from the id, so the
 * same person or group always gets the same colour on every screen and device.
 */
export const TILE_TONES = ['gold', 'blue', 'pink', 'green'] as const;
export type TileTone = (typeof TILE_TONES)[number];

/** Background and text classes, spelled out so Tailwind sees them. */
export const TILE_CLASSES: Record<TileTone, string> = {
  gold: 'bg-tile-gold text-tile-gold-foreground',
  blue: 'bg-tile-blue text-tile-blue-foreground',
  pink: 'bg-tile-pink text-tile-pink-foreground',
  green: 'bg-tile-green text-tile-green-foreground',
};

/** FNV-1a (32-bit): fast, stable across browsers, and spreads similar ids apart. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tileTone(seed: string): TileTone {
  return TILE_TONES[hash(seed) % TILE_TONES.length]!;
}
