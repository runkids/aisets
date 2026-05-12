import type {
  APIErrorBody,
  AnalysisState,
  ScanAnalyses,
  ScanDiff,
  ScanEvent,
  ScanProgressPhase,
  ScanProfile,
  ScanSummary,
} from "@/types";
import {
  APIError,
  basePath,
  queryString,
  request,
  streamNDJSON,
  throwAPIError,
} from "./client";

export function getScans(options?: { signal?: AbortSignal }) {
  return request<{ scans: ScanSummary[] }>("/api/scans", {
    signal: options?.signal,
  });
}

export function getScanDiff(
  base: number,
  target: number,
  options?: { signal?: AbortSignal },
) {
  return request<ScanDiff>(`/api/scans/diff${queryString({ base, target })}`, {
    signal: options?.signal,
  });
}

export function clearScanHistory() {
  return request<{ ok: boolean }>("/api/scans/clear", {
    method: "POST",
    body: JSON.stringify({ confirm: "CLEAR_SCAN_HISTORY" }),
  });
}

function parseScanLine(
  line: string,
  onEvent?: (event: ScanEvent) => void,
): ScanEvent | null {
  if (!line.trim()) return null;
  const event = JSON.parse(line) as ScanEvent;
  onEvent?.(event);
  if (event.type === "error") throwAPIError(event.error);
  return event;
}

function isScanDone(
  event: ScanEvent,
): event is Extract<ScanEvent, { type: "done" }> {
  return event.type === "done";
}

function scanDoneFallback(): Extract<ScanEvent, { type: "done" }> {
  return { type: "done" };
}

export type ScanStatus = {
  running: boolean;
  phase: ScanProgressPhase;
  current: number;
  total: number;
  message?: string;
  state?: AnalysisState;
  reason?: "" | "skippedByUser" | "skippedByThreshold" | "notApplicable";
  scanId?: number;
};

export async function fetchScanStatus(): Promise<ScanStatus> {
  return request<ScanStatus>("/api/scan/status");
}

export async function scanCatalog(options?: {
  onEvent?: (event: ScanEvent) => void;
  profile?: ScanProfile;
  analyses?: Partial<ScanAnalyses>;
}) {
  const body =
    options?.profile || options?.analyses
      ? JSON.stringify({
          profile: options.profile,
          analyses: options.analyses,
        })
      : undefined;
  const response = await fetch(`${basePath}/api/scan`, {
    method: "POST",
    body,
    headers: body ? { "content-type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    const body = JSON.parse(text || "{}") as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }

  return streamNDJSON<ScanEvent, Extract<ScanEvent, { type: "done" }>>({
    response,
    parseLine: (line) => parseScanLine(line, options?.onEvent),
    isDone: isScanDone,
    fallbackDone: scanDoneFallback(),
  });
}
