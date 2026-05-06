import {
  BarChart3,
  FileWarning,
  FolderKanban,
  FolderOpen,
  Recycle,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Project, Workspace } from "../types";
import type { Mode } from "../ui";
import { ProjectSwitcher } from "./ProjectSwitcher";

type Badges = {
  projects: number;
  total: number;
  duplicate: number;
  unused: number;
  optimize: number;
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
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelect: (mode: Mode) => void;
};

export function NavSidebar({
  mode,
  badges,
  workspaceName,
  workspaces,
  activeWorkspaceId,
  projects,
  selectedProjectId,
  totalAssets,
  onSelectWorkspace,
  onSelectProject,
  onSelect,
}: Props) {
  const { t } = useTranslation();

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
          id: "unused",
          label: t("nav.unused"),
          icon: <Trash2 size={18} />,
          badge: "unused",
          tone: "red",
        },
        {
          id: "optimize",
          label: t("nav.optimize"),
          icon: <Sparkles size={18} />,
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
    <aside className="sb relative z-30 flex flex-col overflow-visible border-r border-g-line bg-g-surface">
      <div className="sb-brand order-0 flex h-[60px] shrink-0 items-center gap-2.5 border-b border-g-line px-4 max-[960px]:justify-center max-[960px]:px-2 max-[960px]:py-4">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-g-md bg-g-canvas">
          <img
            className="block size-full origin-center scale-[1.22]"
            src="/brand/asset-studio-app-icon.png"
            alt=""
          />
        </div>
        <div>
          <div className="font-g-display text-[15px] font-[590] leading-[1.1] tracking-[-0.013em] text-g-ink max-[960px]:hidden">
            Asset Studio
          </div>
          <div className="mt-0.5 text-[10px] font-[510] uppercase tracking-[0.06em] text-g-ink-3 max-[960px]:hidden">
            {t("nav.brandTag")}
          </div>
        </div>
      </div>

      <div className="order-1 shrink-0 px-3.5 pt-3 pb-2 max-[960px]:hidden">
        <ProjectSwitcher
          workspaceName={workspaceName}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          projects={projects}
          selectedProjectId={selectedProjectId}
          totalAssets={totalAssets}
          onSelectWorkspace={onSelectWorkspace}
          onSelectProject={onSelectProject}
        />
      </div>

      <nav
        className="sb-nav order-2 flex-1 overflow-y-auto py-2"
        aria-label={t("nav.navigationAria")}
      >
        {groups.map((group) => (
          <div key={group.title}>
            <div className="px-5 pt-3 pb-1 text-[10px] font-[510] uppercase tracking-[0.06em] text-g-ink-3 max-[960px]:hidden">
              {group.title}
            </div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sb-link"
                data-active={mode === item.id}
                onClick={() => onSelect(item.id)}
              >
                {item.icon}
                <span className="sb-link-label min-w-0 flex-1 max-[960px]:hidden">
                  {item.label}
                </span>
                {item.badge == null ? null : (
                  <span className="sb-badge" data-tone={item.tone ?? "default"}>
                    {badges[item.badge]}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="order-3 flex items-center gap-2.5 border-t border-g-line p-3 text-[12px] text-g-ink-3 max-[960px]:justify-center">
        <BarChart3 size={16} />
        <span className="max-[960px]:hidden">{t("nav.footer")}</span>
      </div>
    </aside>
  );
}
