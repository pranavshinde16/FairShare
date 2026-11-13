import { describe, expect, it } from 'vitest';
import { formatAmount, formatAmountInput, formatWholeAmount, plural } from './money';
import { groupWords, memberWords, personWords, shortName, transactionWords } from './money-words';
import { TILE_TONES, tileTone } from './tile';

describe('formatAmount (DESIGN_SPEC §3)', () => {
  it('groups in the Indian way with two decimals for rupees', () => {
    expect(formatAmount(2_841_700, 'INR', 2)).toBe('₹28,417.00');
    expect(formatAmount(12_841_700, 'INR', 2)).toBe('₹1,28,417.00');
    expect(formatAmount(5, 'INR', 2)).toBe('₹0.05');
  });

  it('keeps another currency’s symbol and decimals', () => {
    expect(formatAmount(15_000, 'USD', 2)).toBe('$150.00');
    expect(formatAmount(1500, 'JPY', 0)).toMatch(/¥1,500$/);
  });

  it('shows whole units only for the per-person tiles', () => {
    expect(formatWholeAmount(75_000, 'INR', 2)).toBe('₹750');
    expect(formatWholeAmount(33_334, 'INR', 2)).toBe('₹333');
    expect(formatWholeAmount(120_000, 'JPY', 0)).toMatch(/¥1,20,000$/);
  });

  it('writes digits only for an amount field, which parseMoney reads back', () => {
    expect(formatAmountInput(12_841_700, 2)).toBe('1,28,417.00');
  });
});

describe('plural', () => {
  it('says 1 person and 5 people', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(5, 'person', 'people')).toBe('5 people');
    expect(plural(0, 'share', 'shares')).toBe('0 shares');
  });
});

describe('money words (DESIGN_SPEC §3)', () => {
  it('names a group balance, and a group at zero with or without expenses', () => {
    expect(groupWords(100)).toEqual({ words: 'you’re owed', tone: 'owed' });
    expect(groupWords(-100)).toEqual({ words: 'you owe', tone: 'owe' });
    expect(groupWords(0)).toEqual({ words: 'settled up', tone: 'neutral' });
    expect(groupWords(0, false)).toEqual({ words: 'no expenses yet', tone: 'neutral' });
  });

  it('names a friend balance', () => {
    expect(personWords(1).words).toBe('owes you');
    expect(personWords(-1).words).toBe('you owe');
    expect(personWords(0).words).toBe('settled up');
  });

  it('names a history row’s effect on me', () => {
    expect(transactionWords(1, 'expense')).toEqual({ words: 'you lent', tone: 'owed' });
    expect(transactionWords(-1, 'expense')).toEqual({ words: 'you borrowed', tone: 'owe' });
    expect(transactionWords(0, 'expense', false).words).toBe('not involved');
    expect(transactionWords(-1, 'payment')).toEqual({ words: 'you received', tone: 'owed' });
    expect(transactionWords(1, 'payment')).toEqual({ words: 'you paid', tone: 'owe' });
  });

  it('names everyone’s balance, in the first person for me', () => {
    expect(memberWords(1, true).words).toBe('get back');
    expect(memberWords(1, false).words).toBe('gets back');
    expect(memberWords(-1, false).words).toBe('owes');
    expect(memberWords(0, false).words).toBe('settled up');
  });

  it('shortens a name to the first name and an initial', () => {
    expect(shortName('Priya Nair')).toBe('Priya N.');
    expect(shortName('Asha Rani Kapoor')).toBe('Asha K.');
    expect(shortName('Bilal')).toBe('Bilal');
  });
});

describe('tileTone', () => {
  it('gives the same id the same tone, and spreads ids over all four', () => {
    expect(tileTone('user-1')).toBe(tileTone('user-1'));
    const tones = new Set(Array.from({ length: 40 }, (_, i) => tileTone(`id-${i}`)));
    expect([...tones].sort()).toEqual([...TILE_TONES].sort());
  });
});
