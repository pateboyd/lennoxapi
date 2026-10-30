/**
 * Regression coverage for HomeKit <-> Lennox S30 schedule and Perfect Temp control.
 * No thermostat is contacted; all publishes are intercepted.
 */
import { S30API } from '../src/api';
import { LennoxZone } from '../src/zone';
import { createTestApi, createTestApiSingleSetpoint } from './helpers';

describe('HomeKit setpoint and schedule regressions', () => {
  let api: S30API;
  let zone: LennoxZone;
  let publish: jest.SpyInstance;

  beforeEach(() => {
    api = createTestApiSingleSetpoint();
    zone = api.systems[0].getZone(0)!;
    zone.systemMode = 'heat and cool';
    zone.fanMode = 'auto';
    zone.humidityMode = 'off';
    zone.sp = 72;
    zone.spC = 22;
    zone.hsp = 70;
    zone.hspC = 21;
    zone.csp = 75;
    zone.cspC = 24;
    zone.scheduleId = 1;
    publish = jest.spyOn(api, 'publishMessage').mockResolvedValue();
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates next-period hold for scheduled Perfect Temp adjustment', async () => {
    await zone.performSetpoint({spC: 23});
    expect(publish).toHaveBeenCalledTimes(3);
    const copy = publish.mock.calls[0][1] as any;
    const hold = publish.mock.calls[1][1] as any;
    const update = publish.mock.calls[2][1] as any;
    expect(copy.schedules[0].id).toBe(32);
    expect(copy.schedules[0].schedule.periods[0].period.systemMode).toBe('heat and cool');
    expect(hold.zones[0].config.scheduleHold).toMatchObject({
      scheduleId: 32,
      enabled: true,
      exceptionType: 'hold',
      expirationMode: 'nextPeriod',
    });
    expect(update.schedules[0].id).toBe(32);
    const period = update.schedules[0].schedule.periods[0].period;
    expect(period.spC).toBe(23);
    expect(period.sp).toBeDefined();
    expect(period).not.toHaveProperty('systemMode');
    expect(period).not.toHaveProperty('hsp');
    expect(period).not.toHaveProperty('csp');
    expect(zone.system.singleSetpointMode).toBe(true);
    expect(zone.scheduleId).toBe(1);
    expect(zone.scheduleHold).toBe(true);
  });

  it('uses active override for subsequent setpoint changes', async () => {
    await zone.performSetpoint({spC: 23});
    publish.mockClear();
    await zone.performSetpoint({spC: 23.5});
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][1] as any).schedules[0].id).toBe(32);
  });

  it('sends only one update for an existing manual schedule', async () => {
    zone.scheduleId = zone.getManualModeScheduleId();
    await zone.performSetpoint({spC: 23});
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][1] as any).schedules[0].id).toBe(16);
  });

  it('uses per-zone away schedule instead of global schedule 3', async () => {
    api.systems[0].manualAwayMode = true;
    await zone.performSetpoint({spC: 23});
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][1] as any).schedules[0].id).toBe(24);
  });

  it('parses nested holds without overwriting the active schedule', () => {
    zone.processMessage({config: {scheduleHold: {enabled: true, scheduleId: 32}}});
    expect(zone.scheduleId).toBe(1);
    expect(zone.scheduleHold).toBe(true);
    expect(zone.overrideActive).toBe(true);
    zone.processMessage({config: {scheduleHold: {enabled: false, scheduleId: 32}}});
    expect(zone.scheduleHold).toBe(false);
    expect(zone.overrideActive).toBe(false);
  });

  it('sends both dual thresholds without overwriting unrelated mode values', async () => {
    const dualApi = createTestApi();
    const dualZone = dualApi.systems[0].getZone(0)!;
    dualZone.scheduleId = dualZone.getManualModeScheduleId();
    dualZone.hspC = 20;
    dualZone.cspC = 25;
    dualZone.systemMode = 'heat and cool';
    const send = jest.spyOn(dualApi, 'publishMessage').mockResolvedValue();
    await dualZone.performSetpoint({hspC: 21, cspC: 25});
    expect(send).toHaveBeenCalledTimes(1);
    const period = (send.mock.calls[0][1] as any).schedules[0].schedule.periods[0].period;
    expect(period.hspC).toBe(21);
    expect(period.cspC).toBe(25);
    expect(period).not.toHaveProperty('systemMode');
    expect(period).not.toHaveProperty('fanMode');
    expect(dualZone.hspC).toBe(21);
  });

  it('switches HVAC modes to manual schedule when named schedule is active', async () => {
    await zone.setHVACMode('heat');
    expect(publish).toHaveBeenCalledTimes(2);
    expect((publish.mock.calls[0][1] as any).zones[0].config.scheduleId).toBe(16);
    expect((publish.mock.calls[1][1] as any).schedules[0].id).toBe(16);
  });

  it('routes fan changes through scheduled override', async () => {
    await zone.setFanMode('on');
    expect(publish).toHaveBeenCalledTimes(3);
    expect((publish.mock.calls[2][1] as any).schedules[0].id).toBe(32);
  });
});
