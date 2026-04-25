import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for the deliver buffer pattern used in handleInboundMessage.
 *
 * The deliver callback uses info.kind to decide behavior:
 * - "block" → buffer text (overwrite), do not send
 * - "tool"  → send immediately via resolveAndSendText
 * - "final" → send immediately via resolveAndSendText
 * - other/undefined → treated as "final" (fallback)
 *
 * - isReasoning payloads are skipped entirely
 * - Media payloads are always sent immediately with dedup
 * - The finally block sends remaining buffered text if no final/tool was sent
 * - onError clears the buffer to prevent stale text
 */

// ---- helpers that mirror the production logic in inbound.ts ----

function createDeliverBuffer() {
  return {
    lastText: null as string | null,
    textSent: false,
  };
}

function makeDeliver(
  deliverBuffer: ReturnType<typeof createDeliverBuffer>,
  sentMediaUrls: Set<string>,
  sendMediaFn: (url: string) => Promise<void>,
  sendTextFn: (text: string) => Promise<void>,
) {
  return async (
    payload: {
      text?: string;
      mediaUrls?: string[];
      mediaUrl?: string;
      isReasoning?: boolean;
    },
    info?: { kind?: string },
  ) => {
    // Skip reasoning blocks
    if (payload.isReasoning) return;

    const kind = info?.kind ?? "final";

    // Media: send immediately with dedup
    const outboundMediaUrls = [
      ...(payload.mediaUrls ?? []),
      ...(payload.mediaUrl ? [payload.mediaUrl] : []),
    ].filter(Boolean);

    for (const url of outboundMediaUrls) {
      if (sentMediaUrls.has(url)) continue;
      try {
        await sendMediaFn(url);
        sentMediaUrls.add(url);
      } catch {
        // Failed media is NOT added to sentMediaUrls — can be retried
      }
    }

    // Text handling based on kind
    const content = payload.text?.trim() ?? "";
    if (!content && outboundMediaUrls.length > 0) return;
    if (!content) return;

    if (kind === "block") {
      // Buffer only, overwrite each time
      deliverBuffer.lastText = content;
      return;
    }

    // kind === "tool" or "final" or anything else: send immediately
    await sendTextFn(content);
    deliverBuffer.textSent = true;
  };
}

function makeOnError(
  deliverBuffer: ReturnType<typeof createDeliverBuffer>,
  sendErrorFn: () => Promise<void>,
) {
  return async (_err: unknown) => {
    deliverBuffer.lastText = null;
    deliverBuffer.textSent = true;
    await sendErrorFn();
  };
}

async function runFinally(
  deliverBuffer: ReturnType<typeof createDeliverBuffer>,
  sendTextFn: (text: string) => Promise<void>,
) {
  if (deliverBuffer.lastText && !deliverBuffer.textSent) {
    deliverBuffer.textSent = true;
    await sendTextFn(deliverBuffer.lastText);
  }
}

// ---- tests ----

describe("deliver buffer pattern", () => {
  it("block kind: buffers text without sending", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    await deliver({ text: "Hello" }, { kind: "block" });
    await deliver({ text: "Hello, how are you" }, { kind: "block" });
    await deliver({ text: "Hello, how are you? I'm here to help." }, { kind: "block" });

    // Text should NOT have been sent
    expect(sendText).not.toHaveBeenCalled();
    // Buffer should have the latest text
    expect(deliverBuffer.lastText).toBe("Hello, how are you? I'm here to help.");
    expect(deliverBuffer.textSent).toBe(false);

    // finally block sends the buffered text
    await runFinally(deliverBuffer, sendText);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("Hello, how are you? I'm here to help.");
    expect(deliverBuffer.textSent).toBe(true);
  });

  it("final kind: sends text immediately", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    await deliver({ text: "Final answer" }, { kind: "final" });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("Final answer");
    expect(deliverBuffer.textSent).toBe(true);

    // finally block should NOT send again
    await runFinally(deliverBuffer, sendText);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("tool kind: sends text immediately", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    await deliver({ text: "Tool output: file listing..." }, { kind: "tool" });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("Tool output: file listing...");
    expect(deliverBuffer.textSent).toBe(true);
  });

  it("undefined kind falls back to final (sends immediately)", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    // No info parameter at all
    await deliver({ text: "Fallback text" });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("Fallback text");
    expect(deliverBuffer.textSent).toBe(true);
  });

  it("isReasoning: skips entirely", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    await deliver({ text: "Internal reasoning...", isReasoning: true }, { kind: "block" });
    await deliver({ text: "More reasoning", isReasoning: true }, { kind: "final" });

    expect(sendText).not.toHaveBeenCalled();
    expect(deliverBuffer.lastText).toBeNull();

    await runFinally(deliverBuffer, sendText);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("blocks then final: final sends immediately, finally does nothing", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    // Streaming blocks
    await deliver({ text: "Part 1" }, { kind: "block" });
    await deliver({ text: "Part 1 Part 2" }, { kind: "block" });
    expect(sendText).not.toHaveBeenCalled();
    expect(deliverBuffer.lastText).toBe("Part 1 Part 2");

    // Final arrives
    await deliver({ text: "Complete response" }, { kind: "final" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("Complete response");
    expect(deliverBuffer.textSent).toBe(true);

    // finally block should not send again
    await runFinally(deliverBuffer, sendText);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("onError clears buffer so finally does not send stale text", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendError = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);
    const onError = makeOnError(deliverBuffer, sendError);

    // Partial text buffered before error
    await deliver({ text: "Partial response from AI..." }, { kind: "block" });
    expect(deliverBuffer.lastText).toBe("Partial response from AI...");

    // onError fires
    await onError(new Error("AI generation failed"));

    expect(deliverBuffer.lastText).toBeNull();
    expect(deliverBuffer.textSent).toBe(true);
    expect(sendError).toHaveBeenCalledTimes(1);

    // finally block — should NOT send anything
    await runFinally(deliverBuffer, sendText);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("media is sent immediately via deliver, not buffered", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    await deliver({ mediaUrl: "https://example.com/img1.png" }, { kind: "final" });
    await deliver({
      mediaUrls: [
        "https://example.com/img2.png",
        "https://example.com/img3.png",
      ],
    }, { kind: "tool" });

    // Media sent immediately — three calls total
    expect(sendMedia).toHaveBeenCalledTimes(3);
    expect(sendMedia).toHaveBeenCalledWith("https://example.com/img1.png");
    expect(sendMedia).toHaveBeenCalledWith("https://example.com/img2.png");
    expect(sendMedia).toHaveBeenCalledWith("https://example.com/img3.png");

    // No text was buffered
    expect(deliverBuffer.lastText).toBeNull();

    // finally should not send text
    await runFinally(deliverBuffer, sendText);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("sentMediaUrls dedup: same URL is not sent twice", async () => {
    const deliverBuffer = createDeliverBuffer();
    const sentMediaUrls = new Set<string>();
    const sendMedia = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const deliver = makeDeliver(deliverBuffer, sentMediaUrls, sendMedia, sendText);

    await deliver({ mediaUrl: "https://example.com/img.png" }, { kind: "block" });
    await deliver({ mediaUrl: "https://example.com/img.png" }, { kind: "final" });

    // Only one call — second was deduped
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(sentMediaUrls.size).toBe(1);
  });
});
