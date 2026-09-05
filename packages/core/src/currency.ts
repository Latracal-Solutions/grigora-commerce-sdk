import { clean } from "./util";

export interface FormatOptions {
  /** Text returned for a zero amount, e.g. "Free". Default: the formatted zero. */
  zeroLabel?: string;
}

export interface CurrencyAPI {
  /** Format an integer minor-unit amount (cents, paise) for display. */
  format(minorUnits: number, currency?: string, locale?: string, options?: FormatOptions): string;
  /** 29.99 -> 2999 */
  toMinor(majorUnits: number): number;
  /** 2999 -> 29.99 */
  toMajor(minorUnits: number): number;
  /** The currency symbol on its own, e.g. "$" or "₹". */
  symbol(currency?: string, locale?: string): string;
  /** The store default currency code in use. */
  code(): string;
}

/**
 * Grigora's API keeps every amount as an integer with two implied decimals
 * regardless of currency (its own formatter divides by 100 for JPY too), so
 * the SDK does the same rather than consulting the ISO minor-unit table. That
 * keeps `format` in agreement with the totals the API returns.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

export function toMinor(majorUnits: number): number {
  const n = Number(majorUnits);
  return Number.isFinite(n) ? Math.round(n * MINOR_UNITS_PER_MAJOR) : 0;
}

export function toMajor(minorUnits: number): number {
  const n = Number(minorUnits);
  return Number.isFinite(n) ? n / MINOR_UNITS_PER_MAJOR : 0;
}

export function normalizeCurrency(value: unknown, fallback = "USD"): string {
  const code = clean(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

export function formatMinor(minorUnits: number, currency = "USD", locale = "en-US", options: FormatOptions = {}): string {
  const code = normalizeCurrency(currency);
  const amount = toMajor(minorUnits);
  if (options.zeroLabel !== undefined && amount <= 0) return options.zeroLabel;
  try {
    return new Intl.NumberFormat(locale || "en-US", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

export function currencySymbol(currency = "USD", locale = "en-US"): string {
  const code = normalizeCurrency(currency);
  try {
    const parts = new Intl.NumberFormat(locale || "en-US", { style: "currency", currency: code }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value || code;
  } catch {
    return code;
  }
}

export function createCurrencyAPI(defaults: () => { currency: string; locale: string }): CurrencyAPI {
  return {
    format(minorUnits, currency, locale, options) {
      const d = defaults();
      return formatMinor(minorUnits, currency || d.currency, locale || d.locale, options);
    },
    toMinor,
    toMajor,
    symbol(currency, locale) {
      const d = defaults();
      return currencySymbol(currency || d.currency, locale || d.locale);
    },
    code() {
      return defaults().currency;
    },
  };
}
