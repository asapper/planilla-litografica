import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';

const mockListen = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockSaveDraftNow = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('./tasDraft', () => ({ saveDraftNow: mockSaveDraftNow }));

const { onAppCloseRequested, prepareToClose, APP_CLOSE_EVENT, APP_CLOSE_BLOCKED_EVENT, CLOSE_BLOCKED_MESSAGE } =
  await import('./appClose');

const flushPromises = () => new Promise(r => setTimeout(r, 0));

let handlers: Record<string, () => Promise<void> | void>;
let unlistens: ReturnType<typeof vi.fn>[];

beforeEach(() => {
  vi.clearAllMocks();
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
  handlers = {};
  unlistens = [];
  mockInvoke.mockResolvedValue(undefined);
  mockSaveDraftNow.mockResolvedValue(undefined);
  mockListen.mockImplementation(async (event: string, h: () => Promise<void>) => {
    handlers[event] = h;
    const un = vi.fn();
    unlistens.push(un);
    return un;
  });
});

describe('onAppCloseRequested', () => {
  it('prepares first, then tells the shell whether to close', async () => {
    const order: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => { order.push(`${cmd} ${JSON.stringify(args)}`); });
    onAppCloseRequested(async () => { order.push('prepare'); return true; });
    await flushPromises();

    await handlers[APP_CLOSE_EVENT]();
    expect(order).toEqual(['prepare', 'close_ready {"proceed":true}']);
  });

  it('passes a refusal on to the shell', async () => {
    onAppCloseRequested(async () => false);
    await flushPromises();
    await handlers[APP_CLOSE_EVENT]();
    expect(mockInvoke).toHaveBeenCalledWith('close_ready', { proceed: false });
  });

  it('still lets the shell close when preparing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onAppCloseRequested(async () => { throw new Error('down'); });
    await flushPromises();
    await handlers[APP_CLOSE_EVENT]();
    expect(mockInvoke).toHaveBeenCalledWith('close_ready', { proceed: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a failing close_ready (outside the shell) does not throw', async () => {
    mockInvoke.mockRejectedValue(new Error('no shell'));
    onAppCloseRequested(async () => true);
    await flushPromises();
    await expect(handlers[APP_CLOSE_EVENT]()).resolves.toBeUndefined();
  });

  it('shows why when the shell reports the backend refused to close', async () => {
    onAppCloseRequested(async () => true);
    await flushPromises();
    handlers[APP_CLOSE_BLOCKED_EVENT]();
    expect(useToastStore.getState().toasts[0].message).toBe(CLOSE_BLOCKED_MESSAGE);
  });

  it('stops both listeners on cleanup, even before they are registered', async () => {
    const stop = onAppCloseRequested(async () => true);
    stop();
    await flushPromises();
    expect(unlistens).toHaveLength(2);
    unlistens.forEach(un => expect(un).toHaveBeenCalledTimes(1));

    unlistens = [];
    const stopLater = onAppCloseRequested(async () => true);
    await flushPromises();
    stopLater();
    unlistens.forEach(un => expect(un).toHaveBeenCalledTimes(1));
  });

  it('is a no-op outside the desktop shell', async () => {
    mockListen.mockRejectedValue(new Error('not tauri'));
    const stop = onAppCloseRequested(async () => true);
    await flushPromises();
    expect(() => stop()).not.toThrow();
  });
});

describe('prepareToClose', () => {
  it('saves the draft and agrees to close', async () => {
    useTasStore.setState({ tasView: 'review' });
    await expect(prepareToClose()).resolves.toBe(true);
    expect(mockSaveDraftNow).toHaveBeenCalledTimes(1);
  });

  it.each(['submitting', 'polling'] as const)('refuses while a submission is %s and says why', async view => {
    useTasStore.setState({ tasView: view });
    await expect(prepareToClose()).resolves.toBe(false);
    expect(mockSaveDraftNow).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0].message).toBe(CLOSE_BLOCKED_MESSAGE);
  });
});
