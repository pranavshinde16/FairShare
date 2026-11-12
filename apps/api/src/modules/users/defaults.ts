// What a new user starts with: a name and a default currency, both editable later.

/** users.name holds 1–60 characters. */
const MAX_NAME_LENGTH = 60;

/** Used when nothing better can be derived, e.g. an email whose local part is all symbols. */
export const FALLBACK_NAME = 'FairShare user';

/** The app's home market, and the default when the browser's region says nothing better. */
export const DEFAULT_CURRENCY = 'INR';

/**
 * The display name for a new account: the name from Google when there is one, otherwise one made
 * from the email address ("asha.kapoor+trips@example.com" → "Asha Kapoor").
 */
export function initialName(authName: string, email: string): string {
  return truncate(authName.trim().replace(/\s+/g, ' ')) || nameFromEmail(email);
}

export function nameFromEmail(email: string): string {
  const local = email.split('@')[0]!.split('+')[0]!;
  const words = local
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
  return truncate(words.join(' ')) || FALLBACK_NAME;
}

/** Cuts to the column's limit without splitting a character made of two UTF-16 units. */
function truncate(name: string): string {
  let out = '';
  for (const char of name) {
    if (out.length + char.length > MAX_NAME_LENGTH) break;
    out += char;
  }
  return out.trim();
}

/**
 * The regions (ISO 3166-1, as in a browser locale like en-IN) that use each supported currency.
 * Every key must be a currency in the seeded currencies table.
 */
export const CURRENCY_REGIONS: Readonly<Record<string, readonly string[]>> = {
  INR: ['IN'],
  USD: ['US', 'PR', 'EC', 'SV'],
  // The euro area, plus the microstates that use the euro.
  EUR: [
    'AT',
    'BE',
    'HR',
    'CY',
    'EE',
    'FI',
    'FR',
    'DE',
    'GR',
    'IE',
    'IT',
    'LV',
    'LT',
    'LU',
    'MT',
    'NL',
    'PT',
    'SK',
    'SI',
    'ES',
    'AD',
    'MC',
    'SM',
    'VA',
    'ME',
    'XK',
  ],
  GBP: ['GB', 'IM', 'JE', 'GG'],
  AED: ['AE'],
  SAR: ['SA'],
  QAR: ['QA'],
  KWD: ['KW'],
  BHD: ['BH'],
  OMR: ['OM'],
  SGD: ['SG'],
  MYR: ['MY'],
  THB: ['TH'],
  IDR: ['ID'],
  PHP: ['PH'],
  VND: ['VN'],
  JPY: ['JP'],
  KRW: ['KR'],
  CNY: ['CN'],
  HKD: ['HK'],
  LKR: ['LK'],
  NPR: ['NP'],
  BDT: ['BD'],
  AUD: ['AU'],
  NZD: ['NZ'],
  CAD: ['CA'],
  CHF: ['CH', 'LI'],
  SEK: ['SE'],
  NOK: ['NO'],
  DKK: ['DK', 'FO', 'GL'],
  ZAR: ['ZA'],
  BRL: ['BR'],
  MXN: ['MX'],
  TRY: ['TR'],
};

const REGION_CURRENCY = new Map(
  Object.entries(CURRENCY_REGIONS).flatMap(([currency, regions]) =>
    regions.map((region) => [region, currency] as const),
  ),
);

/**
 * Guesses a default currency from the browser's Accept-Language header: the first language, in
 * preference order, that names a region we have a currency for. "en-GB,en;q=0.9" → GBP.
 * A language without a region ("en", "hi") says nothing about where someone is, so it's skipped;
 * with no usable region the answer is INR.
 */
export function currencyFromAcceptLanguage(header: string | null | undefined): string {
  const languages = (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((language) => language.tag && language.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { tag } of languages) {
    const region = regionOf(tag);
    const currency = region && REGION_CURRENCY.get(region);
    if (currency) return currency;
  }
  return DEFAULT_CURRENCY;
}

function regionOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).region;
  } catch {
    return undefined; // not a valid language tag
  }
}
