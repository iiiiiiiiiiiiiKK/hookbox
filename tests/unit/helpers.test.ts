import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../worker/lib/cursor';
import {
  formatBytes,
  formatDuration,
  methodStyle,
  timeAgo,
  truncatedPath,
} from '../../src/lib/format';

describe('pagination cursor', () => {
  it('round-trips timestamp and id', () => {
    const cursor = encodeCursor(1730000000000, 'abcDEF_-123');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ receivedAt: 1730000000000, id: 'abcDEF_-123' });
  });

  it('rejects malformed cursors', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('!!!')).toBeNull();
    expect(decodeCursor(encodeCursor(1, ''))).toBeNull();
    expect(decodeCursor(btoa('notatimestamp:x'))).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(262144)).toBe('256 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('formatDuration', () => {
  it('renders hh:mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3_600_000)).toBe('01:00:00');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
    expect(formatDuration(-5)).toBe('00:00:00');
  });
});

describe('timeAgo', () => {
  it('describes recent timestamps', () => {
    const now = 1_700_000_000_000;
    expect(timeAgo(now - 500, now)).toBe('just now');
    expect(timeAgo(now - 5_000, now)).toBe('5s ago');
    expect(timeAgo(now - 120_000, now)).toBe('2m ago');
    expect(timeAgo(now - 7_200_000, now)).toBe('2h ago');
    expect(timeAgo(now - 172_800_000, now)).toBe('2d ago');
  });
});

describe('methodStyle', () => {
  it('returns distinct styles and a fallback', () => {
    expect(methodStyle('POST').text).toContain('sky');
    expect(methodStyle('post').text).toContain('sky');
    expect(methodStyle('UNKNOWN')).toBeDefined();
  });
});

describe('truncatedPath', () => {
  it('truncates long paths', () => {
    expect(truncatedPath('/short')).toBe('/short');
    expect(truncatedPath('x'.repeat(60))).toHaveLength(48);
    expect(truncatedPath('x'.repeat(60)).endsWith('…')).toBe(true);
  });
});
