export type CurrencyCode = "USD" | "GBP" | "EUR";

// Display conversion for the pricing cards. Rates: USD per 1 unit of currency.
// The selected currency is sent to the Stripe checkout session, which is
// charged in that currency.
export const CURRENCIES: Record<CurrencyCode, { symbol: string; label: string; usdPerUnit: number }> = {
  USD: { symbol: "$", label: "US Dollar", usdPerUnit: 1 },
  GBP: { symbol: "£", label: "British Pound", usdPerUnit: 1.27 },
  EUR: { symbol: "€", label: "Euro", usdPerUnit: 1.08 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
