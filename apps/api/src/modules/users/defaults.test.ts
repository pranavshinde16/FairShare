import { CURRENCIES } from '@fairshare/db';
import { describe, expect, it } from 'vitest';
import {
  CURRENCY_REGIONS,
  DEFAULT_CURRENCY,
  FALLBACK_NAME,
  currencyFromAcceptLanguage,
  initialName,
  nameFromEmail,
} from './defaults';

describe('nameFromEmail', () => {
  it('turns the part before @ into words', () => {
    expect(nameFromEmail('asha.kapoor@example.com')).toBe('Asha Kapoor');
    expect(nameFromEmail('bilal_k-99@example.com')).toBe('Bilal K 99');
    expect(nameFromEmail('CHITRA@example.com')).toBe('Chitra');
  });

  it('drops a +tag', () => {
    expect(nameFromEmail('dev+trips@example.com')).toBe('Dev');
  });

  it('falls back when nothing usable is left', () => {
    expect(nameFromEmail('...@example.com')).toBe(FALLBACK_NAME);
    expect(nameFromEmail('+tag@example.com')).toBe(FALLBACK_NAME);
  });

  it('stays within the 60-character column', () => {
    expect(nameFromEmail(`${'a'.repeat(80)}@example.com`)).toHaveLength(60);
  });
});

describe('initialName', () => {
  it('prefers the name Google provides, tidied', () => {
    expect(initialName('  Asha   Kapoor ', 'asha@example.com')).toBe('Asha Kapoor');
  });

  it('uses the email when the auth name is empty (email-code sign-up)', () => {
    expect(initialName('', 'asha.kapoor@example.com')).toBe('Asha Kapoor');
    expect(initialName('   ', 'asha@example.com')).toBe('Asha');
  });

  it('cuts a long name at 60 without splitting a two-unit character', () => {
    const name = initialName(`${'a'.repeat(59)}😀b`, 'x@example.com');
    expect(name).toBe('a'.repeat(59));
    expect(initialName('😀'.repeat(40), 'x@example.com')).toBe('😀'.repeat(30));
  });
});

describe('currencyFromAcceptLanguage', () => {
  it('uses the region of the most preferred language', () => {
    expect(currencyFromAcceptLanguage('en-IN,en;q=0.9,hi;q=0.8')).toBe('INR');
    expect(currencyFromAcceptLanguage('en-GB,en;q=0.9')).toBe('GBP');
    expect(currencyFromAcceptLanguage('de-DE')).toBe('EUR');
    expect(currencyFromAcceptLanguage('ja-JP')).toBe('JPY');
  });

  it('honours q-values over the listed order', () => {
    expect(currencyFromAcceptLanguage('en-US;q=0.5, en-SG;q=0.9')).toBe('SGD');
  });

  it('skips languages without a region and regions without a supported currency', () => {
    expect(currencyFromAcceptLanguage('en, fr-CA;q=0.8')).toBe('CAD');
    expect(currencyFromAcceptLanguage('es-AR, en-AU;q=0.5')).toBe('AUD');
  });

  it('defaults to INR for a missing, empty, regionless or malformed header', () => {
    for (const header of [undefined, null, '', 'en', 'hi,ta', '*', '!!!;q=1', 'en-US;q=0']) {
      expect(currencyFromAcceptLanguage(header)).toBe(DEFAULT_CURRENCY);
    }
  });

  it('reads script subtags and lower-case regions', () => {
    expect(currencyFromAcceptLanguage('zh-Hant-HK')).toBe('HKD');
    expect(currencyFromAcceptLanguage('en-in')).toBe('INR');
  });
});

describe('CURRENCY_REGIONS', () => {
  it('names only seeded currencies, and each region once', () => {
    const seeded = new Set(CURRENCIES.map((c) => c.code));
    for (const currency of Object.keys(CURRENCY_REGIONS)) expect(seeded).toContain(currency);
    const regions = Object.values(CURRENCY_REGIONS).flat();
    expect(new Set(regions).size).toBe(regions.length);
  });

  it('covers every seeded currency', () => {
    expect(Object.keys(CURRENCY_REGIONS).sort()).toEqual(CURRENCIES.map((c) => c.code).sort());
  });
});
