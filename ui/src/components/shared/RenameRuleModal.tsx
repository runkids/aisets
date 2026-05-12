import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { ArrowRight } from "lucide-react";
import type { AssetItem, RenameRules } from "../../types";
import { fileName } from "../../ui";
import {
  AssetThumbnail,
  Button,
  Checkbox,
  ImagePreview,
  TextInput,
} from "../ui";

type Props = {
  items: AssetItem[];
  imagePreviewEnabled: boolean;
  imagePreviewDelayMs: number;
  imagePreviewSize: { width: number; height: number };
  onCancel: () => void;
  onConfirm: (rules: RenameRules) => void;
};

function splitFileName(name: string) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const base = name.slice(0, name.length - ext.length);
  return { base, ext };
}

function applyRulesPreview(
  name: string,
  rules: RenameRules,
  customBase = "",
): string {
  const { base: originalBase, ext } = splitFileName(name);
  let base = customBase.trim() || originalBase;
  if (rules.replaceChars) {
    for (const [from, to] of Object.entries(rules.replaceChars)) {
      base = base.split(from).join(to);
    }
  }
  let finalExt = ext;
  if (rules.lowercase) {
    base = base.toLowerCase();
    finalExt = ext.toLowerCase();
  }
  base = (rules.prefix ?? "") + base + (rules.suffix ?? "");
  return base + finalExt;
}

export function RenameRuleModal({
  items,
  imagePreviewEnabled,
  imagePreviewDelayMs,
  imagePreviewSize,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [lowercase, setLowercase] = useState(false);
  const [replaceSpaces, setReplaceSpaces] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [customBases, setCustomBases] = useState<Record<string, string>>({});

  const rules = useMemo((): RenameRules => {
    const r: RenameRules = {};
    if (lowercase) r.lowercase = true;
    if (replaceSpaces) r.replaceChars = { " ": "_", "(": "", ")": "" };
    if (prefix) r.prefix = prefix;
    if (suffix) r.suffix = suffix;
    const nextCustomBases = Object.fromEntries(
      items
        .map((item) => {
          const originalBase = splitFileName(fileName(item.repoPath)).base;
          const customBase = (customBases[item.id] ?? originalBase).trim();
          return [item.id, customBase, originalBase] as const;
        })
        .filter(([, customBase, originalBase]) => customBase !== originalBase)
        .map(([id, customBase]) => [id, customBase]),
    );
    if (Object.keys(nextCustomBases).length > 0) {
      r.customBaseNames = nextCustomBases;
    }
    return r;
  }, [customBases, items, lowercase, replaceSpaces, prefix, suffix]);

  const previews = useMemo(
    () =>
      items.map((item) => {
        const name = fileName(item.repoPath);
        const { base, ext } = splitFileName(name);
        const customBase = customBases[item.id] ?? base;
        return {
          item,
          original: name,
          base,
          ext,
          customBase,
          renamed: applyRulesPreview(name, rules, customBase),
        };
      }),
    [customBases, items, rules],
  );

  const hasChanges = previews.some((p) => p.original !== p.renamed);
  const hasBlankName = previews.some((p) => p.customBase.trim() === "");

  const handleConfirm = useCallback(() => {
    if (hasChanges && !hasBlankName) onConfirm(rules);
  }, [hasBlankName, hasChanges, onConfirm, rules]);

  const setCustomBase = useCallback(
    (id: string, value: string, originalBase: string) => {
      setCustomBases((prev) => {
        const next = { ...prev };
        if (value === originalBase) {
          delete next[id];
        } else {
          next[id] = value;
        }
        return next;
      });
    },
    [],
  );

  return (
    <Modal
      title={t("rename.rulesTitle")}
      onClose={onCancel}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!hasChanges || hasBlankName}
            onClick={handleConfirm}
          >
            {t("rename.apply")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-g-ui text-g-ink">
            <Checkbox
              checked={lowercase}
              onCheckedChange={(checked) => setLowercase(checked === true)}
            />
            {t("rename.lowercase")}
          </label>
          <label className="flex items-center gap-2 text-g-ui text-g-ink">
            <Checkbox
              checked={replaceSpaces}
              onCheckedChange={(checked) => setReplaceSpaces(checked === true)}
            />
            {t("rename.replaceSpaces")}
          </label>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-g-ui text-g-ink-2">
              {t("rename.prefix")}
            </span>
            <TextInput
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="icon-"
              size="sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-g-ui text-g-ink-2">
              {t("rename.suffix")}
            </span>
            <TextInput
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="-v2"
              size="sm"
            />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-g-ui font-[510] text-g-ink">
            {t("rename.preview")}
          </h3>
          <div className="max-h-[320px] overflow-auto rounded-g-md border border-g-line bg-g-surface scroll-thin">
            {previews.map((p) => (
              <div
                key={p.item.id}
                className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 border-b border-g-line px-3 py-2 last:border-b-0 md:grid-cols-[44px_minmax(0,1fr)_minmax(220px,0.9fr)_minmax(0,1fr)] md:items-center"
              >
                <ImagePreview
                  src={p.item.url}
                  alt={p.original}
                  enabled={imagePreviewEnabled}
                  delayMs={imagePreviewDelayMs}
                  size={imagePreviewSize}
                >
                  <AssetThumbnail
                    src={p.item.thumbnailUrl || p.item.url}
                    size="md"
                  />
                </ImagePreview>
                <div className="min-w-0">
                  <div className="truncate font-g-mono text-g-caption font-[510] text-g-ink">
                    {p.original}
                  </div>
                  <div className="truncate font-g-mono text-g-chip text-g-ink-4">
                    {p.item.repoPath}
                  </div>
                </div>
                <TextInput
                  aria-label={t("rename.customName")}
                  value={p.customBase}
                  onChange={(e) =>
                    setCustomBase(p.item.id, e.target.value, p.base)
                  }
                  invalid={p.customBase.trim() === ""}
                  size="sm"
                  suffix={p.ext}
                  className="col-span-2 md:col-span-1"
                />
                <div className="col-span-2 flex min-w-0 items-center gap-2 font-g-mono text-g-caption md:col-span-1">
                  <ArrowRight size={12} className="shrink-0 text-g-ink-3" />
                  <span className="truncate text-g-ink" title={p.renamed}>
                    {p.renamed}
                  </span>
                </div>
              </div>
            ))}
            {hasBlankName && (
              <div className="border-t border-g-line px-3 py-2 text-g-caption text-g-red">
                {t("rename.emptyName")}
              </div>
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-[44px_minmax(0,1fr)] gap-3 px-3 text-g-chip text-g-ink-4 md:grid-cols-[44px_minmax(0,1fr)_minmax(220px,0.9fr)_minmax(0,1fr)]">
            <span />
            <span>{t("rename.originalName")}</span>
            <span className="hidden md:block">{t("rename.customName")}</span>
            <span className="hidden md:block">{t("rename.finalName")}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
