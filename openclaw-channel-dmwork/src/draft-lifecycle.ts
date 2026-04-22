/**
 * Local implementation of createFinalizableDraftLifecycle.
 *
 * Mirrors the runtime SDK helper (openclaw/plugin-sdk/channel-lifecycle)
 * which is not yet shipped in SDK 2026.3.2. Once the SDK exposes this
 * module, this file can be deleted and the import restored.
 */

export type DraftLifecycleState = {
  stopped: boolean;
  final: boolean;
};

export type FinalizableDraftLifecycleParams<T> = {
  throttleMs: number;
  state: DraftLifecycleState;
  sendOrEditStreamMessage: (text: string) => Promise<boolean>;
  readMessageId: () => T | undefined;
  clearMessageId: () => void;
  isValidMessageId: (v: unknown) => v is T;
  deleteMessage: (id: T) => Promise<void>;
  warn: (message: string) => void;
  warnPrefix: string;
};

export type FinalizableDraftLifecycle = {
  update: (text: string) => void;
  clear: () => Promise<void>;
  stop: () => Promise<void>;
  stopForClear: () => Promise<void>;
  loop: {
    flush: () => Promise<void>;
    stop: () => void;
    waitForInFlight: () => Promise<void>;
    resetPending: () => void;
  };
};

export function createFinalizableDraftLifecycle<T = string>(
  params: FinalizableDraftLifecycleParams<T>,
): FinalizableDraftLifecycle {
  const {
    throttleMs,
    state,
    sendOrEditStreamMessage,
    readMessageId,
    clearMessageId,
    isValidMessageId,
    deleteMessage,
    warn,
    warnPrefix,
  } = params;

  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlightPromise: Promise<void> | undefined;

  const waitForInFlight = (): Promise<void> => inFlightPromise ?? Promise.resolve();

  const doSend = async (): Promise<void> => {
    const text = pending;
    if (text === undefined || state.stopped) return;
    pending = undefined;

    const p = sendOrEditStreamMessage(text).then((ok) => {
      if (!ok) {
        state.stopped = true;
        warn(`${warnPrefix}: send returned false, stopping`);
      }
    }).catch((err) => {
      state.stopped = true;
      warn(`${warnPrefix}: send error: ${String(err)}`);
    });
    inFlightPromise = p.then(() => { inFlightPromise = undefined; });
    await p;
  };

  const scheduleFlush = (): void => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void doSend();
    }, throttleMs);
  };

  const update = (text: string): void => {
    if (state.stopped) return;
    pending = text;
    scheduleFlush();
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    await doSend();
    await waitForInFlight();
  };

  const stopLoop = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const resetPending = (): void => {
    pending = undefined;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const clear = async (): Promise<void> => {
    stopLoop();
    pending = undefined;
    await waitForInFlight();

    const msgId = readMessageId();
    if (isValidMessageId(msgId)) {
      try {
        await deleteMessage(msgId);
      } catch (err) {
        warn(`${warnPrefix}: delete failed: ${String(err)}`);
      }
    }
    clearMessageId();
  };

  const stop = async (): Promise<void> => {
    state.stopped = true;
    await flush();
  };

  const stopForClear = async (): Promise<void> => {
    state.stopped = true;
    stopLoop();
    await waitForInFlight();
  };

  return {
    update,
    clear,
    stop,
    stopForClear,
    loop: {
      flush,
      stop: stopLoop,
      waitForInFlight,
      resetPending,
    },
  };
}
