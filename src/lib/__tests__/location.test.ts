import { radiusForSpan } from '../geo';
import { reportLocation } from '../location';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { Other: 1 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
}));

const rpc = supabase.rpc as jest.Mock;

describe('reportLocation', () => {
  beforeEach(() => rpc.mockReset());

  it('sends the fix, its accuracy, the mock flag and the fix time', async () => {
    rpc.mockResolvedValue({ data: { stored: true, alerts: 0 }, error: null });
    await reportLocation({
      coords: { latitude: -34.24, longitude: 116.14, accuracy: 12, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.UTC(2026, 9, 14, 8, 0, 0),
      mocked: true,
    });
    expect(rpc).toHaveBeenCalledWith('report_location', {
      p_lat: -34.24,
      p_lng: 116.14,
      p_accuracy_m: 12,
      p_is_mocked: true,
      p_recorded_at: '2026-10-14T08:00:00.000Z',
    });
  });

  it('treats an unknown accuracy as very poor so it cannot trigger alerts', async () => {
    rpc.mockResolvedValue({ data: { stored: false, reason: 'LOW_ACCURACY' }, error: null });
    const r = await reportLocation({
      coords: { latitude: 1, longitude: 2, accuracy: null, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    });
    expect(rpc.mock.calls[0][1].p_accuracy_m).toBe(9999);
    expect(r).toEqual({ stored: false, reason: 'LOW_ACCURACY' });
  });

  it('surfaces server errors instead of pretending it worked', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'RATE_LIMITED' } });
    await expect(
      reportLocation({
        coords: { latitude: 1, longitude: 2, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
      }),
    ).rejects.toEqual({ message: 'RATE_LIMITED' });
  });
});

describe('radiusForSpan', () => {
  it('clamps to what the server accepts', () => {
    expect(radiusForSpan(0.001)).toBe(1000);
    expect(radiusForSpan(5)).toBe(50000);
    expect(radiusForSpan(0.2)).toBe(11100);
  });
});
