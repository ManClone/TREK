import { RESERVATION_METADATA } from '../../db/json-columns';
import { decodeJson } from '../../utils/json-column';
import type { AirtrailSavePayload, AirtrailPassengerWrite } from './airtrail.client';

/**
 * Prepare a new AirTrail flight without modifying any existing AirTrail record.
 * This is intentionally separate from buildSavePayload (which is update-only).
 * The caller must enforce authorization, duplicate checks, and persist the link.
 */
export function buildCreateFlightPayload(reservation: any): AirtrailSavePayload | null {
  if (reservation.type !== 'flight') return null;
  const metadata = decodeJson(RESERVATION_METADATA, reservation.metadata, `reservation ${reservation.id}`);
  if (Array.isArray(metadata.legs) && metadata.legs.length > 1) return null;
  const endpoints: any[] = reservation.endpoints ?? [];
  if (endpoints.length !== 2) return null;
  const from = endpoints.find((e) => e.role === 'from')?.code;
  const to = endpoints.find((e) => e.role === 'to')?.code;
  if (typeof from !== 'string' || typeof to !== 'string' || !/^[A-Z]{3,4}$/i.test(from) || !/^[A-Z]{3,4}$/i.test(to)) return null;
  const departure = splitFlightDate(reservation.reservation_time);
  const arrival = splitFlightDate(reservation.reservation_end_time);
  if (!departure || !arrival) return null;
  const passenger: AirtrailPassengerWrite = {
    userId: '<USER_ID>',
    guestName: null,
    seat: null,
    seatNumber: typeof metadata.seat === 'string' ? metadata.seat : null,
    seatClass: null,
  };
  const passengers = [passenger];
  return {
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    departure: departure.date,
    departureTime: departure.time,
    arrival: arrival.date,
    arrivalTime: arrival.time,
    departureScheduled: `${departure.date}T00:00:00.000Z`,
    departureScheduledTime: departure.time,
    arrivalScheduled: `${arrival.date}T00:00:00.000Z`,
    arrivalScheduledTime: arrival.time,
    airline: typeof metadata.airline_code === 'string' ? metadata.airline_code : null,
    flightNumber: typeof metadata.flight_number === 'string' ? metadata.flight_number : null,
    note: reservation.notes ?? null,
    seats: passengers,
    passengers,
  };
}

function splitFlightDate(value: unknown): { date: string; time: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (!match) return null;
  return { date: match[1], time: match[2] };
}
