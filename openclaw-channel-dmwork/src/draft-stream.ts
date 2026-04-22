/**
 * DMWork Draft Stream — provides real-time streaming preview for agent replies.
 *
 * Uses the framework's `createFinalizableDraftLifecycle` with DMWork's native
 * Stream API (`streamStart` → `streamSend` → `streamEnd`).
 *
 * The generic T of createFinalizableDraftLifecycle maps to `string` (stream_no).
 */

import { createFinalizableDraftLifecycle } from "./draft-lifecycle.js";
import { streamStart, streamSend, streamEnd } from "./api-fetch.js";
import type { ChannelType } from "./types.js";

export type DmworkDraftStream = {
  /** Queue a text update (throttled). */
  update: (text: string) => void;
  /** Flush pending updates immediately. */
  flush: () => Promise<void>;
  /** Return the current stream_no, or undefined if no stream is active. */
  streamId: () => string | undefined;
  /** Whether the stream has successfully started and is not stopped. */
  isActive: () => boolean;
  /** Delete the preview message (clear content + end stream). */
  clear: () => Promise<void>;
  /** Stop accepting updates and wait for in-flight sends to settle. */
  discardPending: () => Promise<void>;
  /** Mark the stream as finalized — flush remaining content, no further updates. */
  seal: () => Promise<void>;
  /** Stop the stream entirely. */
  stop: () => Promise<void>;
  /** End the current stream and reset state so the next update creates a new one. */
  forceNewMessage: () => void;
};

export function createDmworkDraftStream(params: {
  apiUrl: string;
  botToken: string;
  channelId: string;
  channelType: ChannelType;
  throttleMs?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}): DmworkDraftStream {
  const { apiUrl, botToken, channelId, channelType } = params;
  const throttleMs = params.throttleMs ?? 1200;
  const warn = params.warn ?? (() => {});

  let streamNo: string | undefined;
  const streamState = { stopped: false, final: false };

  const sendOrEditStreamMessage = async (text: string): Promise<boolean> => {
    const trimmed = text.trimEnd();
    if (!trimmed) return false;

    try {
      if (streamNo === undefined) {
        streamNo = await streamStart({ apiUrl, botToken, channelId, channelType });
        if (!streamNo) {
          streamState.stopped = true;
          warn("dmwork-draft: stopped (empty stream_no from start)");
          return false;
        }
      }
      await streamSend({ apiUrl, botToken, streamNo, channelId, channelType, content: trimmed });
      return true;
    } catch (err) {
      streamState.stopped = true;
      warn(`dmwork-draft: send failed: ${String(err)}`);
      return false;
    }
  };

  const readMessageId = (): string | undefined => streamNo;
  const clearMessageId = (): void => { streamNo = undefined; };
  const isValidMessageId = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0;

  const deleteMessage = async (id: string): Promise<void> => {
    try {
      await streamSend({ apiUrl, botToken, streamNo: id, channelId, channelType, content: "" });
    } catch {
      // best-effort clear
    }
    await streamEnd({ apiUrl, botToken, streamNo: id, channelId, channelType });
  };

  const lifecycle = createFinalizableDraftLifecycle({
    throttleMs,
    state: streamState,
    sendOrEditStreamMessage,
    readMessageId,
    clearMessageId,
    isValidMessageId,
    deleteMessage,
    warn,
    warnPrefix: "dmwork-draft",
  });

  // discardPending: stop the loop and wait for any in-flight send to complete
  const discardPending = async (): Promise<void> => {
    lifecycle.loop.stop();
    await lifecycle.loop.waitForInFlight();
  };

  // seal: mark as final + flush remaining content
  const seal = async (): Promise<void> => {
    streamState.final = true;
    await lifecycle.loop.flush();
  };

  const forceNewMessage = (): void => {
    if (streamNo) {
      streamEnd({ apiUrl, botToken, streamNo, channelId, channelType }).catch(() => {});
    }
    streamNo = undefined;
    lifecycle.loop.resetPending();
  };

  return {
    update: lifecycle.update,
    flush: lifecycle.loop.flush,
    streamId: readMessageId,
    isActive: (): boolean => streamNo !== undefined && !streamState.stopped,
    clear: lifecycle.clear,
    discardPending,
    seal,
    stop: lifecycle.stop,
    forceNewMessage,
  };
}
