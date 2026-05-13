import type { APIErrorBody } from "@/types";

declare global {
  interface Window {
    __BASE_PATH__?: string;
  }
}

export const basePath =
  typeof window === "undefined" ? "" : (window.__BASE_PATH__ ?? "");

export class APIError extends Error {
  code: string;
  params?: Record<string, unknown>;

  constructor(code: string, message: string, params?: Record<string, unknown>) {
    super(message || code);
    this.name = "APIError";
    this.code = code;
    this.params = params;
  }
}

async function readJSON<T>(response: Response, path: string): Promise<T> {
  const text =
    typeof response.text === "function"
      ? await response.text()
      : JSON.stringify(await response.json());

  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    const snippet = text.trim().slice(0, 120);
    const looksLikeHTML = /^<!doctype|^<html/i.test(snippet);
    throw new APIError(
      looksLikeHTML ? "api_unavailable" : "invalid_json_response",
      looksLikeHTML
        ? "The API returned the app shell instead of JSON."
        : "The API returned invalid JSON.",
      { path, status: response.status },
    );
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await readJSON<Partial<APIErrorBody>>(response, path).catch(
      () => ({}) as Partial<APIErrorBody>,
    );
    const error = body.error;
    if (error?.code) {
      throw new APIError(error.code, error.message, error.params);
    }
    throw new APIError("http_error", `HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return readJSON<T>(response, path);
}

export function queryString(
  params: Record<string, string | number | undefined | null>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}

export function throwAPIError(error: APIErrorBody["error"] | undefined) {
  if (error?.code) throw new APIError(error.code, error.message, error.params);
  throw new APIError("scan_failed", "scan failed");
}

export function throwRunError(
  error: APIErrorBody["error"] | undefined,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error?.code) throw new APIError(error.code, error.message, error.params);
  throw new APIError(fallbackCode, fallbackMessage);
}

export async function streamNDJSON<TEvent, TDone extends TEvent>({
  response,
  parseLine,
  isDone,
  fallbackDone,
}: {
  response: Response;
  parseLine: (line: string) => TEvent | null;
  isDone: (event: TEvent) => event is TDone;
  fallbackDone: TDone | null;
}): Promise<TDone | null> {
  let done: TDone | null = null;

  if (!response.body) {
    const text = await response.text();
    for (const line of text.split("\n")) {
      const event = parseLine(line);
      if (event && isDone(event)) done = event;
    }
    return done ?? fallbackDone;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseLine(line);
      if (event && isDone(event)) done = event;
    }
    if (chunk.done) break;
  }

  const finalEvent = parseLine(buffer);
  if (finalEvent && isDone(finalEvent)) done = finalEvent;
  return done ?? fallbackDone;
}
