import { timeAgo } from '../format';

describe('timeAgo', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  it.each([
    ['2026-10-14T11:59:30Z', 'just now'],
    ['2026-10-14T11:55:00Z', '5m'],
    ['2026-10-14T09:00:00Z', '3h'],
    ['2026-10-12T12:00:00Z', '2d'],
  ])('%s → %s', (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
  it('never shows negative times for clock skew', () => {
    expect(timeAgo('2026-10-14T12:01:00Z', now)).toBe('just now');
  });
});
