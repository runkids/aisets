import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OptimizationStrategy } from "../../types";
import { IconButton, Select, Switch, TextInput } from "../ui";
import type { StrategyFieldErrors } from "./optimizationStrategyValidation";

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

  const setStrategyNumber = (
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

  return (
    <div className="grid gap-2 rounded-g-md border border-g-line bg-g-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Switch
          checked={strategy.enabled}
          disabled={disabled}
          aria-label={strategy.name}
          onCheckedChange={(next) =>
            onChange((current) => ({
              ...current,
              enabled: next,
            }))
          }
        />
        <TextInput
          size="sm"
          label={t("settings.strategyName")}
          value={strategy.name}
          disabled={disabled}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          className="min-w-[180px] flex-[2]"
        />
        <TextInput
          size="sm"
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
        <IconButton
          size="sm"
          className="ml-auto"
          aria-label={t("settings.removeStrategy")}
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
      {errors.priority && <FieldError>{errors.priority}</FieldError>}
      <p className="font-g text-g-chip font-[590] uppercase tracking-[0.08em] text-g-ink-4">
        {t("settings.strategyMatchLabel", { defaultValue: "Match" })}
      </p>
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyFormats")}
            value={strategy.match.formats.join(",")}
            invalid={Boolean(errors.formats)}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                match: {
                  ...current.match,
                  formats: event.target.value
                    .split(",")
                    .map((part) => part.trim())
                    .filter(Boolean),
                },
              }))
            }
          />
          {errors.formats && <FieldError>{errors.formats}</FieldError>}
        </div>
        <Select
          size="sm"
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
        <Select
          size="sm"
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
                animated: value as OptimizationStrategy["match"]["animated"],
              },
            }))
          }
        />
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyMinBytes")}
            type="number"
            value={strategy.match.minBytesKB ?? ""}
            invalid={Boolean(errors.minBytesKB)}
            disabled={disabled}
            onChange={(event) =>
              setStrategyNumber("minBytesKB", event.target.value)
            }
          />
          {errors.minBytesKB && <FieldError>{errors.minBytesKB}</FieldError>}
        </div>
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyMinWidth")}
            type="number"
            value={strategy.match.minWidthPx ?? ""}
            invalid={Boolean(errors.minWidthPx)}
            disabled={disabled}
            onChange={(event) =>
              setStrategyNumber("minWidthPx", event.target.value)
            }
          />
          {errors.minWidthPx && <FieldError>{errors.minWidthPx}</FieldError>}
        </div>
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyMinHeight")}
            type="number"
            value={strategy.match.minHeightPx ?? ""}
            invalid={Boolean(errors.minHeightPx)}
            disabled={disabled}
            onChange={(event) =>
              setStrategyNumber("minHeightPx", event.target.value)
            }
          />
          {errors.minHeightPx && <FieldError>{errors.minHeightPx}</FieldError>}
        </div>
      </div>
      <p className="font-g text-g-chip font-[590] uppercase tracking-[0.08em] text-g-ink-4">
        {t("settings.strategyActionLabel", { defaultValue: "Action" })}
      </p>
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Select
          size="sm"
          value={strategy.action.operation}
          aria-label={t("settings.strategyOperation")}
          options={[
            { value: "convert", label: "convert" },
            { value: "recompress", label: "recompress" },
            { value: "resize", label: "resize" },
            { value: "svg-minify", label: "svg-minify" },
          ]}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              action: {
                ...current.action,
                operation: value as OptimizationStrategy["action"]["operation"],
              },
            }))
          }
        />
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyOutputFormat")}
            value={strategy.action.outputFormat ?? ""}
            invalid={Boolean(errors.outputFormat)}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                action: {
                  ...current.action,
                  outputFormat: event.target.value,
                },
              }))
            }
          />
          {errors.outputFormat && (
            <FieldError>{errors.outputFormat}</FieldError>
          )}
        </div>
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyQuality")}
            type="number"
            value={strategy.action.quality ?? ""}
            invalid={Boolean(errors.quality)}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                action: {
                  ...current.action,
                  quality:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                },
              }))
            }
          />
          {errors.quality && <FieldError>{errors.quality}</FieldError>}
        </div>
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyAvifSpeed")}
            type="number"
            value={strategy.action.avifSpeed ?? ""}
            invalid={Boolean(errors.avifSpeed)}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                action: {
                  ...current.action,
                  avifSpeed:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                },
              }))
            }
          />
          {errors.avifSpeed && <FieldError>{errors.avifSpeed}</FieldError>}
        </div>
        <div className="grid gap-1">
          <TextInput
            size="sm"
            label={t("settings.strategyResize")}
            type="number"
            value={strategy.action.resizeMaxDimensionPx ?? ""}
            invalid={Boolean(errors.resizeMaxDimensionPx)}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                action: {
                  ...current.action,
                  resizeMaxDimensionPx:
                    event.target.value === ""
                      ? undefined
                      : Number(event.target.value),
                },
              }))
            }
          />
          {errors.resizeMaxDimensionPx && (
            <FieldError>{errors.resizeMaxDimensionPx}</FieldError>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Switch
            checked={strategy.action.preserveAnimation ?? false}
            disabled={disabled}
            aria-label={t("settings.strategyPreserveAnimation")}
            onCheckedChange={(next) =>
              onChange((current) => ({
                ...current,
                action: {
                  ...current.action,
                  preserveAnimation: next,
                },
              }))
            }
          />
          <span className="pb-1 text-g-caption text-g-ink-3">
            {t("settings.strategyPreserveAnimation")}
          </span>
        </div>
      </div>
    </div>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="font-g text-g-caption leading-[1.4] tracking-g-ui text-g-red">
      {children}
    </p>
  );
}
