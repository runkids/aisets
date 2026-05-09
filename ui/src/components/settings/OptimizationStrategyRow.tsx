import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OptimizationStrategy } from "../../types";
import { Button, Select, Switch, TextInput, Tooltip } from "../ui";
import type { StrategyFieldErrors } from "./optimizationStrategyValidation";

const FORMAT_OPTIONS: { key: string; label: string; values: string[] }[] = [
  { key: "svg", label: "SVG", values: ["svg"] },
  { key: "png", label: "PNG", values: ["png"] },
  { key: "jpg", label: "JPG", values: ["jpg", "jpeg"] },
  { key: "gif", label: "GIF", values: ["gif"] },
  { key: "webp", label: "WebP", values: ["webp"] },
  { key: "avif", label: "AVIF", values: ["avif"] },
];

const OUTPUT_FORMATS = [
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "gif", label: "GIF" },
  { value: "svg", label: "SVG" },
];

type OptimizationStrategyRowProps = {
  strategy: OptimizationStrategy;
  disabled: boolean;
  errors: StrategyFieldErrors;
  onChange: (
    updater: (strategy: OptimizationStrategy) => OptimizationStrategy,
  ) => void;
  onDelete: () => void;
};

export function OptimizationStrategyRow({
  strategy,
  disabled,
  errors,
  onChange,
  onDelete,
}: OptimizationStrategyRowProps) {
  const { t } = useTranslation();
  const op = strategy.action.operation;

  function isFormatActive(option: (typeof FORMAT_OPTIONS)[number]) {
    return option.values.every((v) => strategy.match.formats.includes(v));
  }

  function toggleFormat(option: (typeof FORMAT_OPTIONS)[number]) {
    onChange((current) => {
      const active = option.values.every((v) =>
        current.match.formats.includes(v),
      );
      const next = active
        ? current.match.formats.filter((f) => !option.values.includes(f))
        : [
            ...current.match.formats,
            ...option.values.filter((v) => !current.match.formats.includes(v)),
          ];
      return {
        ...current,
        match: { ...current.match, formats: next },
      };
    });
  }

  const setMatchNumber = (
    field: "minBytesKB" | "minWidthPx" | "minHeightPx",
    value: string,
  ) =>
    onChange((current) => ({
      ...current,
      match: {
        ...current.match,
        [field]: value === "" ? undefined : Number(value),
      },
    }));

  const setActionNumber = (
    field: "quality" | "avifSpeed" | "resizeMaxDimensionPx",
    value: string,
  ) =>
    onChange((current) => ({
      ...current,
      action: {
        ...current.action,
        [field]: value === "" ? undefined : Number(value),
      },
    }));

  return (
    <div className="grid gap-3 rounded-g-md border border-g-line bg-g-surface-2 p-3">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="shrink-0 pb-1.5">
          <Switch
            checked={strategy.enabled}
            disabled={disabled}
            aria-label={strategy.name}
            onCheckedChange={(next) =>
              onChange((current) => ({ ...current, enabled: next }))
            }
          />
        </div>
        <Tooltip
          placement="top"
          align="start"
          label={t("settings.strategyNameHint", {
            defaultValue: "A descriptive name for this strategy",
          })}
        >
          <TextInput
            size="md"
            label={t("settings.strategyName")}
            value={strategy.name}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({ ...current, name: event.target.value }))
            }
            className="min-w-[180px] flex-[2]"
          />
        </Tooltip>
        <Tooltip
          placement="top"
          align="start"
          label={t("settings.strategyPriorityHint", {
            defaultValue:
              "Lower values are checked first; the first matching strategy wins",
          })}
        >
          <TextInput
            size="md"
            label={t("settings.strategyPriority")}
            type="number"
            value={strategy.priority}
            invalid={Boolean(errors.priority)}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                priority: Number(event.target.value),
              }))
            }
            className="min-w-[90px] flex-1"
          />
        </Tooltip>
        <button
          type="button"
          className="grid size-7 shrink-0 cursor-pointer place-items-center self-end rounded-g-md text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-red-soft hover:text-g-red focus-visible:outline-none focus-visible:shadow-g-focus disabled:cursor-not-allowed disabled:opacity-[0.38]"
          aria-label={t("settings.removeStrategy")}
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {errors.priority && <FieldError>{errors.priority}</FieldError>}

      {/* ── Match section ── */}
      <div className="grid gap-2 border-t border-g-line pt-3">
        <SectionLabel
          label={t("settings.strategyMatchLabel", { defaultValue: "Match" })}
          description={t("settings.strategyMatchDesc", {
            defaultValue:
              "Images matching all conditions below will use this strategy",
          })}
        />
        <div className="flex flex-wrap gap-1.5">
          {FORMAT_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              variant="chip"
              size="md"
              data-active={isFormatActive(opt) || undefined}
              disabled={disabled}
              onClick={() => toggleFormat(opt)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        {errors.formats && <FieldError>{errors.formats}</FieldError>}
        <div className="grid gap-2 grid-cols-2">
          <SelectField
            label={t("settings.strategyAlpha")}
            hint={t("settings.strategyAlphaHint", {
              defaultValue:
                "Filter by whether the image has a transparent background",
            })}
          >
            <Select
              size="md"
              value={strategy.match.alpha}
              aria-label={t("settings.strategyAlpha")}
              options={[
                { value: "any", label: t("settings.strategyAlphaAny") },
                {
                  value: "transparent",
                  label: t("settings.strategyAlphaTransparent"),
                },
                { value: "opaque", label: t("settings.strategyAlphaOpaque") },
              ]}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  match: {
                    ...current.match,
                    alpha: value as OptimizationStrategy["match"]["alpha"],
                  },
                }))
              }
            />
          </SelectField>
          <SelectField
            label={t("settings.strategyAnimated")}
            hint={t("settings.strategyAnimatedHint", {
              defaultValue:
                "Filter by whether the image contains animation frames",
            })}
          >
            <Select
              size="md"
              value={strategy.match.animated}
              aria-label={t("settings.strategyAnimated")}
              options={[
                { value: "any", label: t("settings.strategyAnimatedAny") },
                { value: "true", label: t("settings.strategyAnimatedTrue") },
                { value: "false", label: t("settings.strategyAnimatedFalse") },
              ]}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  match: {
                    ...current.match,
                    animated:
                      value as OptimizationStrategy["match"]["animated"],
                  },
                }))
              }
            />
          </SelectField>
        </div>
        <div className="grid gap-2 grid-cols-3">
          <Tooltip
            placement="top"
            align="start"
            label={t("settings.strategyMinBytesHint", {
              defaultValue: "Optional — only match files larger than this (KB)",
            })}
          >
            <div className="grid gap-1">
              <TextInput
                size="md"
                label={t("settings.strategyMinBytes")}
                type="number"
                value={strategy.match.minBytesKB ?? ""}
                invalid={Boolean(errors.minBytesKB)}
                disabled={disabled}
                onChange={(e) => setMatchNumber("minBytesKB", e.target.value)}
              />
              {errors.minBytesKB && (
                <FieldError>{errors.minBytesKB}</FieldError>
              )}
            </div>
          </Tooltip>
          <Tooltip
            placement="top"
            align="start"
            label={t("settings.strategyMinWidthHint", {
              defaultValue: "Optional — only match images wider than this (px)",
            })}
          >
            <div className="grid gap-1">
              <TextInput
                size="md"
                label={t("settings.strategyMinWidth")}
                type="number"
                value={strategy.match.minWidthPx ?? ""}
                invalid={Boolean(errors.minWidthPx)}
                disabled={disabled}
                onChange={(e) => setMatchNumber("minWidthPx", e.target.value)}
              />
              {errors.minWidthPx && (
                <FieldError>{errors.minWidthPx}</FieldError>
              )}
            </div>
          </Tooltip>
          <Tooltip
            placement="top"
            align="start"
            label={t("settings.strategyMinHeightHint", {
              defaultValue:
                "Optional — only match images taller than this (px)",
            })}
          >
            <div className="grid gap-1">
              <TextInput
                size="md"
                label={t("settings.strategyMinHeight")}
                type="number"
                value={strategy.match.minHeightPx ?? ""}
                invalid={Boolean(errors.minHeightPx)}
                disabled={disabled}
                onChange={(e) => setMatchNumber("minHeightPx", e.target.value)}
              />
              {errors.minHeightPx && (
                <FieldError>{errors.minHeightPx}</FieldError>
              )}
            </div>
          </Tooltip>
        </div>
      </div>

      {/* ── Action section (conditional fields based on operation) ── */}
      <div className="grid gap-2 border-t border-g-line pt-3">
        <SectionLabel
          label={t("settings.strategyActionLabel", { defaultValue: "Action" })}
          description={t("settings.strategyActionDesc", {
            defaultValue: "Choose how to process matched images",
          })}
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <SelectField
            label={t("settings.strategyOperation")}
            hint={t("settings.strategyOperationHint", {
              defaultValue:
                "Choose the type of optimization to perform on matched images",
            })}
          >
            <Select
              size="md"
              value={op}
              aria-label={t("settings.strategyOperation")}
              options={[
                {
                  value: "convert",
                  label: t("settings.operationConvert", {
                    defaultValue: "Convert",
                  }),
                },
                {
                  value: "recompress",
                  label: t("settings.operationRecompress", {
                    defaultValue: "Recompress",
                  }),
                },
                {
                  value: "resize",
                  label: t("settings.operationResize", {
                    defaultValue: "Resize",
                  }),
                },
                {
                  value: "svg-minify",
                  label: t("settings.operationSvgMinify", {
                    defaultValue: "SVG minify",
                  }),
                },
              ]}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  action: {
                    ...current.action,
                    operation:
                      value as OptimizationStrategy["action"]["operation"],
                  },
                }))
              }
            />
          </SelectField>
          {(op === "convert" || op === "recompress") && (
            <SelectField
              label={t("settings.strategyOutputFormat")}
              hint={t("settings.strategyOutputFormatHint", {
                defaultValue:
                  "The target format after conversion or recompression",
              })}
            >
              <Select
                size="md"
                value={strategy.action.outputFormat || "webp"}
                aria-label={t("settings.strategyOutputFormat")}
                options={OUTPUT_FORMATS}
                onChange={(value) =>
                  onChange((current) => ({
                    ...current,
                    action: { ...current.action, outputFormat: value },
                  }))
                }
              />
              {errors.outputFormat && (
                <FieldError>{errors.outputFormat}</FieldError>
              )}
            </SelectField>
          )}
          {(op === "convert" || op === "recompress") && (
            <Tooltip
              placement="top"
              align="start"
              label={t("settings.strategyQualityHint", {
                defaultValue:
                  "0–100: lower = smaller file, higher = better quality",
              })}
            >
              <div className="grid gap-1">
                <TextInput
                  size="md"
                  label={t("settings.strategyQuality")}
                  type="number"
                  value={strategy.action.quality ?? ""}
                  invalid={Boolean(errors.quality)}
                  disabled={disabled}
                  onChange={(e) => setActionNumber("quality", e.target.value)}
                />
                {errors.quality && <FieldError>{errors.quality}</FieldError>}
              </div>
            </Tooltip>
          )}
          {(op === "convert" || op === "recompress") &&
            strategy.action.outputFormat === "avif" && (
              <Tooltip
                placement="top"
                align="start"
                label={t("settings.strategyAvifSpeedHint", {
                  defaultValue: "1–10: lower = better compression but slower",
                })}
              >
                <div className="grid gap-1">
                  <TextInput
                    size="md"
                    label={t("settings.strategyAvifSpeed")}
                    type="number"
                    value={strategy.action.avifSpeed ?? ""}
                    invalid={Boolean(errors.avifSpeed)}
                    disabled={disabled}
                    onChange={(e) =>
                      setActionNumber("avifSpeed", e.target.value)
                    }
                  />
                  {errors.avifSpeed && (
                    <FieldError>{errors.avifSpeed}</FieldError>
                  )}
                </div>
              </Tooltip>
            )}
          {op === "resize" && (
            <Tooltip
              placement="top"
              align="start"
              label={t("settings.strategyResizeHint", {
                defaultValue:
                  "Max width/height in pixels — images exceeding this are scaled down proportionally",
              })}
            >
              <div className="grid gap-1">
                <TextInput
                  size="md"
                  label={t("settings.strategyResize")}
                  type="number"
                  value={strategy.action.resizeMaxDimensionPx ?? ""}
                  invalid={Boolean(errors.resizeMaxDimensionPx)}
                  disabled={disabled}
                  onChange={(e) =>
                    setActionNumber("resizeMaxDimensionPx", e.target.value)
                  }
                />
                {errors.resizeMaxDimensionPx && (
                  <FieldError>{errors.resizeMaxDimensionPx}</FieldError>
                )}
              </div>
            </Tooltip>
          )}
          {(op === "convert" || op === "recompress") && (
            <Tooltip
              placement="top"
              align="start"
              label={t("settings.strategyPreserveAnimationHint", {
                defaultValue:
                  "Keep original animation frames when converting or recompressing",
              })}
            >
              <div className="flex items-center gap-2 self-end pb-1">
                <Switch
                  checked={strategy.action.preserveAnimation ?? false}
                  disabled={disabled}
                  aria-label={t("settings.strategyPreserveAnimation")}
                  onCheckedChange={(next) =>
                    onChange((current) => ({
                      ...current,
                      action: { ...current.action, preserveAnimation: next },
                    }))
                  }
                />
                <span className="text-g-caption text-g-ink-3">
                  {t("settings.strategyPreserveAnimation")}
                </span>
              </div>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const labelEl = (
    <span className="block font-g text-g-caption font-[510] tracking-g-ui text-g-ink-3">
      {label}
    </span>
  );
  return (
    <div className="grid gap-1">
      {hint ? (
        <Tooltip label={hint} placement="top" align="start">
          {labelEl}
        </Tooltip>
      ) : (
        labelEl
      )}
      {children}
    </div>
  );
}

function SectionLabel({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <p className="font-g text-g-chip tracking-g-ui text-g-ink-4">
      <span className="font-[590] uppercase tracking-[0.08em]">{label}</span>
      {description && (
        <span className="ml-1.5 font-normal">— {description}</span>
      )}
    </p>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="font-g text-g-caption leading-[1.4] tracking-g-ui text-g-red">
      {children}
    </p>
  );
}
