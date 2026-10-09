import { Market } from '../types/enums';

// Mirrors kerayego-backend/src/config/markets.config.ts (and web's
// lib/config/markets.ts) — only the fields this app reads. Keep in sync if a
// market is added or its currency changes.
export interface MarketMeta {
  code: Market;
  label: string;
  currencyCode: string;
}

export const MARKETS: Record<Market, MarketMeta> = {
  [Market.PK]: { code: Market.PK, label: 'Pakistan', currencyCode: 'PKR' },
  [Market.SA]: { code: Market.SA, label: 'Saudi Arabia', currencyCode: 'SAR' },
  [Market.AE]: { code: Market.AE, label: 'United Arab Emirates', currencyCode: 'AED' },
};

// Existing data predates the Market concept entirely, so PK (the original,
// only market) is the correct default — same as the backend and web.
export const DEFAULT_MARKET: Market = Market.PK;

/**
 * The currency a trip's prices are in: a trip inherits its market from the
 * vehicle it was posted with (UserVehicle.country). Anything unknown or
 * missing falls back to the default market's currency.
 */
export function currencyForMarket(market: Market | string | null | undefined): string {
  const meta = market ? MARKETS[market as Market] : undefined;
  return (meta ?? MARKETS[DEFAULT_MARKET]).currencyCode;
}
