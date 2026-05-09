import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileImage,
  Loader2,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { fileName, formatBytes } from "../ui";
import {
  AssetThumbnail,
  Badge,
  Button,
  Card,
  Notice,
  StackedBar,
  StatCard,
  type StackedBarSegment,
} from "./ui";

type Verdict = "ok" | "warning" | "duplicate";

type ExactMatch = { assetId: string; repoPath: string; projectName: string };
type NearMatch = {
  assetId: string;
  repoPath: string;
  projectName: string;
  distance: number;
  flipped: boolean;
};
type NamingIssue = { code: string; message: string };
type OptimizationRec = {
  category: string;
  reasonCode: string;
  reason: string;
  severity: "critical" | "warning" | "info";
  suggestionCode: string;
  suggestion: string;
};

type PreCheckResult = {
  name: string;
  ext: string;
  size: number;
  contentHash: string;
  hashAlgorithm: string;
  dHash?: string;
  dHashFlipped?: string;
  image: {
    format: string;
    width: number;
    height: number;
    animated: boolean;
    alpha: boolean;
    pages: number;
  };
  exactMatches: ExactMatch[];
  nearMatches: NearMatch[];
  namingIssues: NamingIssue[];
  optimizationRecommendations: OptimizationRec[];
  verdict: Verdict;
  verdictReason: string;
};

type Props = {
  onOpenAsset?: (id: string) => void;
};

const VERDICT_BADGE_TONE: Record<Verdict, "green" | "warning" | "danger"> = {
  ok: "green",
  warning: "warning",
  duplicate: "danger",
};

const VERDICT_STAT_TONE: Record<Verdict, "green" | "amber" | "red"> = {
  ok: "green",
  warning: "amber",
  duplicate: "red",
};

const VERDICT_ICON: Record<Verdict, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  duplicate: XCircle,
};

function verdictReasonKey(r: PreCheckResult): string {
  if (r.verdict === "duplicate") return "precheck.verdictReason.exactMatch";
  if (r.verdict === "ok") return "precheck.verdictReason.ok";
  if (r.nearMatches.length > 0) return "precheck.verdictReason.nearMatch";
  if (r.optimizationRecommendations.some((o) => o.severity === "critical"))
    return "precheck.verdictReason.criticalOpt";
  return "precheck.verdictReason.naming";
}

let _results: PreCheckResult[] = [];
let _thumbnails = new Map<string, string>();
let _expanded = new Set<string>();

