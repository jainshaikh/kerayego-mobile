import { describe, expect, it } from '@jest/globals';

import { mapsNavigationUrl } from './openMapsNavigation';

describe('mapsNavigationUrl', () => {
  it('navigates to coordinates when the point has them', () => {
    expect(mapsNavigationUrl({ lat: 24.92, lng: 67.09, label: 'Gulshan' })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=24.92,67.09&travelmode=driving',
    );
  });

  it('searches for the label of a stop typed as free text', () => {
    expect(mapsNavigationUrl({ lat: null, lng: null, label: ' Liaquatabad No. 10 & Market ' })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Liaquatabad%20No.%2010%20%26%20Market&travelmode=driving',
    );
  });

  it('is null with neither coordinates nor a label', () => {
    expect(mapsNavigationUrl({ lat: null, lng: 67, label: '  ' })).toBeNull();
    expect(mapsNavigationUrl({})).toBeNull();
  });
});
