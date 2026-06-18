import { describe, it, expect } from 'vitest';
import { matchesSearch } from './textSearch';

describe('matchesSearch', () => {
  it('matches case-insensitively', () => {
    expect(matchesSearch('Ana López', 'ana')).toBe(true);
    expect(matchesSearch('Ana López', 'ANA')).toBe(true);
  });

  it('matches accent-insensitively', () => {
    expect(matchesSearch('López', 'lopez')).toBe(true);
    expect(matchesSearch('García', 'garcia')).toBe(true);
    expect(matchesSearch('Lopez', 'López')).toBe(true);
  });

  it('matches substring', () => {
    expect(matchesSearch('Ana López', 'lóp')).toBe(true);
    expect(matchesSearch('Ana López', 'lop')).toBe(true);
  });

  it('returns false when no match', () => {
    expect(matchesSearch('Ana López', 'carlos')).toBe(false);
  });

  it('handles empty query', () => {
    expect(matchesSearch('Ana López', '')).toBe(true);
  });
});
