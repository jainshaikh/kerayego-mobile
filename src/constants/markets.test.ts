import { describe, expect, it } from '@jest/globals';

import { Market } from '../types/enums';
import { currencyForMarket, DEFAULT_MARKET, MARKETS } from './markets';

// Hand-copied from kerayego-backend src/config/markets.config.ts (and web's
// lib/config/markets.ts) — no shared package between the repos.
const BACKEND_MARKET_CURRENCIES: Record<Market, string> = {
  [Market.PK]: 'PKR',
  [Market.SA]: 'SAR',
  [Market.AE]: 'AED',
};

describe('markets', () => {
  it.each(Object.values(Market))('%s uses the backend currency', (market) => {
    expect(MARKETS[market].currencyCode).toBe(BACKEND_MARKET_CURRENCIES[market]);
    expect(currencyForMarket(market)).toBe(BACKEND_MARKET_CURRENCIES[market]);
  });

  it('defaults to Pakistan, the original market, like the backend and web', () => {
    expect(DEFAULT_MARKET).toBe(Market.PK);
  });

  it('falls back to the default currency for a missing or unknown market', () => {
    expect(currencyForMarket(undefined)).toBe('PKR');
    expect(currencyForMarket(null)).toBe('PKR');
    expect(currencyForMarket('XX')).toBe('PKR');
  });
});
