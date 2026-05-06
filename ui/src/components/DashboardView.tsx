import {
  Boxes,
  Copy,
  FileImage,
  HardDrive,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Catalog } from "../types";
import { duplicateSavings, fileName, formatBytes } from "../ui";
import type { Mode } from "../ui";
import { Badge, Card, CardBody, EmptyState, StatCard } from "./ui";

type Props = {
  catalog: Catalog;
  onJump: (mode: Mode) => void;
};

export function DashboardView({ catalog, onJump }: Props) {
  const { t } = useTranslation();
  const items = catalog.items ?? [];
  const projects = catalog.projects ?? [];
  const optimizeCount = items.filter(
    (item) => item.optimizationRecommendations.length > 0,
  ).length;
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const savings = duplicateSavings(catalog);

  const formatBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; bytes: number }>();
    for (const item of items) {
      const key = item.ext || t("common.none");
      const cur = map.get(key) ?? { count: 0, bytes: 0 };
      cur.count++;
      cur.bytes += item.bytes;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([ext, v]) => ({ ext, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 6);
  }, [items, t]);

  const topLargest = useMemo(
    () => [...items].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
    [items],
  );

  const lintBreakdown = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const f of catalog.lintFindings ?? []) {
      counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    }
    return counts;
  }, [catalog.lintFindings]);

  const maxFormatBytes = formatBreakdown.reduce(
    (m, f) => Math.max(m, f.bytes),
    0,
  );

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto w-full">
      <section className="grid grid-cols-4 gap-4 max-[960px]:grid-cols-2 max-[480px]:grid-cols-1">
        <StatCard
          label={t("dashboard.totalAssets")}
          value={catalog.stats.totalFiles}
          meta={formatBytes(totalBytes)}
          icon={<Boxes size={18} />}
          onClick={() => onJump("browse")}
        />
        <StatCard
          label={t("dashboard.duplicateGroups")}
          value={catalog.stats.duplicateGroups}
          meta={t("dashboard.savingsMeta", { size: formatBytes(savings) })}
          icon={<Copy size={18} />}
          onClick={() => onJump("duplicates")}
        />
        <StatCard
          label={t("dashboard.unused")}
          value={catalog.stats.unusedFiles}
          meta={t("dashboard.unusedMeta")}
          icon={<Trash2 size={18} />}
          onClick={() => onJump("unused")}
        />
        <StatCard
          label={t("dashboard.optimizable")}
          value={optimizeCount}
          meta={t("dashboard.optimizeMeta")}
          icon={<Sparkles size={18} />}
          onClick={() => onJump("optimize")}
        />
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
        <Card>
          <CardBody padding="md">
            <div className="mb-4 flex items-center gap-2">
              <FileImage size={18} />
              <h2 className="text-lg font-extrabold">
                {t("dashboard.byFormat")}
              </h2>
            </div>
            {formatBreakdown.length === 0 ? (
              <EmptyState title={t("dashboard.noAssets")} size="sm" />
            ) : (
              <div className="grid gap-2">
                {formatBreakdown.map((f) => {
                  const pct =
                    maxFormatBytes > 0 ? (f.bytes / maxFormatBytes) * 100 : 0;
                  return (
                    <div key={f.ext}>
                      <div className="flex items-baseline gap-2 text-g-caption">
                        <Badge tone="line" className="text-[10px]">
                          {f.ext}
                        </Badge>
                        <span className="font-g-mono text-g-ink-3">
                          {f.count}
                        </span>
                        <span className="ml-auto font-g-mono text-g-ink-4">
                          {formatBytes(f.bytes)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-g-pill bg-g-surface-2">
                        <div
                          className="h-full rounded-g-pill bg-g-accent transition-[width] duration-200 ease-g"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody padding="md">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles size={18} />
              <h2 className="text-lg font-extrabold">
                {t("dashboard.topLargest")}
              </h2>
            </div>
            {topLargest.length === 0 ? (
              <EmptyState title={t("dashboard.noAssets")} size="sm" />
            ) : (
              <div className="grid gap-1">
                {topLargest.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onJump("browse")}
                    className="flex items-center gap-2 rounded-g-sm border border-g-line bg-transparent px-2.5 py-2 text-left transition-[background,border-color,box-shadow] duration-[120ms] ease-g hover:border-g-line-strong hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus"
                  >
                    <span className="min-w-0 flex-1 truncate font-g-mono text-g-caption text-g-ink">
                      {fileName(item.repoPath)}
                    </span>
                    <span className="text-g-chip text-g-ink-4">
                      {item.projectName}
                    </span>
                    <Badge tone="line" className="text-[10px]">
                      {item.ext}
                    </Badge>
                    <span className="font-g-mono text-g-caption font-[510] text-g-ink-2">
                      {formatBytes(item.bytes)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {(catalog.stats.lintFindings ?? 0) > 0 && (
          <Card>
            <CardBody padding="md">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-lg font-extrabold">
                  {t("dashboard.lintHealth")}
                </h2>
              </div>
              <div className="grid gap-1.5">
                {(["critical", "warning", "info"] as const).map((sev) => {
                  const total = catalog.stats.lintFindings ?? 0;
                  const count = lintBreakdown[sev];
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const toneClassName =
                    sev === "critical"
                      ? "[--sev:var(--g-red)]"
                      : sev === "warning"
                        ? "[--sev:var(--g-amber)]"
                        : "[--sev:var(--g-info)]";
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => onJump("lint")}
                      className="rounded-g-sm bg-transparent p-1 text-left transition-colors duration-[120ms] ease-g hover:bg-g-surface-2 focus-visible:outline-none focus-visible:shadow-g-focus"
                    >
                      <div className="flex items-baseline gap-2 text-g-caption">
                        <span
                          className={`font-[590] uppercase tracking-[0.04em] text-[var(--sev)] ${toneClassName}`}
                        >
                          {t(`severity.${sev}`)}
                        </span>
                        <span className="ml-auto font-g-mono text-g-ink-3">
                          {count}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-g-pill bg-g-surface-2">
                        <div
                          className={`h-full bg-[var(--sev)] ${toneClassName}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        )}
      </section>

      <Card>
        <CardBody padding="md">
          <div className="mb-4 flex items-center gap-2">
            <HardDrive size={18} />
            <h2 className="text-lg font-extrabold">
              {t("dashboard.projects")}
            </h2>
          </div>
          {projects.length === 0 ? (
            <EmptyState
              title={t("dashboard.noProjects")}
              description={t("dashboard.noProjectsDesc")}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {projects.map((project) => (
                <Card key={project.id} padding="md">
                  <div className="font-extrabold">{project.name}</div>
                  <code className="mt-1 block truncate text-xs text-(--g-ink-4)">
                    {project.path}
                  </code>
                </Card>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
