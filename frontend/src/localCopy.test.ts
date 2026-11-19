import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearLocalCopy, fileBytes, loadLocalCopy, localCopyFile, markLocalCopySubmitted, recoverableLocalCopy,
  saveLocalSnapshot, startLocalCopy,
} from './localCopy';

const KEY = 'planilla.tas.localCopy';
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

    markLocalCopySubmitted();
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
    markLocalCopySubmitted();
    startLocalCopy('nov.csv', BYTES, { tasView: 'verification' });
    expect(recoverableLocalCopy()?.fileName).toBe('nov.csv');
  });

  it('saves no decisions without a file to go with them', () => {
    expect(saveLocalSnapshot({ tasView: 'review' })).toBe(false);
    expect(loadLocalCopy()).toBeNull();
  });

  it('reads nothing from a damaged or foreign entry', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadLocalCopy()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ fileName: 3 }));
    expect(loadLocalCopy()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ fileName: 'a', fileBase64: '', savedAt: 'x', snapshot: 'nope' }));
    expect(loadLocalCopy()).toEqual({ fileName: 'a', fileBase64: '', savedAt: 'x', snapshot: null, submitted: false });
  });

  it('reports a full storage instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(startLocalCopy('oct.csv', BYTES)).toBe(false);
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
