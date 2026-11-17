import type { ParseResult } from '@fairshare/contracts';

/**
 * A sentence typed on Home, handed to the Add expense form of the group it was matched to, with
 * the server's read of it when Home asked for one (so it isn't read twice). Kept in memory only
 * (not the address), so what people type never ends up in server logs or history.
 *
 * Read with peekHandoff (safe to call twice, as StrictMode does with state initializers), then
 * cleared with clearHandoff once the form has it.
 */
export type Handoff = { text: string; result?: ParseResult };

const waiting = new Map<string, Handoff>();

export function handOff(groupId: string, text: string, result?: ParseResult) {
  waiting.set(groupId, { text, ...(result && { result }) });
}

export function peekHandoff(groupId: string): Handoff | undefined {
  return waiting.get(groupId);
}

export function clearHandoff(groupId: string) {
  waiting.delete(groupId);
}
