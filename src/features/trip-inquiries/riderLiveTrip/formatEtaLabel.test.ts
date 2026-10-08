import { describe, expect, it } from '@jest/globals';

import { formatEtaLabel } from './formatEtaLabel';

describe('formatEtaLabel', () => {
  it.each([0, 0.4, -3])('reads %p minutes as "Arriving now"', (minutes) => {
    expect(formatEtaLabel(minutes)).toBe('Arriving now');
  });

  it.each([
    [0.5, '~1 min'],
    [1, '~1 min'],
    [12.4, '~12 min'],
    [12.6, '~13 min'],
    [90, '~90 min'],
  ])('rounds %p minutes to %p', (minutes, label) => {
    expect(formatEtaLabel(minutes)).toBe(label);
  });
});
