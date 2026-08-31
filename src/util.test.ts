import { DAY_MS, followAgeText, followRuleText, isEligible } from './util.js';
import { TwitchUser } from './user.js';

describe('isEligible', () => {
  const user = (followed_on: number, user_id = '1'): TwitchUser => ({ login: 'u', user_id, followed_on });
  const DAYS = 7;

  it('admins are always eligible', () => {
    expect(isEligible(user(-1, '241636'), DAYS)).toBe(true);
    expect(isEligible(user(-1, '241636'), 0)).toBe(true);
  });

  it('non-followers are not eligible, and the message reflects the configured rule', () => {
    const res = isEligible(user(-1), DAYS);
    expect(res).not.toBe(true);
    if (res === true) throw new Error('unreachable');
    expect(res[1]).toEqual('Must be a follower for 7 days to participate');

    const zero = isEligible(user(-1), 0);
    if (zero === true) throw new Error('unreachable');
    expect(zero[1]).toEqual('Must follow the channel to participate');
  });

  it('followers younger than the requirement must wait', () => {
    const res = isEligible(user(Date.now() - DAYS * DAY_MS + 3600_000), DAYS);
    expect(res).not.toBe(true);
    const [ms, msg] = res as [number, string];
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(3600_000);
    expect(msg).toMatch(/Eligible to participate in/);
  });

  it('brand-new followers must wait the full period', () => {
    const [ms] = isEligible(user(Date.now()), DAYS) as [number, string];
    expect(ms).toBeGreaterThan(DAYS * DAY_MS - 1000);
  });

  it('followers past the requirement are eligible', () => {
    expect(isEligible(user(Date.now() - DAYS * DAY_MS - 1000), DAYS)).toBe(true);
    expect(isEligible(user(Date.now() - 30 * DAY_MS), DAYS)).toBe(true);
  });

  it('a requirement of 0 admits any follower, fractional days work', () => {
    expect(isEligible(user(Date.now()), 0)).toBe(true);
    // 0.5 days: someone who followed 13 hours ago is in, 11 hours ago is out
    expect(isEligible(user(Date.now() - 13 * 3600_000), 0.5)).toBe(true);
    expect(isEligible(user(Date.now() - 11 * 3600_000), 0.5)).not.toBe(true);
  });
});

describe('follow age text', () => {
  it('humanizes the configured requirement', () => {
    expect(followAgeText(7)).toEqual('7 days');
    expect(followAgeText(1)).toEqual('1 day');
    expect(followAgeText(0.5)).toEqual('12 hours');
    expect(followRuleText(7)).toEqual('Must be a follower for 7 days to participate');
    expect(followRuleText(0)).toEqual('Must follow the channel to participate');
  });
});
