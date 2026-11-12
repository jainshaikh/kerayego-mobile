import { RentalDurationType } from '../types/enums';

// Rental packages (PROVIDER_APP_PLAN §3c, A74, A79) — mirrors the backend's
// rental-packages.rules.ts. Pure.
// - Priced packages, at the car's own prices: 6 hours and 12 hours (single
//   packages, never multiplied — A74) and days, 1–6.
// - Week (1–4) and month (1–12) are "price to agree" (A79): the request has
//   no price and the business calls the customer. Only on cars the business
//   switched on for weekly & monthly rental (offersWeeklyMonthly, A84). 7 days
//   or more is a week or month request.
// The API field keeps its name (durationQuantity); the word "quantity" never
// shows — the count is named by its unit ("Number of days").

/** What a car's listing says about its packages. */
export interface RentalPackagePrices {
  pricePer6Hours?: string | number | null;
  pricePer12Hours?: string | number | null;
  pricePerDay: string | number;
  offersWeeklyMonthly?: boolean;
}

export const PRICE_TO_AGREE = 'Price to agree';

/** Week and month requests have no price — "price to agree" (A79). */
export function isPriceToAgree(type: RentalDurationType): boolean {
  return type === RentalDurationType.WEEK || type === RentalDurationType.MONTH;
}

/** Packages that take a count, and its limits; hour packages take none. */
export const COUNT_LIMITS: Record<RentalDurationType, { min: number; max: number } | null> = {
  [RentalDurationType.HOURS_6]: null,
  [RentalDurationType.HOURS_12]: null,
  [RentalDurationType.DAY]: { min: 1, max: 6 },
  [RentalDurationType.WEEK]: { min: 1, max: 4 },
  [RentalDurationType.MONTH]: { min: 1, max: 12 },
};

const COUNT_LABELS: Partial<Record<RentalDurationType, string>> = {
  [RentalDurationType.DAY]: 'Number of days',
  [RentalDurationType.WEEK]: 'Number of weeks',
  [RentalDurationType.MONTH]: 'Number of months',
};

/** The count's label ("Number of days"), or null for an hour package (no count). */
export function countLabel(type: RentalDurationType): string | null {
  return COUNT_LABELS[type] ?? null;
}

/**
 * Why this count can't be sent, or null when it can — the backend's
 * countError, word for word.
 */
export function countError(type: RentalDurationType, quantity: number | null | undefined): string | null {
  const limits = COUNT_LIMITS[type];
  if (!limits) return null;
  if (quantity == null || !Number.isInteger(quantity) || quantity < limits.min || quantity > limits.max) {
    if (type === RentalDurationType.DAY) return 'Choose 1 to 6 days. For 7 days or more, choose Week or Month.';
    if (type === RentalDurationType.WEEK) return 'Choose 1 to 4 weeks.';
    return 'Choose 1 to 12 months.';
  }
  return null;
}

/** A count kept within the package's limits; always 1 for an hour package. */
export function clampCount(type: RentalDurationType, quantity: number | null | undefined): number {
  const limits = COUNT_LIMITS[type];
  if (!limits) return 1;
  const n = quantity == null || !Number.isFinite(quantity) ? limits.min : Math.round(quantity);
  return Math.min(limits.max, Math.max(limits.min, n));
}

function toNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** The car's price for a priced package; null when it doesn't offer it (week/month: always null). */
export function unitPrice(car: RentalPackagePrices, type: RentalDurationType): number | null {
  if (type === RentalDurationType.HOURS_6) return toNumber(car.pricePer6Hours);
  if (type === RentalDurationType.HOURS_12) return toNumber(car.pricePer12Hours);
  if (type === RentalDurationType.DAY) return toNumber(car.pricePerDay);
  return null;
}

/**
 * The request's total as the app previews it — the car's price × the count
 * (hour packages: once). Null for week/month (price to agree) or a package
 * the car doesn't price. The backend works it out again and is the source of
 * truth.
 */
export function packageTotal(car: RentalPackagePrices, type: RentalDurationType, quantity: number): number | null {
  if (isPriceToAgree(type)) return null;
  const unit = unitPrice(car, type);
  if (unit === null) return null;
  return COUNT_LIMITS[type] ? unit * quantity : unit;
}

export interface PackageOption {
  type: RentalDurationType;
  // The chip's name: "6 hours", "12 hours", "Days", "Week", "Month".
  label: string;
  // The car's price for one unit; null = "Price to agree" (week/month).
  price: number | null;
}

const OPTION_LABELS: Record<RentalDurationType, string> = {
  [RentalDurationType.HOURS_6]: '6 hours',
  [RentalDurationType.HOURS_12]: '12 hours',
  [RentalDurationType.DAY]: 'Days',
  [RentalDurationType.WEEK]: 'Week',
  [RentalDurationType.MONTH]: 'Month',
};

/**
 * The packages a request for this car can choose, shortest first: the priced
 * ones it has a price for (days always — pricePerDay is required), then Week
 * and Month when the business switched the car on for weekly & monthly rental.
 */
export function packageOptions(car: RentalPackagePrices): PackageOption[] {
  const priced = [RentalDurationType.HOURS_6, RentalDurationType.HOURS_12, RentalDurationType.DAY]
    .map((type) => ({ type, label: OPTION_LABELS[type], price: unitPrice(car, type) }))
    .filter((option) => option.price !== null);
  const agreed = car.offersWeeklyMonthly
    ? [RentalDurationType.WEEK, RentalDurationType.MONTH].map((type) => ({ type, label: OPTION_LABELS[type], price: null }))
    : [];
  return [...priced, ...agreed];
}

/** The package a request starts on: Week for "Ask for a price" on a weekly & monthly car, else Days. */
export function defaultPackage(car: RentalPackagePrices, weeklyMonthly = false): RentalDurationType {
  if (weeklyMonthly && car.offersWeeklyMonthly) return RentalDurationType.WEEK;
  return RentalDurationType.DAY;
}

/**
 * How every app words a package (the backend's packageLabel): "6 hours",
 * "12 hours", "3 days", "1 week — price to agree". An old hour package with a
 * count shows as "6 hours × 2" (A74).
 */
export function packageLabel(type: RentalDurationType, quantity: number | null | undefined): string {
  const count = quantity ?? 1;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  switch (type) {
    case RentalDurationType.HOURS_6:
      return count > 1 ? `6 hours × ${count}` : '6 hours';
    case RentalDurationType.HOURS_12:
      return count > 1 ? `12 hours × ${count}` : '12 hours';
    case RentalDurationType.DAY:
      return plural(count, 'day', 'days');
    case RentalDurationType.WEEK:
      return `${plural(count, 'week', 'weeks')} — price to agree`;
    case RentalDurationType.MONTH:
      return `${plural(count, 'month', 'months')} — price to agree`;
  }
}

/**
 * When the rental ends — a preview (the backend works it out again). Weeks
 * are exactly 7 days; a month is "same day next month".
 */
export function computeReturnDate(from: Date, type: RentalDurationType, quantity: number): Date {
  const result = new Date(from);
  switch (type) {
    case RentalDurationType.HOURS_6:
      result.setHours(result.getHours() + 6 * quantity);
      break;
    case RentalDurationType.HOURS_12:
      result.setHours(result.getHours() + 12 * quantity);
      break;
    case RentalDurationType.DAY:
      result.setDate(result.getDate() + quantity);
      break;
    case RentalDurationType.WEEK:
      result.setDate(result.getDate() + 7 * quantity);
      break;
    case RentalDurationType.MONTH:
      result.setMonth(result.getMonth() + quantity);
      break;
  }
  return result;
}
