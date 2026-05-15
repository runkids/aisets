import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError } from "./client";
import { isCanvasSessionNotFound, updateCanvasSession } from "./canvasSessions";

describe("canvas session API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves not-found errors from session updates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "canvas_session_not_found",
            message: "canvas session not found",
          },
        }),
        { status: 404 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateCanvasSession("missing", {
        stateJson: "{}",
        cardCount: 0,
      }),
    ).rejects.toMatchObject({
      code: "canvas_session_not_found",
      params: { status: 404 },
    });
  });

  it("classifies missing session errors by code or status", () => {
    expect(
      isCanvasSessionNotFound(
        new APIError("canvas_session_not_found", "missing"),
      ),
    ).toBe(true);
    expect(
      isCanvasSessionNotFound(
        new APIError("canvas_session_update_failed", "missing", {
          status: 404,
        }),
      ),
    ).toBe(true);
    expect(
      isCanvasSessionNotFound(
        new APIError("canvas_session_update_failed", "failed", {
          status: 500,
        }),
      ),
    ).toBe(false);
  });
});
