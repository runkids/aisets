import { Check, ChevronDown, Layers3 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Project, Workspace } from "../types";
import { ProjectAvatar } from "./ProjectAvatar";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import { cn } from "@/lib/cn";

export type ProjectSwitcherProject = Project & {
  assetCount: number;
};

type Props = {
  workspaceName: string;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: ProjectSwitcherProject[];
  selectedProjectId: string;
  totalAssets: number;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectProject: (projectId: string) => void;
};

/* ── Tailwind class blocks ─────────────────────────────────────────── */

const rootClass =
  "relative w-full min-w-0 shrink-0 max-[900px]:min-w-[190px] max-[900px]:w-[24vw] max-[720px]:min-w-[44px] max-[720px]:w-[44px] max-[720px]:shrink-0";

const triggerClass = cn(
  "relative flex w-full items-center gap-2 min-h-[44px] px-2.5 border border-g-line rounded-g-md bg-g-surface text-g-ink text-left shadow-g-sm",
  "transition-[background,border-color,box-shadow,transform] duration-[120ms] ease-g",
  "before:absolute before:inset-[-4px] before:content-['']",
  "hover:bg-g-surface-2 hover:border-g-line-strong",
  "aria-expanded:bg-g-surface-2 aria-expanded:border-g-line-strong",
  "focus-visible:outline-none focus-visible:shadow-g-focus",
  "active:scale-[0.99] motion-reduce:active:scale-100",
  "max-[720px]:justify-center max-[720px]:p-0",
);

const triggerIconClass =
  "inline-flex items-center justify-center size-6 rounded-g-md bg-g-surface-3 text-g-ink-2 shrink-0";

const triggerCopyClass =
  "flex min-w-0 flex-1 flex-col gap-px max-[720px]:hidden";

const triggerWorkspaceNameClass =
  "overflow-hidden text-ellipsis text-g-ink-3 text-[10px] font-[510] tracking-[0.06em] leading-[1.1] uppercase";

const triggerCurrentClass =
  "overflow-hidden text-ellipsis text-g-ink text-[13px] font-[510] tracking-[-0.012em] leading-[1.2] whitespace-nowrap";

const triggerCurrentCountClass =
  "text-g-ink-4 font-g-mono text-[11px] font-normal tracking-g-mono max-[900px]:hidden";

const triggerChevronClass = cn(
  "text-g-ink-4 shrink-0 transition-transform duration-[120ms] ease-g",
  "max-[720px]:hidden",
);

const menuClass = cn(
  "absolute top-[calc(100%+8px)] left-0 z-[60] w-full max-h-[min(480px,calc(100vh-88px))]",
  "overflow-y-auto p-1.5 border border-g-line-strong rounded-g-lg bg-g-surface-2 shadow-g-pop",
  "max-[720px]:left-auto max-[720px]:right-0 max-[720px]:w-[min(320px,calc(100vw-32px))]",
);

const menuHeadClass =
  "flex flex-col gap-0.5 px-2.5 pt-1.5 pb-2 border-b border-g-line bg-g-surface-2";

const menuHeadTitleClass =
  "text-g-ink font-g-display text-[13px] font-[510] tracking-[-0.011em] leading-[1.3]";

const menuHeadSubClass = "text-g-ink-4 text-[11px]";

const sectionLabelClass =
  "px-2.5 pt-3 pb-1.5 text-g-ink-3 text-[10px] font-[510] tracking-[0.06em] leading-[1.4] uppercase";

const optionClass = cn(
  "relative my-0.5 flex w-full items-center gap-2.5 min-h-[40px] px-2.5 py-2 rounded-g-md text-g-ink-2 text-left",
  "transition-[background,color,box-shadow] duration-[120ms] ease-g",
  "hover:not-data-active:bg-g-surface-3 hover:not-data-active:text-g-ink",
  "focus-visible:not-data-active:bg-g-surface-3 focus-visible:not-data-active:text-g-ink",
  "data-active:bg-g-surface-3 data-active:text-g-ink data-active:font-[510]",
  "focus-visible:outline-none focus-visible:shadow-g-focus",
  "[&_svg]:shrink-0",
);

const workspaceOptionActiveOverride = "";

const avatarClass =
  "inline-grid place-items-center size-7 rounded-g-md bg-g-surface-3 text-g-ink font-g-display text-[13px] font-[590] shrink-0";

const optionCopyClass = "flex min-w-0 flex-1 flex-col gap-0.5 text-left";

const optionCopyStrongClass =
  "overflow-hidden text-ellipsis text-g-ink text-[13px] font-[510] tracking-[-0.012em] leading-[1.2] whitespace-nowrap";

const optionCopySpanClass =
  "overflow-hidden text-ellipsis text-g-ink-3 font-g-mono text-[11px] tracking-g-mono leading-[1.3] whitespace-nowrap";

const optionCopyActiveOverride = "";

const countClass = cn(
  "min-w-[34px] px-[7px] py-0.5 rounded-g-sm bg-g-surface-3 text-g-ink-3",
  "font-g-mono text-[11px] font-[510] tracking-g-mono text-center tabular-nums",
);

const countActiveClass = "data-active:[&_.ps-count]:bg-g-surface";

