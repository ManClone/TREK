import { describe, expect, it, vi } from 'vitest';
import { AirtrailExportService } from './airtrail-export.service';

const reservation = {
  id: 72, trip_id: 9, type: 'flight', external_source: null, external_id: null,
  metadata: '{"flight_number":"DE1750"}',
  reservation_time: '2027-07-12T10:00:00',
  reservation_end_time: '2027-07-12T13:00:00',
  endpoints: [{ role: 'from', code: 'MUC' }, { role: 'to', code: 'ZTH' }],
};
function setup() {
  const repo = {
    claimAirtrailExport: vi.fn().mockResolvedValue(true),
    finishAirtrailExport: vi.fn().mockResolvedValue(true),
  };
  const reads = { getReservationWithJoins: vi.fn().mockResolvedValue(reservation) };
  const airtrail = {
    isAirtrailWriteEnabled: vi.fn().mockResolvedValue(true),
    getAirtrailCredentials: vi.fn().mockResolvedValue({ baseUrl: 'https://example.test', apiKey: 'test' }),
  };
  const client = {
    listFlights: vi.fn().mockResolvedValue([]),
    saveFlight: vi.fn().mockResolvedValue({ id: 42 }),
    getFlight: vi.fn().mockResolvedValue({
      id: 42, from: { iata: 'MUC' }, to: { iata: 'ZTH' },
      departure: '2027-07-12T10:00:00Z', arrival: '2027-07-12T13:00:00Z',
      flightNumber: 'DE1750', passengers: [],
    }),
  };
  const service = new AirtrailExportService(repo as any, reads as any, airtrail as any, client as any);
  return { service, repo, reads, airtrail, client };
}
describe('AirtrailExportService', () => {
  it('creates and links an explicitly exported flight', async () => {
    const { service, repo, client } = setup();
    await expect(service.exportFlight(9, 72, 1)).resolves.toMatchObject({ airtrailFlightId: 42 });
    expect(client.saveFlight).toHaveBeenCalledOnce();
    expect(repo.finishAirtrailExport).toHaveBeenCalledOnce();
  });
  it('refuses users without write opt-in', async () => {
    const { service, airtrail, client } = setup();
    airtrail.isAirtrailWriteEnabled.mockResolvedValue(false);
    await expect(service.exportFlight(9, 72, 1)).rejects.toThrow('Enable AirTrail');
    expect(client.saveFlight).not.toHaveBeenCalled();
  });
  it('refuses reservations from another trip', async () => {
    const { service, client } = setup();
    await expect(service.exportFlight(10, 72, 1)).rejects.toThrow('not found in trip');
    expect(client.saveFlight).not.toHaveBeenCalled();
  });
  it('refuses an existing remote flight', async () => {
    const { service, client, repo } = setup();
    client.listFlights.mockResolvedValue([{
      from: { iata: 'MUC' }, to: { iata: 'ZTH' },
      departureScheduled: '2027-07-12T10:00:00Z', flightNumber: 'DE1750',
    }]);
    await expect(service.exportFlight(9, 72, 1)).rejects.toThrow('already exists');
    expect(repo.claimAirtrailExport).not.toHaveBeenCalled();
    expect(client.saveFlight).not.toHaveBeenCalled();
  });
  it('does not create a second flight if the claim fails', async () => {
    const { service, repo, client } = setup();
    repo.claimAirtrailExport.mockResolvedValue(false);
    await expect(service.exportFlight(9, 72, 1)).rejects.toThrow('already linked');
    expect(client.saveFlight).not.toHaveBeenCalled();
  });
  it('leaves the pending claim after an uncertain remote result', async () => {
    const { service, repo, client } = setup();
    client.saveFlight.mockRejectedValue(new Error('connection lost'));
    await expect(service.exportFlight(9, 72, 1)).rejects.toThrow('connection lost');
    expect(repo.finishAirtrailExport).not.toHaveBeenCalled();
  });
});
