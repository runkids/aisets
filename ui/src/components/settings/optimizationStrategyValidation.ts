import type { OptimizationStrategy } from "../../types";

type Translate = (
  key: string,
  options?: Record<string, string | number>,
) => string;

const supportedStrategyFormats = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
]);
const supportedOutputFormats = new Set([
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
]);
const operationsRequiringOutput = new Set([
  "convert",
  "recompress",
  "svg-minify",
]);

export type StrategyFieldErrors = Partial<
  Record<
    | "formats"
    | "priority"
    | "minBytesKB"
    | "minWidthPx"
    | "minHeightPx"
    | "outputFormat"
    | "quality"
    | "avifSpeed"
    | "resizeMaxDimensionPx",
    string
  >
>;

export function validateStrategy(
  strategy: OptimizationStrategy,
  t: Translate,
): StrategyFieldErrors {
  const errors: StrategyFieldErrors = {};
  const invalidFormats = strategy.match.formats
    .map(normalizeStrategyFormat)
    .filter((format) => !supportedStrategyFormats.has(format));
  if (strategy.match.formats.length === 0) {
    errors.formats = t("settings.strategyValidationFormatRequired");
  } else if (invalidFormats.length > 0) {
    errors.formats = t("settings.strategyValidationUnsupportedFormats", {
      formats: Array.from(new Set(invalidFormats)).join(", "),
    });
  }
  if (!Number.isFinite(strategy.priority) || strategy.priority < 0) {
    errors.priority = t("settings.strategyValidationPriority");
  }
  validateOptionalNonNegative(
    strategy.match.minBytesKB,
    t("settings.strategyMinBytes"),
    t,
    (error) => {
      errors.minBytesKB = error;
    },
  );
  validateOptionalNonNegative(
    strategy.match.minWidthPx,
    t("settings.strategyMinWidth"),
    t,
    (error) => {
      errors.minWidthPx = error;
    },
  );
  validateOptionalNonNegative(
    strategy.match.minHeightPx,
    t("settings.strategyMinHeight"),
    t,
    (error) => {
      errors.minHeightPx = error;
    },
  );

  const outputFormat = normalizeStrategyFormat(strategy.action.outputFormat);
  if (
    operationsRequiringOutput.has(strategy.action.operation) &&
    outputFormat === ""
  ) {
    errors.outputFormat = t("settings.strategyValidationOutputRequired");
  } else if (outputFormat !== "" && !supportedOutputFormats.has(outputFormat)) {
    errors.outputFormat = t("settings.strategyValidationUnsupportedOutput", {
      format: strategy.action.outputFormat ?? "",
    });
  }
  if (
    strategy.action.quality !== undefined &&
    (!Number.isFinite(strategy.action.quality) ||
      strategy.action.quality < 0 ||
      strategy.action.quality > 100)
  ) {
    errors.quality = t("settings.strategyValidationQuality");
  }
  if (
    strategy.action.avifSpeed !== undefined &&
    (!Number.isFinite(strategy.action.avifSpeed) ||
      strategy.action.avifSpeed < 1 ||
      strategy.action.avifSpeed > 10)
  ) {
    errors.avifSpeed = t("settings.strategyValidationAvifSpeed");
  }
  validateOptionalNonNegative(
    strategy.action.resizeMaxDimensionPx,
    t("settings.strategyResize"),
    t,
    (error) => {
      errors.resizeMaxDimensionPx = error;
    },
  );
  return errors;
}

function normalizeStrategyFormat(value?: string) {
  const format = (value ?? "").trim().toLowerCase().replace(/^\./, "");
  return format === "jpeg" ? "jpg" : format;
}

function validateOptionalNonNegative(
  value: number | undefined,
  label: string,
  t: Translate,
  setError: (error: string) => void,
) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    setError(t("settings.strategyValidationNonNegative", { label }));
  }
}
