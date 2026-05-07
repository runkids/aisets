import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssetReference } from "../types";
import { Badge, CopyButton, Tooltip } from "./ui";

const EDITOR_SCHEMES: Record<string, (path: string, line: number) => string> = {
  vscode: (p, l) => `vscode://file/${p}:${l}`,
  cursor: (p, l) => `cursor://file/${p}:${l}`,
  windsurf: (p, l) => `windsurf://file/${p}:${l}`,
  antigravity: (p, l) => `antigravity://file/${p}:${l}`,
  trae: (p, l) => `trae://file/${p}:${l}`,
  webstorm: (p, l) =>
    `jetbrains://webstorm/navigate/reference?path=${p}&line=${l}`,
  idea: (p, l) => `jetbrains://idea/navigate/reference?path=${p}&line=${l}`,
  goland: (p, l) => `jetbrains://goland/navigate/reference?path=${p}&line=${l}`,
  pycharm: (p, l) =>
    `jetbrains://pycharm/navigate/reference?path=${p}&line=${l}`,
  rubymine: (p, l) =>
    `jetbrains://rubymine/navigate/reference?path=${p}&line=${l}`,
  phpstorm: (p, l) =>
    `jetbrains://phpstorm/navigate/reference?path=${p}&line=${l}`,
  zed: (p, l) => `zed://file/${p}:${l}`,
  sublime: (p, l) => `subl://open?url=file://${p}&line=${l}`,
};

type Props = {
  references: AssetReference[];
  preferredEditor: string;
};

export function AssetDrawerUsage({ references, preferredEditor }: Props) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: references.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 68,
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const editorUrl = (file: string, line: number) => {
    const fn = EDITOR_SCHEMES[preferredEditor] ?? EDITOR_SCHEMES.vscode;
    return fn(file, line);
  };

  const copyAllText = references
    .map((ref) => `${ref.file}:${ref.line}`)
    .join("\n");

  if (references.length === 0) {
    return (
      <div className="rounded-g-md border border-g-line bg-g-red/8 p-4 text-center text-g-caption text-g-red">
        {t("assetDrawer.usageEmpty")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
          {t("assetDrawer.references", { count: references.length })}
        </span>
        <CopyButton
          value={copyAllText}
          label={t("assetDrawer.copyAll")}
          size="md"
        />
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const ref = references[virtualRow.index];
            return (
              <div
                key={virtualRow.index}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 w-full pb-1.5"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="rounded-g-md border border-g-line bg-g-surface-2 px-3 py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-g-mono text-g-caption">
                        <span className="text-g-ink">{ref.file}</span>
                        <span className="text-g-ink-3">:{ref.line}</span>
                      </div>
                      {(ref.snippet || ref.specifier) && (
                        <div className="mt-1 break-all font-g-mono text-g-chip text-g-ink-4">
                          {ref.snippet || ref.specifier}
                        </div>
                      )}
                      <div className="mt-1">
                        <Badge tone="line" className="text-[10px]">
                          {ref.kind}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                      <CopyButton
                        value={`${ref.file}:${ref.line}`}
                        label="Copy reference"
                      />
                      <Tooltip
                        label={t("assetDrawer.openInEditor", {
                          editor: preferredEditor,
                        })}
                      >
                        <a
                          href={editorUrl(ref.file, ref.line)}
                          className="inline-flex size-6 items-center justify-center rounded-g-sm text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink"
                          aria-label={t("assetDrawer.openInEditor", {
                            editor: preferredEditor,
                          })}
                        >
                          <ExternalLink size={14} />
                        </a>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
