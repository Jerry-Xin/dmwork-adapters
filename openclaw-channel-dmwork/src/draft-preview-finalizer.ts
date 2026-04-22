/**
 * Local implementation of deliverFinalizableDraftPreview.
 *
 * Handles the draft-to-final transition: either finalizes the preview message
 * in-place (edit) or falls back to normal delivery (discard + send + clear).
 *
 * Logic:
 *   kind !== "final" or no active draft → "normal-skipped" (caller should deliver normally)
 *   kind === "final" and draft active:
 *     ├─ buildFinalEdit returns edit → flush → seal → editFinal → "preview-finalized"
 *     │                                └─ editFinal fails → fallback ↓
 *     └─ no edit or edit failed → discardPending → deliverNormally → clear → "normal-delivered"
 */

export type DraftHandle = {
  flush: () => Promise<void>;
  clear: () => Promise<void>;
  discardPending: () => Promise<void>;
  seal: () => Promise<void>;
  id: () => string | undefined;
};

export type DeliverFinalizableDraftPreviewParams = {
  kind: string;
  payload: unknown;
  draft: DraftHandle;
  buildFinalEdit: () => { content: string } | undefined;
  editFinal: (previewId: string, edit: { content: string }) => Promise<void>;
  deliverNormally: () => Promise<boolean>;
  onPreviewFinalized?: () => void;
  logPreviewEditFailure: (err: unknown) => void;
};

export type DeliverFinalizableDraftPreviewResult =
  | "preview-finalized"
  | "normal-delivered"
  | "normal-skipped";

export async function deliverFinalizableDraftPreview(
  params: DeliverFinalizableDraftPreviewParams,
): Promise<DeliverFinalizableDraftPreviewResult> {
  if (params.kind !== "final") {
    return "normal-skipped";
  }

  const previewId = params.draft.id();
  if (!previewId) {
    // No active stream — fall through to normal delivery
    await params.deliverNormally();
    return "normal-delivered";
  }

  const edit = params.buildFinalEdit();
  if (edit) {
    try {
      await params.draft.flush();
      await params.draft.seal();
      await params.editFinal(previewId, edit);
      params.onPreviewFinalized?.();
      return "preview-finalized";
    } catch (err) {
      params.logPreviewEditFailure(err);
      // Fall through to normal delivery
    }
  }

  // Discard preview, deliver normally, then clear
  await params.draft.discardPending();
  await params.deliverNormally();
  await params.draft.clear();
  return "normal-delivered";
}
