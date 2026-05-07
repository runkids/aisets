import type {
  AssetItem,
  CustomAssetFilter,
  CustomAssetFilterField,
} from "./types";

export type CustomFilterOption = {
  id: string;
  label: string;
  count: number;
  usesOCR: boolean;
};

const ocrFilterFields = new Set<CustomAssetFilterField>([
  "ocrText",
  "ocrLanguage",
  "ocrScript",
  "ocrConfidence",
  "ocrStatus",
]);

function itemFolder(item: AssetItem) {
  const index = item.repoPath.lastIndexOf("/");
  return index === -1 ? "" : item.repoPath.slice(0, index);
}

function normalizeExtension(value: string) {
  const ext = value.trim().toLowerCase();
  return ext && !ext.startsWith(".") ? `.${ext}` : ext;
}

function listValue(value: string) {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function includesValue(
  values: string[] | undefined,
  operator: string,
  value: string,
) {
  const target = (values ?? []).map((part) => part.toLowerCase());
  if (operator === "equals") return target.includes(value.toLowerCase());
  if (operator === "oneOf") {
    return listValue(value).some((part) => target.includes(part.toLowerCase()));
  }
  return false;
}

function matchesText(
  text: string,
  operator: string,
  value: string,
  caseSensitive = false,
) {
  if (operator === "regex") {
    return compilePathRegex(value)?.test(text) ?? false;
  }
  const target = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? value : value.toLowerCase();
  if (operator === "contains") return target.includes(needle);
  if (operator === "prefix") return target.startsWith(needle);
  if (operator === "suffix") return target.endsWith(needle);
  if (operator === "equals") return target === needle;
  return false;
}

function booleanValue(value: string) {
  return value.trim().toLowerCase() === "true";
}

function compilePathRegex(value: string) {
  try {
    return new RegExp(value, "u");
  } catch {
    const scriptExpanded = value.replace(
      /\\([pP])\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      "\\$1{Script=$2}",
    );
    if (scriptExpanded === value) return null;
    try {
      return new RegExp(scriptExpanded, "u");
    } catch {
      return null;
    }
  }
}

function matchesClause(
  item: AssetItem,
  clause: CustomAssetFilter["groups"][number]["clauses"][number],
) {
  const value = clause.value.trim();
  switch (clause.field) {
    case "path":
      return matchesText(item.repoPath, clause.operator, value);
    case "folder":
      return matchesText(itemFolder(item), clause.operator, value);
    case "extension":
      if (clause.operator === "equals") {
        return item.ext.toLowerCase() === normalizeExtension(value);
      }
      if (clause.operator === "oneOf") {
        return listValue(value)
          .map(normalizeExtension)
          .includes(item.ext.toLowerCase());
      }
      return false;
    case "project":
      if (clause.operator === "oneOf") {
        return listValue(value)
          .map((part) => part.toLowerCase())
          .includes(item.projectName.toLowerCase());
      }
      return matchesText(item.projectName, clause.operator, value);
    case "bytes": {
      const limit = Number(value);
      if (!Number.isFinite(limit)) return false;
      if (clause.operator === "gte") return item.bytes >= limit;
      if (clause.operator === "lte") return item.bytes <= limit;
      return false;
    }
    case "status":
      if (clause.operator !== "is") return false;
      if (value === "unused") return item.usedBy.length === 0;
      if (value === "referenced") return item.usedBy.length > 0;
      return false;
    case "duplicate":
      return (
        clause.operator === "is" &&
        (item.duplicates.length > 0 || item.duplicateGroupId != null) ===
          booleanValue(value)
      );
    case "nearDuplicate":
      return (
        clause.operator === "is" &&
        item.similar.length > 0 === booleanValue(value)
      );
    case "optimizable":
      return (
        clause.operator === "is" &&
        item.optimizationRecommendations.length > 0 === booleanValue(value)
      );
    case "ocrText":
      if (item.ocr?.status !== "ready") return false;
      return matchesText(
        item.ocr.normalizedText ?? item.ocr.text ?? "",
        clause.operator,
        value,
      );
    case "ocrLanguage":
      return (
        item.ocr?.status === "ready" &&
        includesValue(item.ocr.languages, clause.operator, value)
      );
    case "ocrScript":
      return (
        item.ocr?.status === "ready" &&
        includesValue(item.ocr.scripts, clause.operator, value)
      );
    case "ocrConfidence": {
      if (item.ocr?.status !== "ready" || item.ocr.confidence == null) {
        return false;
      }
      const limit = Number(value);
      if (!Number.isFinite(limit)) return false;
      if (clause.operator === "gte") return item.ocr.confidence >= limit;
      if (clause.operator === "lte") return item.ocr.confidence <= limit;
      return false;
    }
    case "ocrStatus":
      return clause.operator === "is" && item.ocr?.status === value;
    default:
      return false;
  }
}

export function matchesCustomAssetFilter(
  item: AssetItem,
  filter: CustomAssetFilter,
) {
  if (!filter.enabled || filter.groups.length === 0) return false;
  return filter.groups.some(
    (group) =>
      group.clauses.length > 0 &&
      group.clauses.every((clause) => matchesClause(item, clause)),
  );
}

export function enabledCustomAssetFilters(filters: CustomAssetFilter[] = []) {
  return filters.filter((filter) => filter.enabled);
}

export function customAssetFilterUsesOCR(filter: CustomAssetFilter) {
  return filter.groups.some((group) =>
    group.clauses.some((clause) => ocrFilterFields.has(clause.field)),
  );
}

export function customFilterOptions(
  filters: CustomAssetFilter[] = [],
  items: AssetItem[],
): CustomFilterOption[] {
  return enabledCustomAssetFilters(filters).map((filter) => ({
    id: filter.id,
    label: filter.name,
    usesOCR: customAssetFilterUsesOCR(filter),
    count: items.filter((item) => matchesCustomAssetFilter(item, filter))
      .length,
  }));
}
