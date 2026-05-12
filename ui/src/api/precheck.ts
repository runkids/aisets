import type { APIErrorBody } from "@/types";
import { APIError, basePath, streamNDJSON } from "./client";

export type PreCheckAIEvent =
  | {
      type: "result";
      ai: {
        name: string;
        status: string;
        category?: string;
        tags?: string[];
        description?: string;
        quality?: { score: number; issues: string[]; assessment: string };
        suggestion?: {
          recommendedFilename: string;
          formatRecommendation: string;
          suitability: "good" | "acceptable" | "poor";
          suitabilityReason: string;
        };
      };
    }
  | { type: "error"; error?: { message?: string } };

function parsePreCheckAILine(
  line: string,
  onEvent?: (event: PreCheckAIEvent) => void,
): PreCheckAIEvent | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as PreCheckAIEvent;
    onEvent?.(event);
    return event;
  } catch {
    return null;
  }
}

function isPreCheckAIDone(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  event: PreCheckAIEvent,
): event is PreCheckAIEvent & { type: never } {
  return false;
}

export async function runPreCheckAI(
  files: File[],
  lang: string,
  options?: { onEvent?: (event: PreCheckAIEvent) => void },
): Promise<void> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f, f.name));
  const response = await fetch(
    `${basePath}/api/pre-check/ai?lang=${encodeURIComponent(lang)}`,
    { method: "POST", body: form },
  );
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({}))) as Partial<APIErrorBody>;
    const error = body.error;
    if (error?.code)
      throw new APIError(error.code, error.message, error.params);
    throw new APIError("precheck_ai_failed", `HTTP ${response.status}`);
  }
  await streamNDJSON<PreCheckAIEvent, PreCheckAIEvent & { type: never }>({
    response,
    parseLine: (line) => parsePreCheckAILine(line, options?.onEvent),
    isDone: isPreCheckAIDone,
    fallbackDone: null,
  });
}
