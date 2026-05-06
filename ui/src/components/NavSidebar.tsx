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
import type { Project } from "../types";
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
  projects: ProjectSwitcherProject[];
  selectedProjectId: string;
  totalAssets: number;
  onSelectProject: (projectId: string) => void;
  onSelect: (mode: Mode) => void;
};

export function NavSidebar({
  mode,
  badges,
  workspaceName,
  projects,
  selectedProjectId,
  totalAssets,
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
    <aside className="sb">
      <div className="sb-brand">
        <div className="sb-brand-mark">
          <img
            className="sb-brand-img"
            src="/brand/asset-studio-app-icon.png"
            alt=""
          />
        </div>
        <div>
          <div className="sb-brand-name">Asset Studio</div>
          <div className="sb-brand-tag">{t("nav.brandTag")}</div>
        </div>
      </div>

      <div className="sb-project-switcher">
        <ProjectSwitcher
          workspaceName={workspaceName}
          projects={projects}
          selectedProjectId={selectedProjectId}
          totalAssets={totalAssets}
          onSelectProject={onSelectProject}
        />
      </div>

      <nav className="sb-nav" aria-label={t("nav.navigationAria")}>
        {groups.map((group) => (
          <div key={group.title} className="sb-group">
            <div className="sb-section">{group.title}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sb-link"
                data-active={mode === item.id}
                onClick={() => onSelect(item.id)}
              >
                {item.icon}
                <span className="sb-link-label">{item.label}</span>
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

      <div className="sb-footer">
        <BarChart3 size={16} />
        <span>{t("nav.footer")}</span>
      </div>
    </aside>
  );
}
