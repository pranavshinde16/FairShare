/**
 * The words that go with an amount (DESIGN_SPEC §3), so colour is never the only cue. Each returns
 * the words and a tone: "owed" (money coming to you), "owe" (money you owe) or "neutral".
 */
export type MoneyTone = 'owed' | 'owe' | 'neutral';
export type MoneyWords = { words: string; tone: MoneyTone };

/** My net in a group (row, header card). Zero: "settled up", or "no expenses yet" if there are none. */
export function groupWords(net: number, hasExpenses = true): MoneyWords {
  if (net > 0) return { words: 'you’re owed', tone: 'owed' };
  if (net < 0) return { words: 'you owe', tone: 'owe' };
  return { words: hasExpenses ? 'settled up' : 'no expenses yet', tone: 'neutral' };
}

/** What a friend and I owe each other (+: they owe me). */
export function personWords(balance: number): MoneyWords {
  if (balance > 0) return { words: 'owes you', tone: 'owed' };
  if (balance < 0) return { words: 'you owe', tone: 'owe' };
  return { words: 'settled up', tone: 'neutral' };
}

/** A history row's effect on me: lent/borrowed for an expense, paid/received for a payment. */
export function transactionWords(
  myNet: number,
  kind: 'expense' | 'payment',
  involved = true,
): MoneyWords {
  if (kind === 'payment') {
    if (myNet > 0) return { words: 'you paid', tone: 'owe' };
    if (myNet < 0) return { words: 'you received', tone: 'owed' };
    return { words: 'payment', tone: 'neutral' };
  }
  if (myNet > 0) return { words: 'you lent', tone: 'owed' };
  if (myNet < 0) return { words: 'you borrowed', tone: 'owe' };
  return { words: involved ? 'even' : 'not involved', tone: 'neutral' };
}

/** Everyone's balance in a group: "get back" for me, "gets back" / "owes" for others. */
export function memberWords(net: number, me: boolean): MoneyWords {
  if (net > 0) return { words: me ? 'get back' : 'gets back', tone: 'owed' };
  if (net < 0) return { words: me ? 'owe' : 'owes', tone: 'owe' };
  return { words: 'settled up', tone: 'neutral' };
}

/** Text colour for a tone. */
export const TONE_TEXT: Record<MoneyTone, string> = {
  owed: 'text-owed',
  owe: 'text-owe',
  neutral: 'text-muted-foreground',
};

/** "Priya N.": a first name and the last name's initial, for compact breakdown lines. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return name.trim();
  return `${words[0]} ${Array.from(words.at(-1)!)[0]!.toUpperCase()}.`;
}
