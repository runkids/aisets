import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCatalogDuplicates,
  getCatalogLint,
  runOCR,
  scanCatalog,
  updateSettings,
} from "./api";
import type { OCRRunEvent, ScanEvent } from "./types";

function streamFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("scanCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams NDJSON scan events as chunks arrive", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromChunks([
        '{"type":"start"}\n{"type":"prog',
        'ress","phase":"metadata","current":1,"total":2}\n',
        '{"type":"done","scanId":7}\n',
      ]),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: ScanEvent[] = [];

    const result = await scanCatalog({
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ type: "done", scanId: 7 });
    expect(events).toEqual([
      { type: "start" },
      { type: "progress", phase: "metadata", current: 1, total: 2 },
      { type: "done", scanId: 7 },
    ]);
  });

  it("throws APIError when a streamed scan error arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromChunks([
        '{"type":"error","error":{"code":"scan_failed","message":"Scan failed"}}\n',
      ]),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanCatalog()).rejects.toMatchObject({
      code: "scan_failed",
      name: "APIError",
    });
  });
});

describe("runOCR", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams NDJSON OCR events as chunks arrive", async () => {
    const counts = {
      queued: 1,
      processed: 1,
      ready: 1,
      failed: 0,
      skipped: 0,
      cacheHit: 0,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromChunks([
        `{"type":"start","counts":${JSON.stringify(counts)}}\n`,
        '{"type":"prog',
        `ress","assetId":"asset-1","repoPath":"src/a.png","status":"ready","counts":${JSON.stringify(counts)}}\n`,
        `{"type":"done","counts":${JSON.stringify(counts)}}\n`,
      ]),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const events: OCRRunEvent[] = [];

    const result = await runOCR({
      onEvent: (event) => events.push(event),
    });

    expect(result).toEqual({ type: "done", counts });
    expect(events).toEqual([
      { type: "start", counts },
      {
        type: "progress",
        assetId: "asset-1",
        repoPath: "src/a.png",
        status: "ready",
        counts,
      },
      { type: "done", counts },
    ]);
  });

  it("throws APIError when a streamed OCR error arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromChunks([
        '{"type":"error","error":{"code":"ocr_failed","message":"OCR failed"}}\n',
      ]),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runOCR()).rejects.toMatchObject({
      code: "ocr_failed",
      name: "APIError",
    });
  });
});

describe("getCatalogDuplicates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the duplicate groups endpoint with paging params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ groups: [], pairs: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getCatalogDuplicates({
      scanId: 7,
      kind: "near",
      limit: 200,
      cursor: "200",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/duplicates?scanId=7&kind=near&limit=200&cursor=200",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
        },
      }),
    );
  });
});

describe("getCatalogLint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the lint endpoint with scan, project, severity, and paging params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getCatalogLint({
      scanId: 7,
      projectId: "project-a",
      severity: "warning",
      limit: 200,
      cursor: "200",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/catalog/lint?scanId=7&projectId=project-a&severity=warning&limit=200&cursor=200",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
        },
      }),
    );
  });
});

describe("updateSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a PATCH request with the backend settings shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: {
          workspaceName: "Team",
          defaultProjectRoot: "",
          autoScanOnOpen: false,
          scanOnOpen: true,
          excludePatterns: ["dist"],
          excludePatternsByIntent: {
            code: ["**/*.test.*"],
            assetPack: [],
            library: ["**/*.test.*"],
            mixed: ["**/*.test.*"],
          },
          optimizationDefaultQuality: 72,
          optimizationAutoApply: false,
          databasePath: "/tmp/asset-studio.db",
          dataDir: "/tmp/data",
          cacheDir: "/tmp/cache",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings({
      workspaceName: "Team",
      scanOnOpen: true,
      excludePatterns: ["dist"],
      excludePatternsByIntent: {
        code: ["**/*.test.*"],
        assetPack: [],
        library: ["**/*.test.*"],
        mixed: ["**/*.test.*"],
      },
      optimizationDefaultQuality: 72,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        workspaceName: "Team",
        scanOnOpen: true,
        excludePatterns: ["dist"],
        excludePatternsByIntent: {
          code: ["**/*.test.*"],
          assetPack: [],
          library: ["**/*.test.*"],
          mixed: ["**/*.test.*"],
        },
        optimizationDefaultQuality: 72,
      }),
      headers: {
        "content-type": "application/json",
      },
    });
  });
});
