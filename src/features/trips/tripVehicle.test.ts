import { describe, expect, it } from '@jest/globals';

import { Market } from '../../types/enums';
import { tripVehicle } from './tripVehicle';

const ownCar = {
  id: 'uv-1',
  make: 'toyota',
  model: 'corolla',
  year: 2019,
  color: 'white',
  plateNumber: 'ABC-123',
  country: Market.SA,
  images: [{ id: 'img-1', url: 'https://example.com/a.jpg', altText: null }],
};

const fleetCar = {
  id: 'v-1',
  title: '2023 Toyota Camry SE',
  make: 'toyota',
  model: 'camry',
  year: 2023,
  images: [{ url: 'https://example.com/b.jpg', altText: 'Camry' }],
};

describe('tripVehicle', () => {
  it("reads the poster's own car on a normal trip", () => {
    expect(tripVehicle({ isReturnTrip: false, userVehicle: ownCar, fleetVehicle: null })).toEqual({
      id: 'uv-1',
      isFleet: false,
      name: 'Toyota Corolla',
      year: 2019,
      color: 'white',
      plateNumber: 'ABC-123',
      country: Market.SA,
      images: ownCar.images,
    });
  });

  it("reads the business's fleet car on a return trip, whose userVehicle is null", () => {
    expect(tripVehicle({ isReturnTrip: true, userVehicle: null, fleetVehicle: fleetCar })).toEqual({
      id: 'v-1',
      isFleet: true,
      name: '2023 Toyota Camry SE',
      year: 2023,
      color: null,
      plateNumber: null,
      country: undefined,
      images: fleetCar.images,
    });
  });

  it("reads a trip-inquiry response's own car, which carries no id", () => {
    const { id: _id, ...noId } = ownCar;
    const vehicle = tripVehicle({ isReturnTrip: false, userVehicle: noId });
    expect(vehicle?.id).toBeUndefined();
    expect(vehicle?.name).toBe('Toyota Corolla');
    expect(vehicle?.plateNumber).toBe('ABC-123');
  });

  it('is null when the backend sent no vehicle for the trip', () => {
    expect(tripVehicle({ isReturnTrip: true, userVehicle: null, fleetVehicle: null })).toBeNull();
    expect(tripVehicle({ isReturnTrip: false, userVehicle: null, fleetVehicle: null })).toBeNull();
  });
});
