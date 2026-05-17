import { describe, expect, it } from "vitest";
import type { CanvasChatRunResult } from "./canvasChatRunResult";
import {
  applyCanvasPlanStepResult,
  canvasPlanContextForStep,
  CANVAS_PLAN_INVALID_ACTIONS_REPAIRED,
  CANVAS_PLAN_NO_EXECUTION_EVIDENCE,
  CANVAS_PLAN_REASON_COMPLETED_WITH_EVIDENCE,
  CANVAS_PLAN_REASON_MISSING_REQUIRED_EVIDENCE,
  CANVAS_PLAN_REASON_TEXT_ONLY,
  CANVAS_PLAN_SCORE_BELOW_FIVE,
  scoreCanvasPlanStepResult,
} from "./canvasPlanRunner";
import type { CanvasPlanState } from "./canvasPlanState";

function makePlan(): CanvasPlanState {
  return {
    id: "plan-1",
    status: "running",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
    steps: [
      {
        id: "step-1",
        task: "Add two images",
        status: "completed",
        summary: "Added two cards",
        evidence: ["action results: add_assets_to_canvas"],
      },
      { id: "step-2", task: "Arrange the images", status: "running" },
      { id: "step-3", task: "Capture the canvas", status: "pending" },
    ],
  };
}

function makeResult(
  result: Partial<CanvasChatRunResult> = {},
): CanvasChatRunResult {
  return {
    status: "completed",
    assistantText: "Arranged the images.",
    activity: [],
    evidence: {
      actionResultTools: ["arrange_cards"],
      actionResultCounts: { arrange_cards: 2 },
      proposalTools: [],
      generatedImageCount: 0,
      executedActionCount: 1,
      invalidActionCount: 0,
    },
    ...result,
  };
}

describe("canvasPlanContextForStep", () => {
  it("passes completed step memory to the next task", () => {
    const plan = makePlan();
    expect(canvasPlanContextForStep(plan, plan.steps[1])).toEqual({
      planId: "plan-1",
      stepIndex: 2,
      totalSteps: 3,
      currentTask: "Arrange the images",
      completedSteps: [
        {
          index: 1,
          task: "Add two images",
          summary: "Added two cards",
          evidence: ["action results: add_assets_to_canvas"],
        },
      ],
    });
  });
});

describe("applyCanvasPlanStepResult", () => {
  it("marks a step complete when execution evidence exists", () => {
    const next = applyCanvasPlanStepResult(makePlan(), "step-2", makeResult());

    expect(next.status).toBe("running");
    expect(next.steps[1]).toMatchObject({
      status: "completed",
      summary: "Arranged the images.",
      evidence: ["executed actions: 1", "action results: arrange_cards (2)"],
      scoreReason: CANVAS_PLAN_REASON_COMPLETED_WITH_EVIDENCE,
    });
  });

  it("fails and stops when the AI only returns prose", () => {
    const next = applyCanvasPlanStepResult(
      makePlan(),
      "step-2",
      makeResult({
        assistantText: "Done.",
        evidence: {
          actionResultTools: [],
          actionResultCounts: {},
          proposalTools: [],
          generatedImageCount: 0,
          executedActionCount: 0,
          invalidActionCount: 0,
        },
      }),
    );

    expect(next.status).toBe("failed");
    expect(next.steps[1]).toMatchObject({
      status: "failed",
      error: CANVAS_PLAN_NO_EXECUTION_EVIDENCE,
      scoreReason: CANVAS_PLAN_REASON_TEXT_ONLY,
    });
    expect(next.steps[2].status).toBe("pending");
  });

  it("fails below-five score when invalid actions were repaired", () => {
    const next = applyCanvasPlanStepResult(
      makePlan(),
      "step-2",
      makeResult({
        evidence: {
          actionResultTools: ["arrange_cards"],
          actionResultCounts: { arrange_cards: 2 },
          proposalTools: [],
          generatedImageCount: 0,
          executedActionCount: 1,
          invalidActionCount: 1,
        },
      }),
    );

    expect(next.steps[1]).toMatchObject({
      status: "failed",
      score: 4,
      warning: CANVAS_PLAN_INVALID_ACTIONS_REPAIRED,
      error: CANVAS_PLAN_SCORE_BELOW_FIVE,
    });
  });

  it("fails an add-to-canvas step when the AI only searched", () => {
    const plan = makePlan();
    const next = applyCanvasPlanStepResult(
      {
        ...plan,
        steps: plan.steps.map((step) =>
          step.id === "step-2"
            ? {
                ...step,
                task: "Search for at least 10 image assets and add exactly 10 image cards to the canvas.",
              }
            : step,
        ),
      },
      "step-2",
      makeResult({
        assistantText: "Found candidates.",
        evidence: {
          actionResultTools: ["search_assets"],
          actionResultCounts: { search_assets: 10 },
          proposalTools: [],
          generatedImageCount: 0,
          executedActionCount: 1,
          invalidActionCount: 0,
        },
      }),
    );

    expect(next.status).toBe("failed");
    expect(next.steps[1]).toMatchObject({
      status: "failed",
      score: 2,
      error: CANVAS_PLAN_SCORE_BELOW_FIVE,
      scoreReason: CANVAS_PLAN_REASON_MISSING_REQUIRED_EVIDENCE,
    });
    expect(next.steps[1].improvement).toContain("add_assets_to_canvas");
  });
});