export function PreCheckView({ onOpenAsset }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<PreCheckResult[]>(_results);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [thumbnails, setThumbnails] =
    useState<Map<string, string>>(_thumbnails);
  const [expanded, setExpanded] = useState<Set<string>>(_expanded);
  const resultsRef = useRef<PreCheckResult[]>(_results);

  useEffect(() => {
    _results = results;
  }, [results]);
  useEffect(() => {
    _thumbnails = thumbnails;
  }, [thumbnails]);
  useEffect(() => {
    _expanded = expanded;
  }, [expanded]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const newThumbs = new Map<string, string>();
      for (const f of list) {
        if (f.type.startsWith("image/") || f.name.endsWith(".svg")) {
          newThumbs.set(f.name, URL.createObjectURL(f));
        }
      }

      setWorking(true);
      setError(null);
      try {
        const form = new FormData();
        list.forEach((f) => form.append("files", f, f.name));
        const res = await fetch("/api/pre-check", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error?.message ||
              t("error.uploadWithStatus", { status: res.status }),
          );
        }
        const body = await res.json();
        const incoming: PreCheckResult[] = body.results ?? [];

        const offset = resultsRef.current.length;
        const merged = [...resultsRef.current, ...incoming];
        resultsRef.current = merged;
        setResults(merged);

        setThumbnails((prev) => {
          const next = new Map(prev);
          newThumbs.forEach((url, name) => next.set(name, url));
          return next;
        });

        const autoKeys = new Set<string>();
        incoming.forEach((r, i) => {
          const idx = offset + i;
          if (r.verdict === "duplicate" && r.exactMatches.length > 0) {
            autoKeys.add(`${idx}-exact`);
          }
          if (r.verdict === "warning") {
            if (r.nearMatches.length > 0) autoKeys.add(`${idx}-near`);
            if (r.optimizationRecommendations.length > 0)
              autoKeys.add(`${idx}-opt`);
          }
        });
        setExpanded((prev) => new Set([...prev, ...autoKeys]));
      } catch (err) {
        newThumbs.forEach((url) => URL.revokeObjectURL(url));
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorking(false);
      }
    },
    [t],
  );

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        upload(files);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload]);

  function onPick() {
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    if (files) upload(files);
    e.currentTarget.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    upload(e.dataTransfer.files);
  }

  function clearResults() {
    setThumbnails((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return new Map();
    });
    resultsRef.current = [];
    setResults([]);
    setError(null);
    setExpanded(new Set());
  }

  function toggleSection(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    },
    { ok: 0, warning: 0, duplicate: 0 } as Record<Verdict, number>,
  );

  const hasResults = results.length > 0;

  const segments: StackedBarSegment[] = [
    { value: summary.ok, tone: "green", label: t("precheck.verdict.ok") },
    {
      value: summary.warning,
      tone: "amber",
      label: t("precheck.verdict.warning"),
    },
    {
      value: summary.duplicate,
      tone: "red",
      label: t("precheck.verdict.duplicate"),
    },
  ];

  return (
    <div className="mx-auto max-w-[1600px] px-0 pb-6 pt-0 max-[768px]:px-0 max-[768px]:py-0">
      {hasResults && (
        <div className="mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              label={t("precheck.verdict.ok")}
              value={summary.ok}
              tone={VERDICT_STAT_TONE.ok}
              icon={<CheckCircle2 size={14} />}
            />
            <StatCard
              label={t("precheck.verdict.warning")}
              value={summary.warning}
              tone={VERDICT_STAT_TONE.warning}
              icon={<AlertTriangle size={14} />}
            />
            <StatCard
              label={t("precheck.verdict.duplicate")}
              value={summary.duplicate}
              tone={VERDICT_STAT_TONE.duplicate}
              icon={<XCircle size={14} />}
            />
          </div>
          <div className="flex items-center gap-3">
            <StackedBar
              segments={segments}
              className="h-1.5 flex-1"
              ariaLabel={t("precheck.title")}
            />
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<X size={12} />}
              onClick={clearResults}
            >
              {t("action.clear")}
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "cursor-pointer rounded-[16px] border-2 border-dashed bg-g-surface text-center transition-all duration-200 ease-g",
          dragOver
            ? "border-g-accent bg-[color-mix(in_srgb,var(--g-accent-soft)_50%,var(--g-surface))] shadow-g-focus"
            : "border-g-line-strong hover:border-g-accent hover:bg-[color-mix(in_srgb,var(--g-accent-soft)_50%,var(--g-surface))]",
          hasResults ? "mb-4 px-6 py-5" : "mb-4 px-8 py-[60px]",
          working && "pointer-events-none opacity-70",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={onPick}
      >
        {working ? (
          <div className="flex items-center justify-center gap-3">
            <Loader2 size={18} className="animate-spin text-g-accent" />
            <span className="text-g-body font-[510] text-g-ink">
              {t("precheck.uploading")}
            </span>
          </div>
        ) : hasResults ? (
          <div className="flex items-center justify-center gap-2">
            <Upload size={14} className="text-g-ink-4" />
            <span className="text-g-ui font-[510] text-g-ink-3">
              {t("precheck.dropPrompt")}
            </span>
          </div>
        ) : (
          <>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-g-surface-2 text-g-ink-3">
              <ShieldCheck size={24} />
            </div>
            <div className="text-g-body font-[510] text-g-ink">
              {t("precheck.dropPrompt")}
            </div>
            <div className="mt-1 text-g-caption text-g-ink-4">
              {t("precheck.supportedFormats")}
            </div>
            <div className="mt-3 text-g-caption text-g-ink-4">
              {t("precheck.emptySub")}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.svg"
          className="hidden"
          onChange={onChange}
        />
      </div>

      {error && (
        <Notice tone="danger" className="mb-4" title={t("error.upload")}>
          {error}
        </Notice>
      )}

      {hasResults && (
        <div className="grid gap-3">
          {results.map((r, idx) => (
            <PreCheckCard
              key={`${r.contentHash}-${idx}`}
              result={r}
              index={idx}
              thumbnail={thumbnails.get(r.name)}
              expanded={expanded}
              onToggle={toggleSection}
              onOpenAsset={onOpenAsset}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PreCheckCard({
  result,
  index,
  thumbnail,
  expanded,
  onToggle,
  onOpenAsset,
}: {
  result: PreCheckResult;
  index: number;
  thumbnail?: string;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onOpenAsset?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const badgeTone = VERDICT_BADGE_TONE[result.verdict];
  const VerdictIcon = VERDICT_ICON[result.verdict];

  const sections: {
    id: string;
    title: string;
    count: number;
    render: () => React.ReactNode;
  }[] = [];

  if (result.exactMatches.length > 0) {
    sections.push({
      id: `${index}-exact`,
      title: t("precheck.sections.exactMatches"),
      count: result.exactMatches.length,
      render: () =>
        result.exactMatches.map((m) => (
          <MatchRow
            key={m.assetId}
            assetId={m.assetId}
            repoPath={m.repoPath}
            projectName={m.projectName}
            onClick={onOpenAsset ? () => onOpenAsset(m.assetId) : undefined}
          />
        )),
    });
  }

  if (result.nearMatches.length > 0) {
    sections.push({
      id: `${index}-near`,
      title: t("precheck.sections.nearMatches"),
      count: result.nearMatches.length,
      render: () =>
        result.nearMatches.map((m) => (
          <MatchRow
            key={m.assetId}
            assetId={m.assetId}
            repoPath={m.repoPath}
            projectName={m.projectName}
            trailing={
              m.flipped
                ? t("precheck.nearDistanceFlipped", {
                    pct: Math.round((1 - m.distance / 64) * 100),
                  })
                : t("precheck.nearDistance", {
                    pct: Math.round((1 - m.distance / 64) * 100),
                  })
            }
            onClick={onOpenAsset ? () => onOpenAsset(m.assetId) : undefined}
          />
        )),
    });
  }

  if (result.optimizationRecommendations.length > 0) {
    sections.push({
      id: `${index}-opt`,
      title: t("precheck.sections.optimization"),
      count: result.optimizationRecommendations.length,
      render: () =>
        result.optimizationRecommendations.map((opt, i) => (
          <div key={`${opt.reasonCode}-${i}`} className="py-1.5 text-g-caption">
            <div className="flex items-start gap-1.5">
              <Badge
                tone={
                  opt.severity === "critical"
                    ? "danger"
                    : opt.severity === "warning"
                      ? "warning"
                      : "line"
                }
                className="mt-px shrink-0 text-[10px]"
              >
                {t(`severity.${opt.severity}`)}
              </Badge>
              <div className="min-w-0">
                <span className="text-g-ink-2">
                  {t(`precheck.optReason.${opt.reasonCode}`, {
                    defaultValue: opt.reason,
                  })}
                </span>
                <div className="mt-0.5 text-g-ink-4">
                  →{" "}
                  {t(`precheck.optSuggestion.${opt.suggestionCode}`, {
                    defaultValue: opt.suggestion,
                  })}
                </div>
              </div>
            </div>
          </div>
        )),
    });
  }

  if (result.namingIssues.length > 0) {
    sections.push({
      id: `${index}-naming`,
      title: t("precheck.sections.naming"),
      count: result.namingIssues.length,
      render: () =>
        result.namingIssues.map((n) => (
          <div key={n.code} className="py-1 text-g-caption text-g-ink-3">
            {t(`precheck.namingIssue.${n.code}`, {
              defaultValue: n.message,
            })}
          </div>
        )),
    });
  }

  return (
    <Card padding="none">
      <div className="p-3">
        <div className="flex gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-g-md bg-g-surface-3">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt={result.name}
                className="size-full object-contain"
                draggable={false}
              />
            ) : (
              <FileImage size={24} className="text-g-ink-4" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-g-mono text-g-body font-[510] text-g-ink">
                    {fileName(result.name)}
                  </span>
                  <Badge tone="line">{result.ext}</Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-g-mono text-g-chip text-g-ink-4">
                  <span>{formatBytes(result.size)}</span>
                  {result.image.width > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        {result.image.width} × {result.image.height}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Badge tone={badgeTone} className="shrink-0">
                <VerdictIcon size={10} />
                {t(`precheck.verdict.${result.verdict}`)}
              </Badge>
            </div>
            <p className="mt-1.5 text-g-caption text-g-ink-3">
              {t(verdictReasonKey(result), {
                defaultValue: result.verdictReason,
              })}
            </p>
          </div>
        </div>
      </div>

      {sections.length > 0 && (
        <div className="border-t border-dashed border-g-line">
          {sections.map((sec) => (
            <CollapsibleSection
              key={sec.id}
              id={sec.id}
              title={sec.title}
              count={sec.count}
              expanded={expanded.has(sec.id)}
              onToggle={onToggle}
            >
              {sec.render()}
            </CollapsibleSection>
          ))}
        </div>
      )}
    </Card>
  );
}

function CollapsibleSection({
  id,
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  expanded: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-dashed border-g-line last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-g-ink-4 transition-transform duration-150 ease-g motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="text-[10px] font-[590] uppercase tracking-[0.08em] text-g-ink-4">
          {title}
        </span>
        <Badge tone="line" className="text-[9px]">
          {count}
        </Badge>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-g motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MatchRow({
  assetId,
  repoPath,
  projectName,
  trailing,
  onClick,
}: {
  assetId?: string;
  repoPath: string;
  projectName: string;
  trailing?: string;
  onClick?: () => void;
}) {
  const base =
    "flex w-full items-center gap-2 rounded-g-sm bg-transparent py-1.5 px-1.5 text-left transition-colors duration-[120ms] ease-g";
  const interactive =
    "cursor-pointer hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus";

  const contents = (
    <>
      {assetId && (
        <AssetThumbnail
          src={`/api/thumbs/${assetId}`}
          size="sm"
          alt={repoPath}
        />
      )}
      <span className="min-w-16 text-g-chip text-g-ink-4">{projectName}</span>
      <span className="min-w-0 flex-1 truncate font-g-mono text-g-caption text-g-ink">
        {repoPath}
      </span>
      {trailing && (
        <span className="font-g-mono text-g-chip text-g-ink-4">{trailing}</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, interactive)}>
        {contents}
      </button>
    );
  }
  return <div className={base}>{contents}</div>;
}
