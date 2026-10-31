import { describe, expect, it } from 'vitest';
import { buildCreateFlightPayload } from './airtrail-export.helpers';

const flight = {
  id: 72,
  type: 'flight',
  external_source: null,
  external_id: null,
  metadata: JSON.stringify({ flight_number: 'DE1750', airline_code: 'CFG', seat: '12A' }),
  reservation_time: '2026-08-09T05:50:00',
  reservation_end_time: '2026-08-09T09:10:00',
  endpoints: [{ role: 'from', code: 'MUC' }, { role: 'to', code: 'ZTH' }],
  notes: 'Test',
};

describe('buildCreateFlightPayload', () => {
  it('creates a new flight without an AirTrail id and preserves local wall-clock times', () => {
    const payload = buildCreateFlightPayload(flight);
    expect(payload).toMatchObject({
      from: 'MUC', to: 'ZTH', departure: '2026-08-09', departureTime: '05:50',
      arrival: '2026-08-09', arrivalTime: '09:10', flightNumber: 'DE1750',
      passengers: [{ userId: '<USER_ID>', seatNumber: '12A' }],
    });
    expect(payload).not.toHaveProperty('id');
  });

  it('accepts SQL-style local datetime values', () => {
    expect(buildCreateFlightPayload({ ...flight, reservation_time: '2026-08-09 05:50:00' })?.departureTime).toBe('05:50');
  });

  it('rejects linked, multi-leg and incomplete reservations', () => {
    expect(buildCreateFlightPayload({ ...flight, external_source: 'airtrail' })).toBeNull();
    expect(buildCreateFlightPayload({ ...flight, external_id: '123' })).toBeNull();
    expect(buildCreateFlightPayload({ ...flight, metadata: JSON.stringify({ legs: [{}, {}] }) })).toBeNull();
    expect(buildCreateFlightPayload({ ...flight, endpoints: [flight.endpoints[0]] })).toBeNull();
    expect(buildCreateFlightPayload({ ...flight, type: 'hotel' })).toBeNull();
    expect(buildCreateFlightPayload({ ...flight, reservation_time: null })).toBeNull();
  });
});
