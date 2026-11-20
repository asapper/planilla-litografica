import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';

const mockListen = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());
const mockSaveDraftNow = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/event', () => ({ listen: mockListen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('./tasDraft', () => ({ saveDraftNow: mockSaveDraftNow }));

const {
  onAppCloseRequested, prepareToClose, APP_CLOSE_EVENT, APP_CLOSE_BLOCKED_EVENT, CLOSE_BLOCKED_MESSAGE,
  CLOSE_UNSAVED_MESSAGE, CLOSE_ANYWAY_WINDOW_MS, CLOSE_SAVE_TIMEOUT_MS,
} =
  await import('./appClose');

const flushPromises = () => new Promise(r => setTimeout(r, 0));

let handlers: Record<string, (event?: { payload: number }) => Promise<void> | void>;
let unlistens: ReturnType<typeof vi.fn>[];

beforeEach(() => {
  vi.clearAllMocks();
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
  handlers = {};
  unlistens = [];
  mockInvoke.mockResolvedValue(undefined);
  mockSaveDraftNow.mockResolvedValue(true);
  mockListen.mockImplementation(async (event: string, h: (e?: { payload: number }) => Promise<void>) => {
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

    await handlers[APP_CLOSE_EVENT]({ payload: 3 });
    expect(order).toEqual(['prepare', 'close_ready {"attempt":3,"proceed":true}']);
  });

  it('passes a refusal on to the shell', async () => {
    onAppCloseRequested(async () => false);
    await flushPromises();
    await handlers[APP_CLOSE_EVENT]({ payload: 3 });
    expect(mockInvoke).toHaveBeenCalledWith('close_ready', { attempt: 3, proceed: false });
  });

  it('still lets the shell close when preparing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onAppCloseRequested(async () => { throw new Error('down'); });
    await flushPromises();
    await handlers[APP_CLOSE_EVENT]({ payload: 3 });
    expect(mockInvoke).toHaveBeenCalledWith('close_ready', { attempt: 3, proceed: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a failing close_ready (outside the shell) does not throw', async () => {
    mockInvoke.mockRejectedValue(new Error('no shell'));
    onAppCloseRequested(async () => true);
    await flushPromises();
    await expect(handlers[APP_CLOSE_EVENT]({ payload: 3 })).resolves.toBeUndefined();
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

  describe('when the last save failed', () => {
    let now = Date.parse('2026-11-19T10:00:00Z');
    beforeEach(() => {
      // Each case starts well past any close-anyway window an earlier case opened.
      now += 10 * CLOSE_ANYWAY_WINDOW_MS;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      mockSaveDraftNow.mockResolvedValue(false);
      useTasStore.setState({ tasView: 'verification' });
    });

    it('refuses the first close and says a second one closes without saving', async () => {
      await expect(prepareToClose()).resolves.toBe(false);
      expect(useToastStore.getState().toasts.map(t => [t.variant, t.message]))
        .toEqual([['error', CLOSE_UNSAVED_MESSAGE]]);
    });

    it('keeps the refusal up for as long as a second close goes ahead', async () => {
      await prepareToClose();
      expect(useToastStore.getState().toasts[0].durationMs).toBe(CLOSE_ANYWAY_WINDOW_MS);
    });

    it('lets a second close within the window go ahead', async () => {
      await prepareToClose();
      now += CLOSE_ANYWAY_WINDOW_MS - 1;
      await expect(prepareToClose()).resolves.toBe(true);
      expect(mockSaveDraftNow).toHaveBeenCalledTimes(2);
    });

    it('refuses again once the window has passed', async () => {
      await prepareToClose();
      now += CLOSE_ANYWAY_WINDOW_MS;
      await expect(prepareToClose()).resolves.toBe(false);
      expect(useToastStore.getState().toasts).toHaveLength(2);
    });

    it('closes at once when the save works again', async () => {
      await prepareToClose();
      mockSaveDraftNow.mockResolvedValue(true);
      now += 2 * CLOSE_ANYWAY_WINDOW_MS;
      await expect(prepareToClose()).resolves.toBe(true);
    });
  });

  describe('when the final save hangs', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-11-20T10:00:00Z'));
      useTasStore.setState({ tasView: 'verification' });
    });
    afterEach(() => vi.useRealTimers());

    it('answers the shell before its 2 s wait runs out, so the hung save still refuses the close', async () => {
      expect(CLOSE_SAVE_TIMEOUT_MS).toBeLessThan(2_000);
      mockSaveDraftNow.mockReturnValue(new Promise<boolean>(() => {}));
      let answer: boolean | undefined;
      void prepareToClose().then(v => { answer = v; });

      await vi.advanceTimersByTimeAsync(CLOSE_SAVE_TIMEOUT_MS - 1);
      expect(answer).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toBe(false);
      expect(useToastStore.getState().toasts.map(t => t.message)).toEqual([CLOSE_UNSAVED_MESSAGE]);
    });

    it('uses the save that lands in time and leaves no timer behind', async () => {
      mockSaveDraftNow.mockReturnValue(new Promise<boolean>(r => setTimeout(() => r(true), CLOSE_SAVE_TIMEOUT_MS - 100)));
      const answer = prepareToClose();
      await vi.advanceTimersByTimeAsync(CLOSE_SAVE_TIMEOUT_MS - 100);
      await expect(answer).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(useToastStore.getState().toasts).toEqual([]);
    });
  });
});
