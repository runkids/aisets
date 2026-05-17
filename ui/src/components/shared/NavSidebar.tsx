import {
  ArrowUp,
  ChevronRight,
  FileWarning,
  FolderKanban,
  FolderOpen,
  Frame,
  Gauge,
  History,
  Images,
  MessageSquareCode,
  Recycle,
  Settings,
  ShieldCheck,
  Tags,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Project, Workspace } from "../../types";
import type { Mode } from "../../ui";
import { ProjectSwitcher } from "../project/ProjectSwitcher";

type Badges = {
  projects: number;
  total: number;
  duplicate: number;
  unused: number;
  optimize: number;
  imageTools: number;
  lint: number;
};

type ProjectSwitcherProject = Project & {
  assetCount: number;
};

type Props = {
  mode: Mode;
  badges: Badges;
  workspaceName: string;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: ProjectSwitcherProject[];
  selectedProjectId: string;
  totalAssets: number;
  lastScanAt?: string;
  lastScanStartedAt?: string;
  currentVersion?: string;
  updateAvailable?: boolean;
  latestVersion?: string;
  workspaceSwitchDisabled?: boolean;
  workspaceSwitchDisabledTooltip?: string;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelect: (mode: Mode) => void;
};

function formatLastScanTime(value: string | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatScanDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
) {
  if (!startedAt || !completedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  const sec = Math.round((end - start) / 1000);
  if (sec < 1) return "<1s";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m${rem}s` : `${min}m`;
}

export function NavSidebar({
  mode,
  badges,
  workspaceName,
  workspaces,
  activeWorkspaceId,
  projects,
  selectedProjectId,
  totalAssets,
  lastScanAt,
  lastScanStartedAt,
  currentVersion,
  updateAvailable = false,
  latestVersion,
  workspaceSwitchDisabled = false,
  workspaceSwitchDisabledTooltip,
  onSelectWorkspace,
  onSelectProject,
  onSelect,
}: Props) {
  const { t, i18n } = useTranslation();
  const lastScan = formatLastScanTime(lastScanAt, i18n.language);
  const scanDuration = formatScanDuration(lastScanStartedAt, lastScanAt);

  const groups: Array<{
    title: string;
    items: Array<{
      id: Mode;
      label: string;
      icon: React.ReactNode;
      badge?: keyof Badges;
      tone?: string;
    }>;
  }> = [
    {
      title: t("nav.workspace"),
      items: [
        {
          id: "projects",
          label: t("nav.projects"),
          icon: <FolderKanban size={18} />,
          badge: "projects",
        },
        {
          id: "browse",
          label: t("nav.browse"),
          icon: <FolderOpen size={18} />,
          badge: "total",
        },
        {
          id: "history",
          label: t("nav.history"),
          icon: <History size={18} />,
        },
        {
          id: "tags",
          label: t("nav.tags"),
          icon: <Tags size={18} />,
        },
      ],
    },
    {
      title: t("nav.cleanup"),
      items: [
        {
          id: "duplicates",
          label: t("nav.duplicates"),
          icon: <Recycle size={18} />,
          badge: "duplicate",
          tone: "amber",
        },
        {
          id: "optimize",
          label: t("nav.optimize"),
          icon: <Gauge size={18} />,
          badge: "optimize",
          tone: "blue",
        },
        {
          id: "lint",
          label: t("nav.lint"),
          icon: <FileWarning size={18} />,
          badge: "lint",
          tone: "purple",
        },
      ],
    },
    {
      title: t("nav.tools"),
      items: [
        {
          id: "precheck",
          label: t("nav.precheck"),
          icon: <ShieldCheck size={18} />,
        },
        {
          id: "imageTools",
          label: t("nav.imageTools"),
          icon: <Images size={18} />,
          badge: "imageTools",
          tone: "blue",
        },
        {
          id: "aiCanvas",
          label: t("nav.aiCanvas"),
          icon: <Frame size={18} />,
        },
        {
          id: "prompts",
          label: t("nav.prompts"),
          icon: <MessageSquareCode size={18} />,
        },
      ],
    },
    {
      title: t("nav.system"),
      items: [
        {
          id: "settings",
          label: t("nav.settings"),
          icon: <Settings size={18} />,
        },
      ],
    },
  ];

  return (
    <aside className="relative z-30 flex min-h-0 flex-col overflow-hidden bg-transparent pl-3 pr-0 pb-3">
      <div className="order-1 shrink-0 pt-3 pb-1 max-[960px]:hidden">
        <ProjectSwitcher
          workspaceName={workspaceName}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          projects={projects}
          selectedProjectId={selectedProjectId}
          totalAssets={totalAssets}
          workspaceSwitchDisabled={workspaceSwitchDisabled}
          workspaceSwitchDisabledTooltip={workspaceSwitchDisabledTooltip}
          onSelectWorkspace={onSelectWorkspace}
          onSelectProject={onSelectProject}
        />
      </div>

      <nav
        className="order-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto py-1"
        aria-label={t("nav.navigationAria")}
      >
        {groups.map((group) => (
          <div
            key={group.title}
            className="rounded-g-md border border-g-line bg-g-surface p-1 shadow-g-sm"
          >
            <div className="px-2 pt-1 pb-2 text-[10px] font-[510] uppercase tracking-[0.06em] text-g-ink-3 max-[960px]:hidden">
              {group.title}
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="group flex min-h-[36px] w-full items-center gap-2 rounded-g-md px-2 py-1.5 text-left text-[13px] font-medium tracking-[-0.012em] text-g-ink-3 transition-[background,color] duration-[120ms] ease-g [&_svg]:size-4 [&_svg]:shrink-0 hover:not-data-[active=true]:bg-[color-mix(in_srgb,var(--g-surface-2)_84%,transparent)] hover:not-data-[active=true]:text-g-ink-2 [[data-theme=dark]_&]:hover:not-data-[active=true]:bg-g-surface-3 [[data-theme=dark]_&]:hover:not-data-[active=true]:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus data-[active=true]:bg-g-active-bg data-[active=true]:text-g-active-text data-[active=true]:font-[var(--g-active-weight)] max-[960px]:justify-center"
                  data-active={mode === item.id}
                  data-image-tools-basket-target={
                    item.id === "imageTools" ? "true" : undefined
                  }
                  aria-label={item.label}
                  onClick={() => onSelect(item.id)}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 max-[960px]:hidden">
                    {item.label}
                  </span>
                  {item.badge == null || badges[item.badge] <= 0 ? null : (
                    <span
                      className="min-w-[28px] text-center text-[11px] font-g-mono bg-g-surface-2 text-g-ink-3 px-1.5 py-0.5 rounded-g-sm font-[510] tracking-[-0.015em] tabular-nums data-[tone=red]:bg-g-red-soft data-[tone=red]:text-g-red data-[tone=amber]:bg-g-amber-soft data-[tone=amber]:text-g-amber data-[tone=blue]:bg-g-blue-soft data-[tone=blue]:text-g-blue data-[tone=green]:bg-g-green-soft data-[tone=green]:text-g-green data-[tone=purple]:bg-g-purple-soft data-[tone=purple]:text-g-purple group-hover:not-group-data-[active=true]:bg-g-surface group-hover:not-group-data-[active=true]:text-g-ink-2 group-data-[active=true]:bg-g-surface group-data-[active=true]:text-g-ink-3 [[data-theme=dark]_&]:group-data-[active=true]:bg-[rgba(8,9,10,0.18)] [[data-theme=dark]_&]:group-data-[active=true]:text-g-accent-ink max-[960px]:hidden"
                      data-tone={item.tone ?? "default"}
                    >
                      {badges[item.badge]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="order-3 flex shrink-0 flex-col rounded-g-md border border-g-line bg-g-surface shadow-g-sm max-[960px]:items-center">
        {updateAvailable && latestVersion && (
          <>
            <button
              type="button"
              className="group/upd flex w-full items-center gap-1.5 rounded-t-g-md px-3 py-1.5 text-g-chip transition-colors bg-g-green-soft/60 hover:bg-g-green-soft max-[960px]:justify-center max-[960px]:px-2"
              onClick={() => onSelect("settings")}
              aria-label={t("nav.updateAvailableAria", {
                version: latestVersion,
              })}
            >
              <ArrowUp size={12} className="shrink-0 text-g-green" />
              <span className="flex min-w-0 flex-1 items-center gap-1 max-[960px]:hidden">
                <span className="font-g-mono tabular-nums text-g-ink-4">
                  {currentVersion}
                </span>
                <span className="text-g-ink-4">→</span>
                <span className="truncate font-g-mono tabular-nums font-[510] text-g-green">
                  {latestVersion}
                </span>
              </span>
              <ChevronRight
                size={12}
                className="shrink-0 text-g-ink-4 transition-transform group-hover/upd:translate-x-0.5 max-[960px]:hidden"
              />
            </button>
            <div className="border-t border-g-line" />
          </>
        )}
        <div className="flex flex-col gap-0.5 px-3 py-2 text-g-chip text-g-ink-4 max-[960px]:hidden">
          <span>{t("nav.lastScan")}</span>
          <div className="flex items-center gap-1.5">
            <span className="truncate font-g-mono tabular-nums text-g-ink-3">
              {lastScan}
            </span>
            {scanDuration && (
              <span className="shrink-0 font-g-mono tabular-nums text-g-ink-4">
                ({scanDuration})
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