describe("scoreCanvasPlanStepResult", () => {
  it("requires count-aware add evidence for bulk image tasks", () => {
    expect(
      scoreCanvasPlanStepResult(
        "Add at least 10 image assets to the canvas.",
        makeResult({
          evidence: {
            actionResultTools: ["add_assets_to_canvas"],
            actionResultCounts: { add_assets_to_canvas: 8 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 2 });

    expect(
      scoreCanvasPlanStepResult(
        "Add at least 10 image assets to the canvas.",
        makeResult({
          evidence: {
            actionResultTools: ["add_assets_to_canvas"],
            actionResultCounts: { add_assets_to_canvas: 10 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 5 });
  });

  it("does not treat references to already added images as a new add requirement", () => {
    expect(
      scoreCanvasPlanStepResult(
        "Call inspect_image_quality for both visible catalog image assets to produce optimization evidence for the two added images.",
        makeResult({
          evidence: {
            actionResultTools: ["inspect_image_quality"],
            actionResultCounts: { inspect_image_quality: 2 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 5 });

    expect(
      scoreCanvasPlanStepResult(
        "Call inspect_image_quality for both visible catalog image assets to produce optimization evidence for the two existing image cards.",
        makeResult({
          evidence: {
            actionResultTools: ["inspect_image_quality"],
            actionResultCounts: { inspect_image_quality: 0 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 2 });

    expect(
      scoreCanvasPlanStepResult(
        "Call inspect_image_quality for both visible catalog image assets to produce optimization evidence for the two existing image cards.",
        makeResult({
          evidence: {
            actionResultTools: ["inspect_image_quality"],
            actionResultCounts: { inspect_image_quality: 2 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 5 });
  });

  it("does not treat compression quality as a quality-inspection requirement", () => {
    expect(
      scoreCanvasPlanStepResult(
        "Compress both visible catalog image assets to webp with quality 80 using compress_image so compressed image variants appear on the canvas.",
        makeResult({
          evidence: {
            actionResultTools: ["compress_image"],
            actionResultCounts: { compress_image: 2 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 5 });

    expect(
      scoreCanvasPlanStepResult(
        "Compress both visible catalog image assets to webp with quality 80 using compress_image so compressed image variants appear on the canvas.",
        makeResult({
          evidence: {
            actionResultTools: ["compress_image"],
            actionResultCounts: { compress_image: 1 },
            proposalTools: [],
            generatedImageCount: 0,
            executedActionCount: 1,
            invalidActionCount: 0,
          },
        }),
      ),
    ).toMatchObject({ score: 2 });
  });
});
