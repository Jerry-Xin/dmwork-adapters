import { describe, it, expect, vi } from "vitest";
import {
  deliverFinalizableDraftPreview,
  type DraftHandle,
} from "./draft-preview-finalizer.js";

function createMockDraft(overrides?: Partial<DraftHandle>): DraftHandle {
  return {
    flush: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    discardPending: vi.fn().mockResolvedValue(undefined),
    seal: vi.fn().mockResolvedValue(undefined),
    id: vi.fn().mockReturnValue("stream-123"),
    ...overrides,
  };
}

describe("deliverFinalizableDraftPreview", () => {
  it('should return "normal-skipped" when kind is not "final"', async () => {
    const draft = createMockDraft();
    const result = await deliverFinalizableDraftPreview({
      kind: "block",
      payload: {},
      draft,
      buildFinalEdit: () => ({ content: "hello" }),
      editFinal: vi.fn(),
      deliverNormally: vi.fn().mockResolvedValue(true),
      logPreviewEditFailure: vi.fn(),
    });
    expect(result).toBe("normal-skipped");
    expect(draft.flush).not.toHaveBeenCalled();
  });

  it('should return "normal-delivered" when no active stream', async () => {
    const draft = createMockDraft({ id: vi.fn().mockReturnValue(undefined) });
    const deliverNormally = vi.fn().mockResolvedValue(true);
    const result = await deliverFinalizableDraftPreview({
      kind: "final",
      payload: {},
      draft,
      buildFinalEdit: () => ({ content: "hello" }),
      editFinal: vi.fn(),
      deliverNormally,
      logPreviewEditFailure: vi.fn(),
    });
    expect(result).toBe("normal-delivered");
    expect(deliverNormally).toHaveBeenCalled();
  });

  it('should return "preview-finalized" when buildFinalEdit returns edit and editFinal succeeds', async () => {
    const draft = createMockDraft();
    const editFinal = vi.fn().mockResolvedValue(undefined);
    const onPreviewFinalized = vi.fn();
    const result = await deliverFinalizableDraftPreview({
      kind: "final",
      payload: {},
      draft,
      buildFinalEdit: () => ({ content: "final text" }),
      editFinal,
      deliverNormally: vi.fn().mockResolvedValue(true),
      onPreviewFinalized,
      logPreviewEditFailure: vi.fn(),
    });
    expect(result).toBe("preview-finalized");
    expect(draft.flush).toHaveBeenCalled();
    expect(draft.seal).toHaveBeenCalled();
    expect(editFinal).toHaveBeenCalledWith("stream-123", { content: "final text" });
    expect(onPreviewFinalized).toHaveBeenCalled();
  });

  it('should fall back to "normal-delivered" when editFinal throws', async () => {
    const draft = createMockDraft();
    const editFinal = vi.fn().mockRejectedValue(new Error("API error"));
    const deliverNormally = vi.fn().mockResolvedValue(true);
    const logPreviewEditFailure = vi.fn();
    const result = await deliverFinalizableDraftPreview({
      kind: "final",
      payload: {},
      draft,
      buildFinalEdit: () => ({ content: "final text" }),
      editFinal,
      deliverNormally,
      logPreviewEditFailure,
    });
    expect(result).toBe("normal-delivered");
    expect(logPreviewEditFailure).toHaveBeenCalled();
    expect(draft.discardPending).toHaveBeenCalled();
    expect(deliverNormally).toHaveBeenCalled();
    expect(draft.clear).toHaveBeenCalled();
  });

  it('should return "normal-delivered" when buildFinalEdit returns undefined', async () => {
    const draft = createMockDraft();
    const deliverNormally = vi.fn().mockResolvedValue(true);
    const result = await deliverFinalizableDraftPreview({
      kind: "final",
      payload: {},
      draft,
      buildFinalEdit: () => undefined,
      editFinal: vi.fn(),
      deliverNormally,
      logPreviewEditFailure: vi.fn(),
    });
    expect(result).toBe("normal-delivered");
    expect(draft.discardPending).toHaveBeenCalled();
    expect(deliverNormally).toHaveBeenCalled();
    expect(draft.clear).toHaveBeenCalled();
  });

  it("should call discard → deliver → clear in correct order on fallback", async () => {
    const callOrder: string[] = [];
    const draft = createMockDraft({
      discardPending: vi.fn(async () => { callOrder.push("discardPending"); }),
      clear: vi.fn(async () => { callOrder.push("clear"); }),
    });
    const result = await deliverFinalizableDraftPreview({
      kind: "final",
      payload: {},
      draft,
      buildFinalEdit: () => undefined,
      editFinal: vi.fn(),
      deliverNormally: vi.fn(async () => { callOrder.push("deliverNormally"); return true; }),
      logPreviewEditFailure: vi.fn(),
    });
    expect(result).toBe("normal-delivered");
    expect(callOrder).toEqual(["discardPending", "deliverNormally", "clear"]);
  });

  it("should call flush → seal → editFinal in correct order on preview-finalized", async () => {
    const callOrder: string[] = [];
    const draft = createMockDraft({
      flush: vi.fn(async () => { callOrder.push("flush"); }),
      seal: vi.fn(async () => { callOrder.push("seal"); }),
    });
    const result = await deliverFinalizableDraftPreview({
      kind: "final",
      payload: {},
      draft,
      buildFinalEdit: () => ({ content: "x" }),
      editFinal: vi.fn(async () => { callOrder.push("editFinal"); }),
      deliverNormally: vi.fn().mockResolvedValue(true),
      logPreviewEditFailure: vi.fn(),
    });
    expect(result).toBe("preview-finalized");
    expect(callOrder).toEqual(["flush", "seal", "editFinal"]);
  });
});
