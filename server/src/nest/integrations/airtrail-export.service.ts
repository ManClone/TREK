import { Reservations } from '../../db/entities/Reservations.entity';
import { ReservationsRepository } from '../../db/repositories/Reservations.repository';
import { ReservationsReadService } from '../reservations/reservations-read.service';
import { buildCreateFlightPayload } from './airtrail-export.helpers';
import { AirtrailClient, AirtrailRequestError } from './airtrail.client';
import { canonicalHash } from './airtrail.mapper';
import { AirtrailService } from './airtrail.service';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AirtrailExportService {
  constructor(
    @InjectRepository(Reservations) private readonly reservations: ReservationsRepository,
    private readonly reads: ReservationsReadService,
    private readonly airtrail: AirtrailService,
    private readonly client: AirtrailClient,
  ) {}

  async exportFlight(tripId: number, reservationId: number, userId: number) {
    if (!(await this.airtrail.isAirtrailWriteEnabled(userId))) {
      throw new AirtrailRequestError('Enable AirTrail write-back first', 403);
    }
    const creds = await this.airtrail.getAirtrailCredentials(userId);
    if (!creds) throw new AirtrailRequestError('AirTrail is not connected', 400);

    const reservation = await this.reads.getReservationWithJoins(reservationId);
    if (!reservation || Number(reservation.trip_id) !== tripId) {
      throw new AirtrailRequestError('Reservation not found in trip', 404);
    }
    const payload = buildCreateFlightPayload(reservation);
    if (!payload) throw new AirtrailRequestError('Only complete, unlinked single-leg flights can be exported', 400);

    const existing = await this.client.listFlights(creds);
    const duplicates = existing.filter((f) =>
      (f.from?.iata ?? f.from?.icao) === payload.from &&
      (f.to?.iata ?? f.to?.icao) === payload.to &&
      (f.departureScheduled ?? f.departure ?? '').slice(0, 10) === payload.departure &&
      f.flightNumber === payload.flightNumber,
    );
    if (duplicates.length) throw new AirtrailRequestError('Matching AirTrail flight already exists', 409);

    if (!(await this.reservations.claimAirtrailExport(reservationId, tripId, userId))) {
      throw new AirtrailRequestError('Flight already linked or being exported', 409);
    }

    // Preserve the pending claim after an uncertain remote result.
    // A second create must not run until the first has been reconciled.
    const saved = await this.client.saveFlight(creds, payload);
    if (!saved.id || !Number.isSafeInteger(saved.id) || saved.id <= 0) {
      throw new AirtrailRequestError('Export needs manual reconciliation: no AirTrail ID returned', 502);
    }
    const remote = await this.client.getFlight(creds, saved.id);
    if (!remote) throw new AirtrailRequestError('Export needs manual reconciliation: remote flight not readable', 502);
    if (!(await this.reservations.finishAirtrailExport(reservationId, userId, String(saved.id), canonicalHash(remote)))) {
      throw new AirtrailRequestError('Export needs manual reconciliation: link could not be saved', 500);
    }
    return { success: true, reservationId, airtrailFlightId: saved.id };
  }
}
