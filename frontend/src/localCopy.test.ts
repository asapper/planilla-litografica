import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearLocalCopy, fileBytes, loadLocalCopy, localCopyFile, recoverableLocalCopy, saveLocalSnapshot,
  setLocalCopySubmitted, startLocalCopy,
} from './localCopy';

const META_KEY = 'planilla.tas.localCopy';
const FILE_KEY = 'planilla.tas.localCopy.file';
// Latin-1 bytes as the clock exports them: "Autenticación" with 0xF3 for "ó", plus a zero byte.
const BYTES = new Uint8Array([0x41, 0x75, 0x74, 0x65, 0x6e, 0x74, 0x69, 0x63, 0x61, 0x63, 0x69, 0xf3, 0x6e, 0x00, 0xff]);

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('local copy', () => {
  it('keeps the uploaded file byte for byte', async () => {
    expect(startLocalCopy('oct.csv', BYTES)).toBe(true);
    const copy = loadLocalCopy()!;
    expect(copy.fileName).toBe('oct.csv');
    const file = localCopyFile(copy);
    expect(file.name).toBe('oct.csv');
    expect(await fileBytes(file)).toEqual(BYTES);
  });

  it('keeps a large file', async () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    startLocalCopy('big.csv', big);
    expect(await fileBytes(localCopyFile(loadLocalCopy()!))).toEqual(big);
  });

  it('is recoverable only once decisions are saved and the submission has not started', () => {
    startLocalCopy('oct.csv', BYTES);
    expect(recoverableLocalCopy()).toBeNull();

    expect(saveLocalSnapshot({ tasView: 'verification' })).toBe(true);
    expect(recoverableLocalCopy()?.snapshot).toEqual({ tasView: 'verification' });

    setLocalCopySubmitted(true);
    expect(recoverableLocalCopy()).toBeNull();
    saveLocalSnapshot({ tasView: 'review' });
    expect(recoverableLocalCopy()).toBeNull();
    expect(loadLocalCopy()?.submitted).toBe(true);
  });

  it('starts with the decisions it is given', () => {
    startLocalCopy('oct.csv', BYTES, { tasView: 'review' });
    expect(recoverableLocalCopy()?.snapshot).toEqual({ tasView: 'review' });
  });

  it('a new upload replaces a submitted copy', () => {
    startLocalCopy('oct.csv', BYTES, { tasView: 'review' });
    setLocalCopySubmitted(true);
    startLocalCopy('nov.csv', BYTES, { tasView: 'verification' });
    expect(recoverableLocalCopy()?.fileName).toBe('nov.csv');
  });

  it('saves no decisions without a file to go with them', () => {
    expect(saveLocalSnapshot({ tasView: 'review' })).toBe(false);
    expect(loadLocalCopy()).toBeNull();
  });

  it('reads nothing from a damaged or foreign entry', () => {
    localStorage.setItem(FILE_KEY, 'eA==');
    localStorage.setItem(META_KEY, '{not json');
    expect(loadLocalCopy()).toBeNull();
    localStorage.setItem(META_KEY, JSON.stringify({ fileName: 3 }));
    expect(loadLocalCopy()).toBeNull();
    localStorage.setItem(META_KEY, JSON.stringify({ fileName: 'a', savedAt: 'x', snapshot: 'nope', dayKeys: 'no' }));
    expect(loadLocalCopy()).toEqual({ fileName: 'a', fileBase64: 'eA==', savedAt: 'x', snapshot: null, dayKeys: {}, submitted: false });
    localStorage.removeItem(FILE_KEY);
    expect(loadLocalCopy()).toBeNull();
  });

  it('keeps the file under its own key, so saving decisions never rewrites it', () => {
    startLocalCopy('oct.csv', BYTES);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    saveLocalSnapshot({ tasView: 'verification' });
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([META_KEY]);
  });

  it('keeps each day\'s identity from verification, and keeps it through Revisar', () => {
    const day = (sessionId: number, scans: string[]) => ({ sessionId, employeeId: 'E1', date: '2026-10-03', scans });
    startLocalCopy('oct.csv', BYTES, { tasView: 'verification', flaggedSessions: [day(1, ['2026-10-03T07:02:00']), { sessionId: 'x' }] });
    expect(loadLocalCopy()?.dayKeys).toEqual({ 1: 'E1|2026-10-03|2026-10-03T07:02:00' });
    // Revisar rewrites the scans and drops resolved days: the identities from verification stand.
    saveLocalSnapshot({ tasView: 'review', flaggedSessions: [day(1, ['2026-10-03T07:02:00', '2026-10-03T15:00:00'])] });
    expect(loadLocalCopy()?.dayKeys).toEqual({ 1: 'E1|2026-10-03|2026-10-03T07:02:00' });
    saveLocalSnapshot({ tasView: 'verification', flaggedSessions: [day(5, ['2026-10-03T08:00:00'])] });
    expect(loadLocalCopy()?.dayKeys).toEqual({ 5: 'E1|2026-10-03|2026-10-03T08:00:00' });
  });

  it('a failed submission puts the copy back in play', () => {
    startLocalCopy('oct.csv', BYTES, { tasView: 'review' });
    setLocalCopySubmitted(true);
    setLocalCopySubmitted(false);
    expect(recoverableLocalCopy()).not.toBeNull();
  });

  it('removes a copy whose decisions could not be written, rather than offer stale ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startLocalCopy('oct.csv', BYTES, { tasView: 'verification' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(saveLocalSnapshot({ tasView: 'review' })).toBe(false);
    expect(loadLocalCopy()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('a new upload never keeps the previous session\'s decisions', () => {
    startLocalCopy('oct.csv', BYTES, { tasView: 'review' });
    startLocalCopy('nov.csv', BYTES);
    expect(loadLocalCopy()?.snapshot).toBeNull();
    expect(recoverableLocalCopy()).toBeNull();
  });

  it('reports a full storage instead of throwing, and leaves no copy', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startLocalCopy('old.csv', BYTES, { tasView: 'review' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(startLocalCopy('oct.csv', BYTES)).toBe(false);
    expect(loadLocalCopy()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('clears, and survives storage being unavailable', () => {
    startLocalCopy('oct.csv', BYTES);
    clearLocalCopy();
    expect(loadLocalCopy()).toBeNull();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => clearLocalCopy()).not.toThrow();
    expect(loadLocalCopy()).toBeNull();
  });

  it('rejects when the file cannot be read', async () => {
    await expect(fileBytes({} as Blob)).rejects.toBeDefined();
  });
});
