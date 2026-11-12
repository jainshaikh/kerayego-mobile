import { describe, expect, it } from '@jest/globals';

import { RentalDurationType } from '../types/enums';
import {
  clampCount,
  countError,
  countLabel,
  defaultPackage,
  isPriceToAgree,
  packageLabel,
  packageOptions,
  packageTotal,
  unitPrice,
} from './rentalDuration';

const { HOURS_6, HOURS_12, DAY, WEEK, MONTH } = RentalDurationType;

const everything = { pricePer6Hours: '3000', pricePer12Hours: '5000', pricePerDay: '8000', offersWeeklyMonthly: true };
const dayOnly = { pricePer6Hours: null, pricePer12Hours: null, pricePerDay: '8000', offersWeeklyMonthly: false };

describe('package choices (A74, A79, A84)', () => {
  it('lists the priced packages the car has a price for, then Week and Month when switched on', () => {
    expect(packageOptions(everything)).toEqual([
      { type: HOURS_6, label: '6 hours', price: 3000 },
      { type: HOURS_12, label: '12 hours', price: 5000 },
      { type: DAY, label: 'Days', price: 8000 },
      { type: WEEK, label: 'Week', price: null },
      { type: MONTH, label: 'Month', price: null },
    ]);
  });

  it('offers only days on a car with no hour prices and no weekly & monthly switch', () => {
    expect(packageOptions(dayOnly)).toEqual([{ type: DAY, label: 'Days', price: 8000 }]);
    // An older backend sends no switch: no week or month.
    expect(packageOptions({ pricePerDay: '8000' }).map((o) => o.type)).toEqual([DAY]);
  });

  it('starts on Week for "Ask for a price" on a weekly & monthly car, else on Days', () => {
    expect(defaultPackage(everything, true)).toBe(WEEK);
    expect(defaultPackage(dayOnly, true)).toBe(DAY);
    expect(defaultPackage(everything)).toBe(DAY);
  });
});

describe('the count', () => {
  it('names the count by its unit, and hour packages take none', () => {
    expect(countLabel(DAY)).toBe('Number of days');
    expect(countLabel(WEEK)).toBe('Number of weeks');
    expect(countLabel(MONTH)).toBe('Number of months');
    expect(countLabel(HOURS_6)).toBeNull();
    expect(countLabel(HOURS_12)).toBeNull();
  });

  it('keeps the backend’s limits: days 1–6, weeks 1–4, months 1–12', () => {
    expect(countError(DAY, 6)).toBeNull();
    expect(countError(DAY, 7)).toBe('Choose 1 to 6 days. For 7 days or more, choose Week or Month.');
    expect(countError(WEEK, 5)).toBe('Choose 1 to 4 weeks.');
    expect(countError(MONTH, 13)).toBe('Choose 1 to 12 months.');
    expect(countError(MONTH, 0)).toBe('Choose 1 to 12 months.');
    expect(countError(HOURS_12, 1)).toBeNull();
  });

  it('clamps a count into those limits, and an hour package to 1', () => {
    expect(clampCount(DAY, 9)).toBe(6);
    expect(clampCount(WEEK, 0)).toBe(1);
    expect(clampCount(MONTH, 12)).toBe(12);
    expect(clampCount(HOURS_6, 4)).toBe(1);
    expect(clampCount(DAY, null)).toBe(1);
  });
});

describe('prices', () => {
  it('reads the car’s price per package; week and month have none', () => {
    expect(unitPrice(everything, HOURS_6)).toBe(3000);
    expect(unitPrice(dayOnly, HOURS_12)).toBeNull();
    expect(unitPrice(everything, WEEK)).toBeNull();
  });

  it('previews the total: days × the day price, an hour package once, week/month none', () => {
    expect(packageTotal(everything, DAY, 3)).toBe(24000);
    expect(packageTotal(everything, HOURS_12, 1)).toBe(5000);
    expect(isPriceToAgree(MONTH)).toBe(true);
    expect(packageTotal(everything, MONTH, 2)).toBeNull();
    expect(packageTotal(dayOnly, HOURS_6, 1)).toBeNull();
  });
});

describe('packageLabel (the backend’s wording)', () => {
  it.each([
    [HOURS_6, 1, '6 hours'],
    [HOURS_12, 1, '12 hours'],
    [DAY, 1, '1 day'],
    [DAY, 3, '3 days'],
    [WEEK, 1, '1 week — price to agree'],
    [MONTH, 2, '2 months — price to agree'],
    // An old hour package with a count (A74).
    [HOURS_6, 2, '6 hours × 2'],
  ])('%s × %i → %s', (type, quantity, label) => {
    expect(packageLabel(type, quantity)).toBe(label);
  });
});
