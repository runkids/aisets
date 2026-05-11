import { describe, expect, it, vi } from "vitest";
import {
  initialOCRActivityState,
  ocrActivityReducer,
  runOCRActivity,
  type OCRActivityAction,
  type OCRActivityAbortRef,
} from "./ocrActivity";
import type { OCRRunCounts, OCRRunEvent } from "../types";

const emptyCounts: OCRRunCounts = {
  queued: 0,
  processed: 0,
  ready: 0,
  failed: 0,
  skipped: 0,
  cacheHit: 0,
  dedup: 0,
};

function reduce(actions: OCRActivityAction[]) {
  return actions.reduce(ocrActivityReducer, initialOCRActivityState);
}

describe("ocrActivityReducer", () => {
  it("tracks start, batch progress, and dismiss", () => {
    const counts = { ...emptyCounts, queued: 2, processed: 1, ready: 1 };
    const state = reduce([
      { type: "saving" },
      { type: "batchStarted", batch: 1 },
      {
        type: "event",
        event: {
          type: "progress",
          assetId: "asset-1",
          repoPath: "src/a.png",
          status: "ready",
          counts,
        },
      },
    ]);

    expect(state).toMatchObject({
      phase: "running",
      batch: 1,
      counts,
    });
    expect(ocrActivityReducer(state, { type: "dismiss" })).toEqual(
      initialOCRActivityState,
    );
  });
});

describe("runOCRActivity", () => {
  it("runs multiple OCR batches while hasMore is true", async () => {
    const dispatch = vi.fn<(action: OCRActivityAction) => void>();
    const abortRef: OCRActivityAbortRef = { current: null };
    const firstCounts = { ...emptyCounts, queued: 1, processed: 1, ready: 1 };
    const secondCounts = { ...emptyCounts, queued: 1, processed: 1, ready: 1 };

    const result = await runOCRActivity({
      abortRef,
      dispatch,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      runBatch: vi
        .fn()
        .mockResolvedValueOnce({
          type: "done",
          counts: firstCounts,
          hasMore: true,
        })
        .mockResolvedValueOnce({
          type: "done",
          counts: secondCounts,
          hasMore: false,
        }),
    });

    expect(result).toEqual({ status: "done" });
    expect(dispatch).toHaveBeenCalledWith({ type: "saving" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "batchStarted", batch: 1 }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "batchStarted", batch: 2 }));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "done",
      counts: secondCounts,
    });
  });

  it("stops when the active OCR request is aborted", async () => {
    const dispatch = vi.fn<(action: OCRActivityAction) => void>();
    const abortRef: OCRActivityAbortRef = { current: null };

    const result = await runOCRActivity({
      abortRef,
      dispatch,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      runBatch: vi.fn().mockImplementation(({ signal }) => {
        signal.dispatchEvent(new Event("abort"));
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }),
    });

    expect(result).toEqual({ status: "stopped" });
    expect(dispatch).toHaveBeenLastCalledWith({ type: "stopped" });
  });

  it("records streamed API errors", async () => {
    const dispatch = vi.fn<(action: OCRActivityAction) => void>();
    const abortRef: OCRActivityAbortRef = { current: null };
    const error = Object.assign(new Error("OCR failed"), {
      code: "ocr_failed",
    });

    const result = await runOCRActivity({
      abortRef,
      dispatch,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      runBatch: vi.fn().mockRejectedValue(error),
    });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "ocr_failed",
      errorMessage: "OCR failed",
    });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: "error",
      errorCode: "ocr_failed",
      errorMessage: "OCR failed",
    });
  });

  it("passes OCR events from the active batch into state", async () => {
    const events: OCRRunEvent[] = [];
    const dispatch = vi.fn<(action: OCRActivityAction) => void>((action) => {
      if (action.type === "event") events.push(action.event);
    });
    const abortRef: OCRActivityAbortRef = { current: null };
    const counts = { ...emptyCounts, queued: 1, processed: 1, ready: 1 };

    await runOCRActivity({
      abortRef,
      dispatch,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      runBatch: vi.fn().mockImplementation(({ onEvent }) => {
        onEvent({
          type: "progress",
          assetId: "asset-1",
          repoPath: "src/a.png",
          status: "ready",
          counts,
        });
        return Promise.resolve({ type: "done", counts });
      }),
    });

    expect(events).toEqual([
      {
        type: "progress",
        assetId: "asset-1",
        repoPath: "src/a.png",
        status: "ready",
        counts,
      },
    ]);
  });
});
