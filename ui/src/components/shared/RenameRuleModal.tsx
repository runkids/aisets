import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { ArrowRight } from "lucide-react";
import type { RenameRules } from "../../types";
import { fileName } from "../../ui";

type Props = {
  filePaths: string[];
  onCancel: () => void;
  onConfirm: (rules: RenameRules) => void;
};

function applyRulesPreview(name: string, rules: RenameRules): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  let base = name.slice(0, name.length - ext.length);

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

export function RenameRuleModal({ filePaths, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [lowercase, setLowercase] = useState(false);
  const [replaceSpaces, setReplaceSpaces] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");

  const rules = useMemo((): RenameRules => {
    const r: RenameRules = {};
    if (lowercase) r.lowercase = true;
    if (replaceSpaces) r.replaceChars = { " ": "_", "(": "", ")": "" };
    if (prefix) r.prefix = prefix;
    if (suffix) r.suffix = suffix;
    return r;
  }, [lowercase, replaceSpaces, prefix, suffix]);

  const previews = useMemo(
    () =>
      filePaths.slice(0, 20).map((p) => {
        const name = fileName(p);
        return { original: name, renamed: applyRulesPreview(name, rules) };
      }),
    [filePaths, rules],
  );

  const hasChanges = previews.some((p) => p.original !== p.renamed);

  const handleConfirm = useCallback(() => {
    if (hasChanges) onConfirm(rules);
  }, [hasChanges, onConfirm, rules]);

  return (
    <Modal
      title={t("rename.rulesTitle")}
      onClose={onCancel}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-g-md px-3 text-[13px] font-[510] text-g-ink-2 hover:bg-g-surface-2"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-g-md bg-g-accent px-3 text-[13px] font-[510] text-g-canvas hover:brightness-[1.08] disabled:opacity-50"
            disabled={!hasChanges}
            onClick={handleConfirm}
          >
            {t("rename.apply")}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[13px] text-g-ink">
            <input
              type="checkbox"
              checked={lowercase}
              onChange={(e) => setLowercase(e.target.checked)}
              className="rounded"
            />
            {t("rename.lowercase")}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-g-ink">
            <input
              type="checkbox"
              checked={replaceSpaces}
              onChange={(e) => setReplaceSpaces(e.target.checked)}
              className="rounded"
            />
            {t("rename.replaceSpaces")}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-g-ink-2 w-14 shrink-0">
              {t("rename.prefix")}
            </span>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="icon-"
              className="h-7 flex-1 rounded-g-md border border-g-line bg-g-surface px-2 text-[13px] font-g-mono text-g-ink placeholder:text-g-ink-3 focus:border-g-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-g-ink-2 w-14 shrink-0">
              {t("rename.suffix")}
            </span>
            <input
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="-v2"
              className="h-7 flex-1 rounded-g-md border border-g-line bg-g-surface px-2 text-[13px] font-g-mono text-g-ink placeholder:text-g-ink-3 focus:border-g-accent focus:outline-none"
            />
          </div>
        </div>

        {hasChanges && (
          <div>
            <h3 className="mb-2 text-[13px] font-[510] text-g-ink">
              {t("rename.preview")}
            </h3>
            <div className="max-h-[200px] overflow-auto rounded-g-md border border-g-line bg-g-surface p-2 scroll-thin">
              {previews
                .filter((p) => p.original !== p.renamed)
                .map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 py-1 font-g-mono text-[12px]"
                  >
                    <span className="text-g-ink-3 truncate">{p.original}</span>
                    <ArrowRight size={12} className="shrink-0 text-g-ink-3" />
                    <span className="text-g-ink truncate">{p.renamed}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
