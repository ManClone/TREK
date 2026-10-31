import { ADDON_IDS } from '../../addons';
import type { User } from '../../types';
import { AddonGuard } from '../addons/addon.guard';
import { RequireAddon } from '../addons/require-addon.decorator';
import { getClientIp } from '../audit/client-ip';
import { CurrentUser } from '../auth-core/current-user.decorator';
import { JwtAuthGuard } from '../auth-core/jwt-auth.guard';
import { ReservationsService } from '../reservations/reservations.service';
import { AirtrailRequestError } from './airtrail.client';
import { AirtrailExportService } from './airtrail-export.service';
import { AirtrailSyncService } from './airtrail-sync.service';
import { AirtrailExportDto, AirtrailSettingsDto } from './airtrail.dto';
import { AirtrailService } from './airtrail.service';
import { Body, Controller, Get, HttpCode, HttpException, Post, Put, Req, UseGuards } from '@nestjs/common';

import type { Request } from 'express';

/**
 * /api/integrations/airtrail — per-user AirTrail connection (#214).
 *
 * `status` and `test` answer 200 even on failure (the service shapes
 * `{ connected: false, error }`); `settings` PUT validates with a 400. The API
 * key is never echoed — `getSettings` returns it masked. The route group is
 * gated on the `airtrail` addon (404 when disabled).
 */
@Controller('api/integrations/airtrail')
@UseGuards(AddonGuard, JwtAuthGuard)
@RequireAddon(ADDON_IDS.AIRTRAIL, 'AirTrail')
export class AirtrailController {
  constructor(
    private readonly airtrail: AirtrailService,
    private readonly syncService: AirtrailSyncService,
    private readonly exporter: AirtrailExportService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() user: User) {
    return this.airtrail.getConnectionSettings(user.id);
  }

  @Put('settings')
  async putSettings(@CurrentUser() user: User, @Body() body: AirtrailSettingsDto, @Req() req: Request) {
    const result = await this.airtrail.saveSettings(
      user.id,
      body.url,
      body.apiKey,
      !!body.allowInsecureTls,
      !!body.writeEnabled,
      getClientIp(req),
    );
    if (!result.success) {
      throw new HttpException({ error: result.error }, 400);
    }
    return result.warning ? { success: true, warning: result.warning } : { success: true };
  }

  @Get('status')
  getStatus(@CurrentUser() user: User) {
    return this.airtrail.getConnectionStatus(user.id);
  }

  @Get('flights')
  async flights(@CurrentUser() user: User) {
    try {
      return { flights: await this.airtrail.getFlightsForPicker(user.id) };
    } catch (err: any) {
      throw new HttpException(
        { error: err?.message || 'Could not load AirTrail flights' },
        err?.status === 400 ? 400 : 502,
      );
    }
  }

  /** Pull this user's AirTrail edits into their linked reservations on demand. */
  @Post('sync')
  @HttpCode(200)
  sync(@CurrentUser() user: User) {
    return this.syncService.runAirtrailSyncForUser(user.id);
  }

  /** Explicit export; trip permissions are checked by the reservation domain. */
  @Post('export')
  @HttpCode(200)
  async export(@CurrentUser() user: User, @Body() body: AirtrailExportDto) {
    if (!Number.isSafeInteger(body?.tripId) || !Number.isSafeInteger(body?.reservationId)) {
      throw new HttpException({ error: 'Valid tripId and reservationId required' }, 400);
    }
    const trip = await this.reservations.verifyTripAccess(body.tripId, user.id);
    if (!trip) throw new HttpException({ error: 'Trip not found' }, 404);
    if (!(await this.reservations.canEdit(trip, user))) throw new HttpException({ error: 'Forbidden' }, 403);
    try {
      return await this.exporter.exportFlight(body.tripId, body.reservationId, user.id);
    } catch (err: unknown) {
      if (err instanceof AirtrailRequestError) {
        throw new HttpException({ error: err.message }, typeof err.status === 'number' && err.status >= 400 && err.status <= 599 ? err.status : 502);
      }
      throw err;
    }
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() user: User, @Body() body: AirtrailSettingsDto) {
    return this.airtrail.testConnection(user.id, body.url, body.apiKey, !!body.allowInsecureTls);
  }
}
