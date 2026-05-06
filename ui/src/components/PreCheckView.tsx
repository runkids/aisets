import {
  AlertTriangle,
  CheckCircle2,
  FileImage,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fileName, formatBytes } from "../ui";
import { Badge, Button, Card, EmptyState, Notice } from "./ui";

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

const VERDICT_TONE: Record<
  Verdict,
  { icon: typeof CheckCircle2; color: string; labelKey: string }
> = {
  ok: {
    icon: CheckCircle2,
    color: "var(--g-green)",
    labelKey: "precheck.verdict.ok",
  },
  warning: {
    icon: AlertTriangle,
    color: "var(--g-amber)",
    labelKey: "precheck.verdict.warning",
  },
  duplicate: {
    icon: XCircle,
    color: "var(--g-red)",
    labelKey: "precheck.verdict.duplicate",
  },
};

export function PreCheckView({ onOpenAsset }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<PreCheckResult[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
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
        setResults(body.results ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorking(false);
      }
    },
    [t],
  );

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
    setResults([]);
    setError(null);
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    },
    { ok: 0, warning: 0, duplicate: 0 } as Record<Verdict, number>,
  );

  return (
    <div className="mx-auto max-w-[1600px] px-8 pb-6 pt-6 max-[768px]:px-4 max-[768px]:py-5">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="m-0 font-g-display text-[44px] font-bold leading-[1.05] tracking-[-0.035em] text-g-ink max-[768px]:text-[30px]">
            {t("precheck.title")}
          </h1>
          <p className="mt-2.5 max-w-[540px] text-[14px] text-g-ink-3">
            {t("precheck.sub")}
          </p>
        </div>
        {results.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge tone="line">
              {t("precheck.summary.ok", { count: summary.ok })}
            </Badge>
            <Badge tone="warning">
              {t("precheck.summary.warning", { count: summary.warning })}
            </Badge>
            <Badge tone="danger">
              {t("precheck.summary.duplicate", { count: summary.duplicate })}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<X size={12} />}
              onClick={clearResults}
            >
              {t("action.clear")}
            </Button>
          </div>
        )}
      </div>

      <div
        className="mb-4 cursor-pointer rounded-g-lg border-2 border-dashed border-g-line-strong bg-g-surface px-8 py-[60px] text-center transition-all duration-200 ease-g hover:border-g-accent hover:bg-[color-mix(in_srgb,var(--g-accent-soft)_50%,var(--g-surface))]"
        data-active={dragOver || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={onPick}
      >
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-g-surface-2 text-g-ink-3">
          <Upload size={24} />
        </div>
        <div className="text-g-body font-[510] text-g-ink">
          {working ? t("precheck.uploading") : t("precheck.dropPrompt")}
        </div>
        <div className="mt-1 text-g-caption text-g-ink-4">
          {t("precheck.supportedFormats")}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.svg"
          style={{ display: "none" }}
          onChange={onChange}
        />
      </div>

      {error && (
        <Notice tone="danger" className="mb-4" title={t("error.upload")}>
          {error}
        </Notice>
      )}

      {results.length === 0 ? (
        <EmptyState
          icon={<FileImage size={32} />}
          title={t("precheck.emptyTitle")}
          description={t("precheck.emptySub")}
        />
      ) : (
        <div className="grid gap-3">
          {results.map((r, idx) => (
            <PreCheckCard
              key={`${r.contentHash}-${idx}`}
              result={r}
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
  onOpenAsset,
}: {
  result: PreCheckResult;
  onOpenAsset?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tone = VERDICT_TONE[result.verdict];
  const Icon = tone.icon;
  return (
    <Card padding="md">
      <div className="flex items-start gap-3">
        <div className="shrink-0" style={{ color: tone.color }}>
          <Icon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="font-g-mono text-g-body">
              {fileName(result.name)}
            </strong>
            <Badge tone="line">{result.ext}</Badge>
            <span className="font-g-mono text-g-caption text-g-ink-4">
              {formatBytes(result.size)}
            </span>
            {result.image.width > 0 && (
              <span className="font-g-mono text-g-caption text-g-ink-4">
                {result.image.width}×{result.image.height}
              </span>
            )}
            <span
              className="ml-auto text-g-chip font-[590] uppercase tracking-[0.06em]"
              style={{ color: tone.color }}
            >
              {t(tone.labelKey)}
            </span>
          </div>
          <p className="mb-3 mt-1 text-g-ui text-g-ink-2">
            {result.verdictReason}
          </p>

          {result.exactMatches.length > 0 && (
            <Section title={t("precheck.sections.exactMatches")}>
              {result.exactMatches.map((m) => (
                <MatchRow
                  key={m.assetId}
                  repoPath={m.repoPath}
                  projectName={m.projectName}
                  onClick={
                    onOpenAsset ? () => onOpenAsset(m.assetId) : undefined
                  }
                />
              ))}
            </Section>
          )}

          {result.nearMatches.length > 0 && (
            <Section title={t("precheck.sections.nearMatches")}>
              {result.nearMatches.map((m) => (
                <MatchRow
                  key={m.assetId}
                  repoPath={m.repoPath}
                  projectName={m.projectName}
                  trailing={
                    m.flipped
                      ? t("precheck.nearDistanceFlipped", {
                          distance: m.distance,
                        })
                      : t("precheck.nearDistance", { distance: m.distance })
                  }
                  onClick={
                    onOpenAsset ? () => onOpenAsset(m.assetId) : undefined
                  }
                />
              ))}
            </Section>
          )}

          {result.optimizationRecommendations.length > 0 && (
            <Section title={t("precheck.sections.optimization")}>
              {result.optimizationRecommendations.map((opt, i) => (
                <div
                  key={`${opt.reasonCode}-${i}`}
                  className="border-b border-dashed border-g-line py-1.5 text-g-caption"
                >
                  <Badge
                    tone={
                      opt.severity === "critical"
                        ? "danger"
                        : opt.severity === "warning"
                          ? "warning"
                          : "line"
                    }
                    className="mr-1.5 text-[10px]"
                  >
                    {t(`severity.${opt.severity}`)}
                  </Badge>
                  <span className="text-g-ink-2">{opt.reason}</span>
                  <div className="ml-1 text-g-ink-4">→ {opt.suggestion}</div>
                </div>
              ))}
            </Section>
          )}

          {result.namingIssues.length > 0 && (
            <Section title={t("precheck.sections.naming")}>
              {result.namingIssues.map((n) => (
                <div key={n.code} className="py-1 text-g-caption text-g-ink-3">
                  {n.message}
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-[590] uppercase tracking-[0.08em] text-g-ink-4">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function MatchRow({
  repoPath,
  projectName,
  trailing,
  onClick,
}: {
  repoPath: string;
  projectName: string;
  trailing?: string;
  onClick?: () => void;
}) {
  const rowClassName =
    "flex w-full items-center gap-2 border-b border-dashed border-g-line bg-transparent py-1.5 text-left";
  const contents = (
    <>
      <span className="min-w-20 text-g-chip text-g-ink-4">{projectName}</span>
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
      <button
        type="button"
        onClick={onClick}
        className={`${rowClassName} cursor-pointer focus-visible:outline-none focus-visible:shadow-g-focus`}
      >
        {contents}
      </button>
    );
  }
  return <div className={rowClassName}>{contents}</div>;
}
