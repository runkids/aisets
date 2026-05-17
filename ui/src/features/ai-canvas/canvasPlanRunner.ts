import type { CanvasChatRunResult } from "./canvasChatRunResult";
import type {
  CanvasPlanContext,
  CanvasPlanState,
  CanvasPlanStep,
  CanvasPlanStepStatus,
} from "./canvasPlanState";

export const CANVAS_PLAN_NO_EXECUTION_EVIDENCE = "no_execution_evidence";
export const CANVAS_PLAN_INVALID_ACTIONS_REPAIRED = "invalid_actions_repaired";
export const CANVAS_PLAN_SCORE_BELOW_FIVE = "score_below_five";
export const CANVAS_PLAN_REASON_CANCELED = "canceled";
export const CANVAS_PLAN_REASON_FAILED = "failed";
export const CANVAS_PLAN_REASON_TEXT_ONLY = "text_only";
export const CANVAS_PLAN_REASON_MISSING_REQUIRED_EVIDENCE =
  "missing_required_evidence";
export const CANVAS_PLAN_REASON_COMPLETED_WITH_EVIDENCE =
  "completed_with_evidence";

function nowISO() {
  return new Date().toISOString();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function canvasPlanResultHasExecutionEvidence(
  result: CanvasChatRunResult,
) {
  return (
    result.evidence.executedActionCount > 0 ||
    result.evidence.actionResultTools.length > 0 ||
    result.evidence.proposalTools.length > 0 ||
    result.evidence.generatedImageCount > 0
  );
}

export function canvasPlanEvidenceLabels(result: CanvasChatRunResult) {
  const labels: string[] = [];
  if (result.evidence.executedActionCount > 0) {
    labels.push(`executed actions: ${result.evidence.executedActionCount}`);
  }
  const actionTools = unique(result.evidence.actionResultTools);
  if (actionTools.length > 0) {
    labels.push(
      `action results: ${actionTools
        .map((tool) => {
          const count = result.evidence.actionResultCounts[tool];
          return typeof count === "number" ? `${tool} (${count})` : tool;
        })
        .join(", ")}`,
    );
  }
  const proposalTools = unique(result.evidence.proposalTools);
  if (proposalTools.length > 0)
    labels.push(`proposals: ${proposalTools.join(", ")}`);
  if (result.evidence.generatedImageCount > 0) {
    labels.push(`generated images: ${result.evidence.generatedImageCount}`);
  }
  if (result.evidence.invalidActionCount > 0) {
    labels.push(
      `invalid actions repaired: ${result.evidence.invalidActionCount}`,
    );
  }
  return labels;
}

type RequiredPlanEvidence = {
  label: string;
  tools?: string[];
  proposalTools?: string[];
  generatedImage?: boolean;
  minCount?: number;
  improvement: string;
};

type CanvasPlanStepReview = {
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
  improvement?: string;
};

const IMAGE_VARIANT_TOOLS = ["compress_image", "resize_image", "convert_image"];
const LAYOUT_TOOLS = [
  "arrange_cards",
  "align_cards",
  "distribute_cards",
  "move_card",
];
const IMAGE_VARIANT_TERMS = [
  "compress",
  "compression",
  "compress_image",
  "webp",
  "avif",
  "resize_image",
  "convert_image",
];

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function includesAnyWord(text: string, words: string[]) {
  return words.some((word) =>
    new RegExp(
      `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ).test(text),
  );
}

function requestedCount(task: string) {
  const match = task.match(
    /\b(?:at least|exactly|minimum of)?\s*(\d+)\s+(?:(?:visually|diverse|visible|existing|catalog|current|selected|image)\s+)*(?:assets?|cards?|images?)\b/i,
  );
  if (match) {
    const count = Number(match[1]);
    return Number.isFinite(count) && count > 0 ? count : undefined;
  }
  const wordCounts: Record<string, number> = {
    both: 2,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const wordMatch = task.match(
    /\b(both|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:visually|diverse|visible|existing|catalog|current|selected|image)\s+)*(?:assets?|cards?|images?)\b/i,
  );
  if (!wordMatch) return undefined;
  const count = wordCounts[wordMatch[1].toLowerCase()];
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

function inferRequiredPlanEvidence(task: string): RequiredPlanEvidence[] {
  const text = task.toLowerCase();
  const required: RequiredPlanEvidence[] = [];
  const count = requestedCount(task);
  const mentionsCanvasCard =
    includesAny(text, ["canvas", "card", "cards", "visible"]) ||
    includesAny(text, ["image asset", "image assets"]);

  const requestsAddToCanvas =
    text.includes("add_assets_to_canvas") ||
    (includesAnyWord(text, ["add", "place", "put", "include", "import"]) &&
      mentionsCanvasCard);

  if (requestsAddToCanvas) {
    required.push({
      label: count
        ? `add_assets_to_canvas >= ${count}`
        : "add_assets_to_canvas",
      tools: ["add_assets_to_canvas"],
      minCount: count,
      improvement: count
        ? `call add_assets_to_canvas with at least ${count} assets`
        : "call add_assets_to_canvas for the selected assets",
    });
  } else if (includesAny(text, ["search", "find", "list", "show"])) {
    required.push({
      label: "search_assets",
      tools: ["search_assets"],
      improvement: "call search_assets and return concrete catalog results",
    });
  }

  if (
    includesAny(text, [
      "arrange",
      "layout",
      "grid",
      "row",
      "column",
      "spacing",
      "overlap",
      "align",
      "distribute",
      "move",
      "stack",
    ])
  ) {
    required.push({
      label: LAYOUT_TOOLS.join(" or "),
      tools: LAYOUT_TOOLS,
      improvement:
        "call arrange_cards, align_cards, distribute_cards, or move_card with final positions",
    });
  }

  if (includesAny(text, ["comment", "label", "annotate", "annotation"])) {
    required.push({
      label: "create_comment",
      tools: ["create_comment"],
      improvement: "call create_comment with the requested visible text",
    });
  }

  if (includesAny(text, ["duplicate", "clone", "visual copy"])) {
    required.push({
      label: "duplicate_cards",
      tools: ["duplicate_cards"],
      improvement: "call duplicate_cards for the target image cards",
    });
  }

  if (text.includes("resize") && includesAny(text, ["card", "visible"])) {
    required.push({
      label: "resize_card",
      tools: ["resize_card"],
      improvement: "call resize_card for the visible canvas card",
    });
  } else if (text.includes("resize")) {
    required.push({
      label: "resize_image",
      tools: ["resize_image"],
      improvement: "call resize_image to create a resized variant",
    });
  }

  if (includesAny(text, ["compress", "compression", "webp", "avif"])) {
    required.push({
      label: "compress_image or image variant",
      tools: IMAGE_VARIANT_TOOLS,
      generatedImage: true,
      minCount: count,
      improvement: "call compress_image and create visible compressed variants",
    });
  }

  if (text.includes("rename")) {
    required.push({
      label: "rename_asset proposal",
      proposalTools: ["rename_asset"],
      improvement: "create a rename_asset proposal for user approval",
    });
  }

  if (includesAny(text, ["copy file", "copy asset"])) {
    required.push({
      label: "copy_asset proposal",
      proposalTools: ["copy_asset"],
      improvement: "create a copy_asset proposal for user approval",
    });
  }

  if (includesAny(text, ["move file", "move asset"])) {
    required.push({
      label: "move_asset proposal",
      proposalTools: ["move_asset"],
      improvement: "create a move_asset proposal for user approval",
    });
  }

  if (includesAny(text, ["delete file", "delete asset"])) {
    required.push({
      label: "delete_asset proposal",
      proposalTools: ["delete_asset"],
      improvement: "create a delete_asset proposal for user approval",
    });
  }

  const requestsQualityInspection =
    text.includes("inspect_image_quality") ||
    includesAny(text, [
      "quality check",
      "quality review",
      "quality audit",
      "optimization advice",
      "optimization evidence",
      "optimization review",
      "optimisation advice",
      "optimisation evidence",
      "optimisation review",
    ]) ||
    (includesAny(text, ["quality", "optimization", "optimisation"]) &&
      !includesAny(text, IMAGE_VARIANT_TERMS));

  if (requestsQualityInspection) {
    required.push({
      label: "inspect_image_quality",
      tools: ["inspect_image_quality"],
      minCount: count,
      improvement: "call inspect_image_quality for the requested assets",
    });
  }

  if (includesAny(text, ["similar", "duplicate asset", "near-similar"])) {
    required.push({
      label: "find_similar_assets",
      tools: ["find_similar_assets"],
      improvement: "call find_similar_assets for the source assets",
    });
  }

  if (text.includes("compare")) {
    required.push({
      label: "compare_assets",
      tools: ["compare_assets"],
      improvement: "call compare_assets for the selected assets",
    });
  }

  if (includesAny(text, ["alt text", "alt-text"])) {
    required.push({
      label: "generate_alt_text",
      tools: ["generate_alt_text"],
      improvement: "call generate_alt_text for the requested assets",
    });
  }

  if (includesAny(text, ["ocr", "visible text", "text-bearing"])) {
    required.push({
      label: "extract_ocr_text",
      tools: ["extract_ocr_text"],
      improvement: "call extract_ocr_text for the text-bearing images",
    });
  }

  if (includesAny(text, ["capture", "screenshot", "export canvas"])) {
    required.push({
      label: "capture tool",
      tools: ["capture_canvas", "capture_viewport", "capture_selected"],
      improvement: "call a canvas capture tool",
    });
  }

  return required;
}

function hasTool(tools: string[], names: string[]) {
  return names.some((name) => tools.includes(name));
}

function planEvidenceSatisfied(
  requirement: RequiredPlanEvidence,
  result: CanvasChatRunResult,
) {
  if (requirement.generatedImage && result.evidence.generatedImageCount > 0) {
    return true;
  }
  if (
    requirement.tools &&
    hasTool(result.evidence.actionResultTools, requirement.tools)
  ) {
    if (!requirement.minCount) return true;
    return requirement.tools.some(
      (tool) =>
        (result.evidence.actionResultCounts[tool] ?? 0) >=
        requirement.minCount!,
    );
  }
  if (
    requirement.proposalTools &&
    hasTool(result.evidence.proposalTools, requirement.proposalTools)
  ) {
    return true;
  }
  return false;
}

export function scoreCanvasPlanStepResult(
  task: string,
  result: CanvasChatRunResult,
): CanvasPlanStepReview {
  if (result.status === "canceled") {
    return {
      score: 1,
      reason: CANVAS_PLAN_REASON_CANCELED,
      improvement: "Run the step again and let it reach a terminal result.",
    };
  }
  if (result.status !== "completed") {
    return {
      score: 1,
      reason: CANVAS_PLAN_REASON_FAILED,
      improvement: "Fix the failing AI/API run before continuing the plan.",
    };
  }

  const hasExecutionEvidence = canvasPlanResultHasExecutionEvidence(result);
  if (!hasExecutionEvidence) {
    return {
      score: 1,
      reason: CANVAS_PLAN_REASON_TEXT_ONLY,
      improvement:
        "Call a concrete canvas action, proposal tool, or image-generation tool.",
    };
  }

  const missing = inferRequiredPlanEvidence(task).filter(
    (requirement) => !planEvidenceSatisfied(requirement, result),
  );
  if (missing.length > 0) {
    return {
      score: 2,
      reason: CANVAS_PLAN_REASON_MISSING_REQUIRED_EVIDENCE,
      improvement: missing.map((item) => item.improvement).join("; "),
    };
  }

  if (result.evidence.invalidActionCount > 0) {
    return {
      score: 4,
      reason: CANVAS_PLAN_INVALID_ACTIONS_REPAIRED,
      improvement:
        "Tighten the prompt or tool arguments so the first emitted action is valid.",
    };
  }

  return {
    score: 5,
    reason: CANVAS_PLAN_REASON_COMPLETED_WITH_EVIDENCE,
  };
}

function summarizeStepResult(task: string, result: CanvasChatRunResult) {
  const firstLine = result.assistantText
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine.slice(0, 240);
  const evidence = canvasPlanEvidenceLabels(result).join("; ");
  return (evidence || task).slice(0, 240);
}

export function canvasPlanContextForStep(
  plan: CanvasPlanState,
  step: CanvasPlanStep,
): CanvasPlanContext {
  const stepIndex = plan.steps.findIndex((item) => item.id === step.id) + 1;
  return {
    planId: plan.id,
    stepIndex,
    totalSteps: plan.steps.length,
    currentTask: step.task,
    completedSteps: plan.steps
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === "completed")
      .map(({ item, index }) => ({
        index: index + 1,
        task: item.task,
        summary: item.summary ?? "",
        evidence: item.evidence ?? [],
      })),
  };
}

export function markCanvasPlanStepRunning(
  plan: CanvasPlanState,
  stepId: string,
): CanvasPlanState {
  const updatedAt = nowISO();
  return {
    ...plan,
    status: "running",
    activeStepId: stepId,
    updatedAt,
    steps: plan.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status: "running",
            startedAt: step.startedAt ?? updatedAt,
            error: undefined,
            warning: undefined,
            score: undefined,
            scoreReason: undefined,
            improvement: undefined,
          }
        : step,
    ),
  };
}

export function applyCanvasPlanStepResult(
  plan: CanvasPlanState,
  stepId: string,
  result: CanvasChatRunResult,
): CanvasPlanState {
  const completedAt = nowISO();
  const evidence = canvasPlanEvidenceLabels(result);
  const step = plan.steps.find((item) => item.id === stepId);
  const review = scoreCanvasPlanStepResult(step?.task ?? "", result);
  const stepStatus: CanvasPlanStepStatus =
    result.status === "canceled"
      ? "canceled"
      : result.status === "completed" && review.score === 5
        ? "completed"
        : "failed";
  const error =
    stepStatus === "failed"
      ? result.error ||
        (review.score <= 1
          ? CANVAS_PLAN_NO_EXECUTION_EVIDENCE
          : CANVAS_PLAN_SCORE_BELOW_FIVE)
      : undefined;
  const warning =
    result.evidence.invalidActionCount > 0
      ? CANVAS_PLAN_INVALID_ACTIONS_REPAIRED
      : undefined;

  const steps = plan.steps.map((step) =>
    step.id === stepId
      ? {
          ...step,
          status: stepStatus,
          summary:
            stepStatus === "completed"
              ? summarizeStepResult(step.task, result)
              : step.summary,
          evidence: evidence.length > 0 ? evidence : step.evidence,
          score: review.score,
          scoreReason: review.reason,
          improvement: review.improvement,
          warning,
          error,
          completedAt,
        }
      : step,
  );

  const planStatus =
    stepStatus === "canceled"
      ? "canceled"
      : stepStatus === "failed"
        ? "failed"
        : steps.every((step) => step.status === "completed")
          ? "completed"
          : "running";

  return {
    ...plan,
    status: planStatus,
    activeStepId: undefined,
    updatedAt: completedAt,
    steps,
  };
}

export function cancelCanvasPlan(plan: CanvasPlanState): CanvasPlanState {
  const completedAt = nowISO();
  return {
    ...plan,
    status: "canceled",
    activeStepId: undefined,
    updatedAt: completedAt,
    steps: plan.steps.map((step) =>
      step.status === "pending" || step.status === "running"
        ? { ...step, status: "canceled", completedAt }
        : step,
    ),
  };
}
