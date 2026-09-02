import { median } from './familiarity';

describe('median', () => {
  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single value for a list of one', () => {
    expect(median([0.4])).toBe(0.4);
  });

  it('averages the two middle values for an even-length list', () => {
    expect(median([0.1, 0.3, 0.5, 0.9])).toBe(0.4);
  });

  it('returns the middle value for an odd-length list', () => {
    expect(median([0.9, 0.1, 0.5])).toBe(0.5);
  });

  // The whole point of switching from max to median: one file the author
  // happens to own heavily must not single-handedly hide unfamiliarity with
  // everything else in the diff.
  it('is not defeated by a single high-ownership outlier', () => {
    const ownerships = [0.9, 0.02, 0.03, 0.05, 0.04];
    expect(median(ownerships)).toBeLessThan(0.2);
  });

  it('is not defeated by a single low-ownership outlier either', () => {
    const ownerships = [0.85, 0.8, 0.9, 0.02];
    expect(median(ownerships)).toBeGreaterThanOrEqual(0.2);
  });
});
