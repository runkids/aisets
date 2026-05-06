import { Check, ChevronDown, FolderKanban, Layers3 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "../types";

export type ProjectSwitcherProject = Project & {
  assetCount: number;
};

type Props = {
  workspaceName: string;
  projects: ProjectSwitcherProject[];
  selectedProjectId: string;
  totalAssets: number;
  onSelectProject: (projectId: string) => void;
};

function projectInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "A";
}

export function ProjectSwitcher({
  workspaceName,
  projects,
  selectedProjectId,
  totalAssets,
  onSelectProject,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const selectedName = selectedProject?.name ?? t("topbar.allProjects");
  const selectedAssetCount = selectedProject?.assetCount ?? totalAssets;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectProject(projectId: string) {
    onSelectProject(projectId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="project-switcher" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="project-switcher-trigger"
        aria-label={t("topbar.projectSwitcherAria")}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="project-switcher-icon" aria-hidden="true">
          <Layers3 size={15} />
        </span>
        <span className="project-switcher-copy">
          <span className="project-switcher-workspace-name">
            {workspaceName}
          </span>
          <span className="project-switcher-current">
            {selectedName}
            <span className="project-switcher-current-count">
              · {t("topbar.assetCount", { count: selectedAssetCount })}
            </span>
          </span>
        </span>
        <ChevronDown
          size={15}
          className="project-switcher-chevron"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="project-switcher-menu"
          id={menuId}
          role="menu"
          aria-label={t("topbar.projectSwitcherTitle")}
        >
          <div className="project-switcher-menu-head">
            <strong>{t("topbar.projectSwitcherTitle")}</strong>
            <span>{workspaceName}</span>
          </div>

          <div className="project-switcher-section-label">
            {t("topbar.workspaceSection")}
          </div>
          <div className="project-switcher-workspace-row">
            <span className="project-switcher-avatar" aria-hidden="true">
              {projectInitial(workspaceName)}
            </span>
            <span className="project-switcher-option-copy">
              <strong>{workspaceName}</strong>
              <span>{t("topbar.currentWorkspace")}</span>
            </span>
            <Check
              size={15}
              className="project-switcher-check"
              aria-hidden="true"
            />
          </div>

          <div className="project-switcher-section-label">
            {t("topbar.projectSection")}
          </div>
          <button
            type="button"
            className="project-switcher-option"
            role="menuitemradio"
            aria-checked={selectedProjectId === ""}
            data-active={selectedProjectId === "" || undefined}
            onClick={() => selectProject("")}
          >
            <Layers3 size={18} aria-hidden="true" />
            <span className="project-switcher-option-copy">
              <strong>{t("topbar.allProjects")}</strong>
              <span>{t("topbar.assetCount", { count: totalAssets })}</span>
            </span>
            <span className="project-switcher-count">{totalAssets}</span>
            <Check
              size={15}
              className="project-switcher-check"
              aria-hidden="true"
            />
          </button>

          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="project-switcher-option"
              role="menuitemradio"
              aria-checked={selectedProjectId === project.id}
              data-active={selectedProjectId === project.id || undefined}
              onClick={() => selectProject(project.id)}
            >
              <FolderKanban size={18} aria-hidden="true" />
              <span className="project-switcher-option-copy">
                <strong>{project.name}</strong>
                <span>{project.path}</span>
              </span>
              <span className="project-switcher-count">
                {project.assetCount}
              </span>
              <Check
                size={15}
                className="project-switcher-check"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
