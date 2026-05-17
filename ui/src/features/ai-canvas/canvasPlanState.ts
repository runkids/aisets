export type CanvasPlanStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type CanvasPlanStatus =
  | "draft"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type CanvasPlanStep = {
  id: string;
  task: string;
  status: CanvasPlanStepStatus;
  summary?: string;
  evidence?: string[];
  score?: number;
  scoreReason?: string;
  improvement?: string;
  warning?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type CanvasPlanState = {
  id: string;
  status: CanvasPlanStatus;
  steps: CanvasPlanStep[];
  activeStepId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasPlanContext = {
  planId: string;
  stepIndex: number;
  totalSteps: number;
  currentTask: string;
  completedSteps: Array<{
    index: number;
    task: string;
    summary: string;
    evidence: string[];
  }>;
};

export const MIN_CANVAS_PLAN_STEPS = 2;

const PLAN_TEXT_LIMIT = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function safeString(value: unknown, limit = PLAN_TEXT_LIMIT) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function safeOptionalString(value: unknown, limit = PLAN_TEXT_LIMIT) {
  const text = safeString(value, limit);
  return text || undefined;
}

function safeISO(value: unknown) {
  const text = safeString(value, 80);
  return text && !Number.isNaN(Date.parse(text)) ? text : undefined;
}

function createPlanId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function normalizeStepStatus(value: unknown): CanvasPlanStepStatus {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }
  return "pending";
}

function normalizePlanStatus(value: unknown): CanvasPlanStatus {
  if (
    value === "draft" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }
  return "draft";
}

function normalizeEvidence(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const evidence = value
    .map((item) => safeString(item, 160))
    .filter(Boolean)
    .slice(0, 12);
  return evidence.length > 0 ? evidence : undefined;
}

function normalizeScore(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= 5 ? value : undefined;
}

export function normalizePlanTasks(tasks: string[]) {
  return tasks.map((task) => task.trim()).filter(Boolean);
}

export function canStartCanvasPlanTasks(tasks: string[]) {
  return (
    tasks.length >= MIN_CANVAS_PLAN_STEPS &&
    tasks.every((task) => task.trim().length > 0)
  );
}

export function createCanvasPlanState(tasks: string[]): CanvasPlanState {
  const now = new Date().toISOString();
  return {
    id: createPlanId("plan"),
    status: "running",
    steps: normalizePlanTasks(tasks).map((task) => ({
      id: createPlanId("step"),
      task,
      status: "pending",
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeCanvasPlanState(
  value: unknown,
): CanvasPlanState | undefined {
  if (!isRecord(value)) return undefined;
  const id = safeString(value.id, 120);
  if (!id || !Array.isArray(value.steps)) return undefined;

  const steps = value.steps
    .map((item): CanvasPlanStep | null => {
      if (!isRecord(item)) return null;
      const stepId = safeString(item.id, 120);
      const task = safeString(item.task);
      if (!stepId || !task) return null;
      return {
        id: stepId,
        task,
        status: normalizeStepStatus(item.status),
        summary: safeOptionalString(item.summary),
        evidence: normalizeEvidence(item.evidence),
        score: normalizeScore(item.score),
        scoreReason: safeOptionalString(item.scoreReason, 240),
        improvement: safeOptionalString(item.improvement, 240),
        warning: safeOptionalString(item.warning, 160),
        error: safeOptionalString(item.error, 160),
        startedAt: safeISO(item.startedAt),
        completedAt: safeISO(item.completedAt),
      };
    })
    .filter((step): step is CanvasPlanStep => Boolean(step));

  if (steps.length === 0) return undefined;

  const activeStepId = safeOptionalString(value.activeStepId, 120);
  const stepIds = new Set(steps.map((step) => step.id));
  const now = new Date().toISOString();

  return {
    id,
    status: normalizePlanStatus(value.status),
    steps,
    activeStepId:
      activeStepId && stepIds.has(activeStepId) ? activeStepId : undefined,
    createdAt: safeISO(value.createdAt) ?? now,
    updatedAt: safeISO(value.updatedAt) ?? now,
  };
}
