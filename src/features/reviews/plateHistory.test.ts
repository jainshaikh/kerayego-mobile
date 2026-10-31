import { describe, expect, it } from '@jest/globals';

import { plateHistoryText, rideCountLabel } from './plateHistory';

describe('rideCountLabel', () => {
  it('hides a missing or zero ride count', () => {
    expect(rideCountLabel(undefined)).toBeNull();
    expect(rideCountLabel(0)).toBeNull();
  });

  it('counts rides, singular and plural', () => {
    expect(rideCountLabel(1)).toBe('1 ride on KerayeGo');
    expect(rideCountLabel(12)).toBe('12 rides on KerayeGo');
  });
});

describe('plateHistoryText', () => {
  const TAIL = " Reviews stay with the car's plate.";

  it('is null without history', () => {
    expect(plateHistoryText(null)).toBeNull();
    expect(plateHistoryText(undefined)).toBeNull();
    expect(plateHistoryText({ rideCount: 0, reviewCount: 0, averageRating: null })).toBeNull();
  });

  it('shows rides and the rating', () => {
    expect(plateHistoryText({ rideCount: 12, reviewCount: 5, averageRating: 4.62 })).toBe(
      `This car has history on KerayeGo — 12 rides, ★ 4.6 from 5 reviews.${TAIL}`,
    );
  });

  it('uses singular forms', () => {
    expect(plateHistoryText({ rideCount: 1, reviewCount: 1, averageRating: 5 })).toBe(
      `This car has history on KerayeGo — 1 ride, ★ 5.0 from 1 review.${TAIL}`,
    );
  });

  it('leaves out rides when there are none', () => {
    expect(plateHistoryText({ rideCount: 0, reviewCount: 3, averageRating: 4 })).toBe(
      `This car has history on KerayeGo — ★ 4.0 from 3 reviews.${TAIL}`,
    );
  });

  it('leaves out the rating when there are no reviews', () => {
    expect(plateHistoryText({ rideCount: 7, reviewCount: 0, averageRating: null })).toBe(
      `This car has history on KerayeGo — 7 rides.${TAIL}`,
    );
  });

  it('leaves out the star when the average is null', () => {
    expect(plateHistoryText({ rideCount: 0, reviewCount: 2, averageRating: null })).toBe(
      `This car has history on KerayeGo — 2 reviews.${TAIL}`,
    );
  });
});
