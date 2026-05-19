import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { TFunction } from "i18next";
import { ListChecks, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Textarea,
} from "@/components/ui";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogSurface,
  DialogTitle,
  DialogViewport,
} from "@/components/ui/DialogShell";
import { cn } from "@/lib/cn";
import {
  canStartCanvasPlanTasks,
  createBlankCanvasPlanTasks,
  createCanvasPlanTaskDraft,
  MIN_CANVAS_PLAN_STEPS,
  normalizePlanTasks,
  type CanvasPlanState,
  type CanvasPlanStepStatus,
} from "./canvasPlanState";

type Props = {
  open: boolean;
  plan?: CanvasPlanState;
  isWorking: boolean;
  onClose: () => void;
  onStart: (tasks: string[]) => void;
  onCancel: () => void;
  onReset: () => void;
  t: TFunction;
};

type ContentProps = Omit<Props, "open">;

function badgeTone(status: CanvasPlanStepStatus) {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  if (status === "canceled") return "amber";
  return "line";
}

function scoreTone(score: number) {
  if (score === 5) return "green";
  if (score >= 3) return "amber";
  return "red";
}

export function AICanvasPlanDialog({
  open,
  plan,
  isWorking,
  onClose,
  onStart,
  onCancel,
  onReset,
  t,
}: Props) {
  if (!open) return null;

  return (
    <AICanvasPlanDialogContent
      key={plan?.id ?? "draft"}
      plan={plan}
      isWorking={isWorking}
      onClose={onClose}
      onStart={onStart}
      onCancel={onCancel}
      onReset={onReset}
      t={t}
    />
  );
}