const hoverCountClass =
  "hover:not-data-active:[&_.ps-count]:bg-g-surface hover:not-data-active:[&_.ps-count]:text-g-ink-2 focus-visible:not-data-active:[&_.ps-count]:bg-g-surface focus-visible:not-data-active:[&_.ps-count]:text-g-ink-2";

const checkClass =
  "opacity-0 text-g-accent transition-opacity duration-[120ms] ease-g";

const checkVisibleClass = "opacity-100";

/* ─────────────────────────────────────────────────────────────────── */

export function ProjectSwitcher({
  workspaceName,
  workspaces,
  activeWorkspaceId,
  projects,
  selectedProjectId,
  totalAssets,
  onSelectWorkspace,
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

  function selectWorkspace(workspaceId: string) {
    onSelectWorkspace(workspaceId);
  }

  function selectProject(projectId: string) {
    onSelectProject(projectId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className={rootClass} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-label={t("topbar.projectSwitcherAria")}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {selectedProject ? (
          <ProjectAvatar
            iconImage={selectedProject.iconImage}
            className={cn(triggerIconClass, "[&_svg]:size-[15px]")}
          />
        ) : (
          <span className={triggerIconClass} aria-hidden="true">
            <Layers3 size={15} />
          </span>
        )}
        <span className={triggerCopyClass}>
          <span className={triggerWorkspaceNameClass}>{workspaceName}</span>
          <span className={triggerCurrentClass}>
            {selectedName}
            <span className={triggerCurrentCountClass}>
              · {t("topbar.assetCount", { count: selectedAssetCount })}
            </span>
          </span>
        </span>
        <ChevronDown
          size={15}
          className={cn(triggerChevronClass, open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className={menuClass}
          id={menuId}
          role="menu"
          aria-label={t("topbar.projectSwitcherTitle")}
        >
          <div className={menuHeadClass}>
            <strong className={menuHeadTitleClass}>
              {t("topbar.projectSwitcherTitle")}
            </strong>
            <span className={menuHeadSubClass}>{workspaceName}</span>
          </div>

          <div className={sectionLabelClass}>
            {t("topbar.workspaceSection")}
          </div>
          {workspaces.map((workspace) => {
            const isActive = activeWorkspaceId === workspace.id;
            return (
              <button
                key={workspace.id}
                type="button"
                className={cn(optionClass, workspaceOptionActiveOverride)}
                data-kind="workspace"
                role="menuitemradio"
                aria-checked={isActive}
                data-active={isActive || undefined}
                onClick={() => selectWorkspace(workspace.id)}
              >
                <WorkspaceAvatar
                  name={workspace.name}
                  iconImage={workspace.iconImage}
                  className={avatarClass}
                />
                <span className={cn(optionCopyClass, optionCopyActiveOverride)}>
                  <strong className={optionCopyStrongClass}>
                    {workspace.name}
                  </strong>
                  <span className={optionCopySpanClass}>
                    {isActive
                      ? t("topbar.currentWorkspace")
                      : t("topbar.projectCount", {
                          count: workspace.projectCount,
                        })}
                  </span>
                </span>
                <Check
                  size={15}
                  className={cn(checkClass, isActive && checkVisibleClass)}
                  aria-hidden="true"
                />
              </button>
            );
          })}

          <div className={sectionLabelClass}>{t("topbar.projectSection")}</div>
          <button
            type="button"
            className={cn(
              optionClass,
              countActiveClass,
              hoverCountClass,
              optionCopyActiveOverride,
            )}
            role="menuitemradio"
            aria-checked={selectedProjectId === ""}
            data-active={selectedProjectId === "" || undefined}
            onClick={() => selectProject("")}
          >
            <Layers3 size={18} aria-hidden="true" />
            <span className={optionCopyClass}>
              <strong className={optionCopyStrongClass}>
                {t("topbar.allProjects")}
              </strong>
              <span className={optionCopySpanClass}>
                {t("topbar.assetCount", { count: totalAssets })}
              </span>
            </span>
            <span className={cn("ps-count", countClass)}>{totalAssets}</span>
            <Check
              size={15}
              className={cn(
                checkClass,
                selectedProjectId === "" && checkVisibleClass,
              )}
              aria-hidden="true"
            />
          </button>

          {projects.map((project) => {
            const isSelected = selectedProjectId === project.id;
            return (
              <button
                key={project.id}
                type="button"
                className={cn(
                  optionClass,
                  countActiveClass,
                  hoverCountClass,
                  optionCopyActiveOverride,
                )}
                role="menuitemradio"
                aria-checked={isSelected}
                data-active={isSelected || undefined}
                onClick={() => selectProject(project.id)}
              >
                <ProjectAvatar
                  iconImage={project.iconImage}
                  className={cn(avatarClass, "[&_svg]:size-[18px]")}
                />
                <span className={optionCopyClass}>
                  <strong className={optionCopyStrongClass}>
                    {project.name}
                  </strong>
                  <span className={optionCopySpanClass}>{project.path}</span>
                </span>
                <span className={cn("ps-count", countClass)}>
                  {project.assetCount}
                </span>
                <Check
                  size={15}
                  className={cn(checkClass, isSelected && checkVisibleClass)}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
