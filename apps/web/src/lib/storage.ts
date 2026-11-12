// localStorage and sessionStorage can throw (blocked storage, private mode, sandboxed frames),
// and nothing stored here is essential, so every access is wrapped.

type Area = 'local' | 'session';

const area = (which: Area) => (which === 'local' ? window.localStorage : window.sessionStorage);

export function readStored(which: Area, key: string): string | null {
  try {
    return area(which).getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(which: Area, key: string, value: string | null): void {
  try {
    if (value === null) area(which).removeItem(key);
    else area(which).setItem(key, value);
  } catch {
    // Not stored; the app still works, it just won't remember.
  }
}