function AICanvasPlanDialogContent({
  plan,
  isWorking,
  onClose,
  onStart,
  onCancel,
  onReset,
  t,
}: ContentProps) {
  const [tasks, setTasks] = useState<string[]>(() =>
    createCanvasPlanTaskDraft(plan),
  );
  const [attemptedStart, setAttemptedStart] = useState(false);
  const [confirmTasks, setConfirmTasks] = useState<string[] | null>(null);
  const isRunning = plan?.status === "running";
  const isRestarting =
    Boolean(plan) && plan?.status !== "draft" && plan?.status !== "running";
  const canStart = canStartCanvasPlanTasks(tasks) && !isRunning && !isWorking;
  const stepByIndex = plan?.steps ?? [];

  function resetDraft() {
    setAttemptedStart(false);
    setConfirmTasks(null);
    if (plan) {
      onReset();
      return;
    }
    setTasks(createBlankCanvasPlanTasks());
  }

  return (
    <>
      <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay asChild>
            <DialogOverlay />
          </DialogPrimitive.Overlay>
          <DialogViewport>
            <DialogPrimitive.Content asChild>
              <DialogSurface
                size="md"
                className="backdrop-blur-xl !bg-g-surface/90"
              >
                <DialogHeader className="gap-4 px-5 pb-2 pt-5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ListChecks size={18} className="shrink-0 text-g-ink-2" />
                    <DialogPrimitive.Title asChild>
                      <DialogTitle>{t("aiCanvas.planDialogTitle")}</DialogTitle>
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description asChild>
                      <DialogDescription className="sr-only">
                        {t("aiCanvas.planDialogDesc")}
                      </DialogDescription>
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close asChild>
                    <IconButton size="sm" aria-label={t("common.close")}>
                      <X />
                    </IconButton>
                  </DialogPrimitive.Close>
                </DialogHeader>

                <DialogBody padding="md">
                  <div className="flex flex-col gap-3">
                    {tasks.map((task, index) => {
                      const step = stepByIndex[index];
                      const invalid = attemptedStart && task.trim() === "";
                      return (
                        <div
                          key={step?.id ?? index}
                          className="flex gap-3 border-b border-g-line pb-3 last:border-b-0 last:pb-0"
                        >
                          <div className="flex w-8 shrink-0 justify-center pt-7">
                            <span className="grid size-6 place-items-center rounded-g-md bg-g-surface-2 font-g-mono text-g-caption text-g-ink-2">
                              {index + 1}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1.5 flex min-w-0 items-center gap-2">
                              <label
                                className="min-w-0 font-g text-g-caption font-[510] text-g-ink-3"
                                htmlFor={`canvas-plan-task-${index}`}
                              >
                                {t("aiCanvas.planTaskLabel", {
                                  count: index + 1,
                                })}
                              </label>
                              {step && (
                                <Badge
                                  tone={badgeTone(step.status)}
                                  className="shrink-0 whitespace-nowrap"
                                >
                                  {t(`aiCanvas.planStepStatus.${step.status}`)}
                                </Badge>
                              )}
                              {step?.score && (
                                <Badge
                                  tone={scoreTone(step.score)}
                                  className="shrink-0 whitespace-nowrap"
                                >
                                  {t("aiCanvas.planStepScore", {
                                    score: step.score,
                                  })}
                                </Badge>
                              )}
                            </div>
                            <Textarea
                              id={`canvas-plan-task-${index}`}
                              value={task}
                              invalid={invalid}
                              disabled={isRunning}
                              placeholder={t("aiCanvas.planTaskPlaceholder")}
                              textareaClassName="min-h-16 resize-none"
                              onChange={(event) => {
                                const next = [...tasks];
                                next[index] = event.target.value;
                                setTasks(next);
                              }}
                            />
                            {step?.warning && (
                              <p className="mt-1.5 font-g text-g-caption text-g-amber">
                                {t(`aiCanvas.planStepWarning.${step.warning}`, {
                                  defaultValue: step.warning,
                                })}
                              </p>
                            )}
                            {step?.scoreReason && (
                              <p className="mt-1.5 font-g text-g-caption text-g-ink-3">
                                {t(
                                  `aiCanvas.planStepReason.${step.scoreReason}`,
                                  {
                                    defaultValue: step.scoreReason,
                                  },
                                )}
                              </p>
                            )}
                            {step?.improvement && (
                              <p className="mt-1.5 font-g text-g-caption text-g-amber">
                                {t("aiCanvas.planStepImprovement", {
                                  improvement: step.improvement,
                                })}
                              </p>
                            )}
                            {step?.error && (
                              <p className="mt-1.5 font-g text-g-caption text-g-red">
                                {t(`aiCanvas.planStepError.${step.error}`, {
                                  defaultValue: step.error,
                                })}
                              </p>
                            )}
                          </div>
                          <IconButton
                            size="sm"
                            aria-label={t("aiCanvas.planRemoveTask")}
                            disabled={
                              isRunning || tasks.length <= MIN_CANVAS_PLAN_STEPS
                            }
                            className="mt-6 shrink-0"
                            onClick={() => {
                              setTasks((current) =>
                                current.filter(
                                  (_, taskIndex) => taskIndex !== index,
                                ),
                              );
                            }}
                          >
                            <Trash2 />
                          </IconButton>
                        </div>
                      );
                    })}
                  </div>
                </DialogBody>

                <DialogFooter className="items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Plus />}
                      disabled={isRunning}
                      onClick={() => setTasks((current) => [...current, ""])}
                    >
                      {t("aiCanvas.planAddTask")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<RotateCcw />}
                      disabled={isRunning}
                      onClick={resetDraft}
                    >
                      {t("aiCanvas.planReset")}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    {isRunning && (
                      <Button variant="danger" size="sm" onClick={onCancel}>
                        {t("aiCanvas.planStop")}
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={onClose}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!canStart}
                      className={cn(!canStart && "opacity-[0.38]")}
                      onClick={() => {
                        setAttemptedStart(true);
                        const nextTasks = normalizePlanTasks(tasks);
                        if (!canStartCanvasPlanTasks(nextTasks)) return;
                        setConfirmTasks(nextTasks);
                      }}
                    >
                      {t(
                        isRestarting
                          ? "aiCanvas.planRestart"
                          : "aiCanvas.planStart",
                      )}
                    </Button>
                  </div>
                </DialogFooter>
              </DialogSurface>
            </DialogPrimitive.Content>
          </DialogViewport>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <ConfirmDialog
        open={confirmTasks !== null}
        title={t(
          isRestarting
            ? "aiCanvas.planRestartConfirmTitle"
            : "aiCanvas.planConfirmTitle",
        )}
        message={t(
          isRestarting
            ? "aiCanvas.planRestartConfirmBody"
            : "aiCanvas.planConfirmBody",
          {
            count: confirmTasks?.length ?? 0,
          },
        )}
        confirmText={t(
          isRestarting
            ? "aiCanvas.planRestartConfirmStart"
            : "aiCanvas.planConfirmStart",
        )}
        cancelText={t("common.cancel")}
        onCancel={() => setConfirmTasks(null)}
        onConfirm={() => {
          if (!confirmTasks) return;
          onStart(confirmTasks);
          setConfirmTasks(null);
          onClose();
        }}
      />
    </>
  );
}
