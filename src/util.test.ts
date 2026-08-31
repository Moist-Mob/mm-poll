import { FOLLOW_AGE_MS, isEligible } from './util.js';
import { TwitchUser } from './jwt.js';

describe('isEligible', () => {
  const user = (followed_on: number, user_id = '1'): TwitchUser => ({ login: 'u', user_id, followed_on });

  it('admins are always eligible', () => {
    expect(isEligible(user(-1, '241636'))).toBe(true);
  });

  it('non-followers are not eligible', () => {
    const res = isEligible(user(-1));
    expect(res).not.toBe(true);
    if (res === true) throw new Error('unreachable');
    expect(res[1]).toMatch(/Must be a follower/);
  });

  it('followers younger than 7 days must wait', () => {
    const res = isEligible(user(Date.now() - FOLLOW_AGE_MS + 3600_000));
    expect(res).not.toBe(true);
    const [ms, msg] = res as [number, string];
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(3600_000);
    expect(msg).toMatch(/Eligible to participate in/);
  });

  it('brand-new followers must wait the full week', () => {
    const [ms] = isEligible(user(Date.now())) as [number, string];
    expect(ms).toBeGreaterThan(FOLLOW_AGE_MS - 1000);
  });

  it('followers of 7+ days are eligible', () => {
    expect(isEligible(user(Date.now() - FOLLOW_AGE_MS - 1000))).toBe(true);
    expect(isEligible(user(Date.now() - 30 * 86400_000))).toBe(true);
  });
});
