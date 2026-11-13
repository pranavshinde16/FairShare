/**
 * A sentence typed on Home, handed to the Add expense form of the group it was matched to. Kept in
 * memory only (not the address), so what people type never ends up in server logs or history.
 *
 * Read with peekHandoff (safe to call twice, as StrictMode does with state initializers), then
 * cleared with clearHandoff once the form has it.
 */
const waiting = new Map<string, string>();

export function handOff(groupId: string, text: string) {
  waiting.set(groupId, text);
}

export function peekHandoff(groupId: string): string | undefined {
  return waiting.get(groupId);
}

export function clearHandoff(groupId: string) {
  waiting.delete(groupId);
}
