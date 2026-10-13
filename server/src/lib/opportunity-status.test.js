import { describe, expect, it } from 'vitest';
import { sourceDataForStatus } from './opportunity-status.js';

// CONTENT-006: why an opportunity was dismissed, kept only while it is.

describe('sourceDataForStatus', () => {
  const sd = { promptText: 'best coffee' };

  it('records an accepted reason with a dismissal', () => {
    expect(sourceDataForStatus(sd, 'dismissed', 'wrong_angle')).toEqual({
      promptText: 'best coffee',
      dismissReason: 'wrong_angle',
    });
  });

  it('ignores an unknown reason, or a reason on another status', () => {
    expect(sourceDataForStatus(sd, 'dismissed', 'because')).toBeNull();
    expect(sourceDataForStatus(sd, 'reviewed', 'wrong_angle')).toBeNull();
    expect(sourceDataForStatus(sd, 'dismissed', undefined)).toBeNull();
  });

  it('drops the reason once the opportunity is restored', () => {
    expect(sourceDataForStatus({ ...sd, dismissReason: 'wrong_angle' }, 'new', undefined)).toEqual(
      sd,
    );
  });

  it('writes nothing when nothing changes', () => {
    expect(
      sourceDataForStatus({ ...sd, dismissReason: 'not_relevant' }, 'dismissed', 'not_relevant'),
    ).toBeNull();
    expect(sourceDataForStatus(null, 'new')).toBeNull();
  });
});
