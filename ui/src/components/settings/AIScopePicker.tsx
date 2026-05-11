import { Check, ChevronDown, Layers3 } from "lucide-react";
import { useEffect, useId, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { ProjectAvatar } from "../project/ProjectAvatar";
import { WorkspaceAvatar } from "../project/WorkspaceAvatar";

export type ScopeProject = {
  id: string;
  name: string;
  path: string;
  workspaceId: string;
  iconImage?: string;
  assetCount: number;
};

type AIScopePickerProps = {
  workspaces: Array<{ id: string; name: string; iconImage?: string }>;
  projects: ScopeProject[];
  selectedWorkspaceId: string;
  selectedProjectId: string;
  disabled?: boolean;
  onChangeWorkspace: (workspaceId: string) => void;
  onChangeProject: (projectId: string) => void;
};

const triggerClass = cn(
  "flex w-full items-center gap-2 h-g-btn-md px-3 rounded-g-md bg-g-surface text-g-ink text-left",
  "border border-g-line shadow-g-inset",
  "transition-[background,border-color,box-shadow] duration-[120ms] ease-g",
  "hover:border-g-input-hover hover:bg-g-input-hover-bg",
  "aria-expanded:border-g-input-hover aria-expanded:bg-g-input-hover-bg",
  "focus-visible:outline-none focus-visible:shadow-g-focus",
  "disabled:cursor-not-allowed disabled:opacity-[0.38]",
);

const menuClass = cn(
  "fixed z-[60] max-h-[min(420px,calc(100vh-88px))]",
  "overflow-y-auto p-1.5 border border-g-line-strong rounded-g-lg bg-g-surface-2 shadow-g-pop",
);

const sectionLabelClass =
  "px-2.5 pt-3 pb-1.5 text-g-ink-3 text-[10px] font-[510] tracking-[0.06em] leading-[1.4] uppercase";

const optionClass = cn(
  "relative my-0.5 flex w-full items-center gap-2.5 min-h-[40px] px-2.5 py-2 rounded-g-md text-g-ink-2 text-left",
  "transition-[background,color,box-shadow] duration-[120ms] ease-g",
  "hover:not-data-active:bg-g-surface-3 hover:not-data-active:text-g-ink",
  "data-active:bg-g-surface-3 data-active:text-g-ink data-active:font-[510]",
  "focus-visible:outline-none focus-visible:shadow-g-focus",
  "[&_svg]:shrink-0",
);

const avatarClass =
  "inline-grid place-items-center size-7 rounded-g-md bg-g-surface-3 text-g-ink font-g-display text-[13px] font-[590] shrink-0";

const copyClass = "flex min-w-0 flex-1 flex-col gap-0.5 text-left";

const nameClass =
  "overflow-hidden text-ellipsis text-g-ink text-[13px] font-[510] tracking-[-0.012em] leading-[1.2] whitespace-nowrap";

const subClass =
  "overflow-hidden text-ellipsis text-g-ink-3 font-g-mono text-[11px] tracking-g-mono leading-[1.3] whitespace-nowrap";

const countClass = cn(
  "min-w-[34px] px-[7px] py-0.5 rounded-g-sm bg-g-surface-3 text-g-ink-3",
  "font-g-mono text-[11px] font-[510] tracking-g-mono text-center tabular-nums",
);

const checkClass =
  "opacity-0 text-g-accent transition-opacity duration-[120ms] ease-g";

const checkVisibleClass = "opacity-100";

export function AIScopePicker({
  workspaces,
  projects,
  selectedWorkspaceId,
  selectedProjectId,
  disabled = false,
  onChangeWorkspace,
  onChangeProject,
}: AIScopePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  }>({
    top: 0,
    left: 0,
    width: 320,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const activeWs = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedProj = projects.find((p) => p.id === selectedProjectId);
  const filteredProjects = selectedWorkspaceId
    ? projects.filter((p) => p.workspaceId === selectedWorkspaceId)
    : projects;
  const totalAssets = filteredProjects.reduce((s, p) => s + p.assetCount, 0);
  const displayName = selectedProj?.name ?? t("settings.aiAllProjects");

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 300;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const flipUp = spaceBelow < menuH && rect.top > spaceBelow;
    const top = flipUp ? rect.top - menuH - 6 : rect.bottom + 6;
    const w = Math.max(320, rect.width);
    setMenuPos({ top: Math.max(8, top), left: rect.right - w, width: w });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    requestAnimationFrame(updatePosition);
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onScroll() {
      updatePosition();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePosition]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate text-left font-g text-g-ui font-[510] tracking-g-ui">
          {activeWs?.name ?? ""} / {displayName}
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 transition-transform duration-[120ms] ease-g",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={menuClass}
            style={{
              top: menuPos.top,
              left: Math.max(8, menuPos.left),
              width: menuPos.width,
            }}
            id={menuId}
            role="menu"
            aria-label={t("topbar.projectSwitcherTitle")}
          >
            <div className={sectionLabelClass}>
              {t("topbar.workspaceSection")}
            </div>
            {workspaces.map((ws) => {
              const isActive = selectedWorkspaceId === ws.id;
              return (
                <button
                  key={ws.id}
                  type="button"
                  className={optionClass}
                  role="menuitemradio"
                  aria-checked={isActive}
                  data-active={isActive || undefined}
                  onClick={() => {
                    onChangeWorkspace(ws.id);
                    onChangeProject("");
                  }}
                >
                  <WorkspaceAvatar
                    name={ws.name}
                    iconImage={ws.iconImage}
                    className={avatarClass}
                  />
                  <span className={copyClass}>
                    <strong className={nameClass}>{ws.name}</strong>
                  </span>
                  <Check
                    size={15}
                    className={cn(checkClass, isActive && checkVisibleClass)}
                    aria-hidden="true"
                  />
                </button>
              );
            })}

            <div className={sectionLabelClass}>
              {t("topbar.projectSection")}
            </div>
            <button
              type="button"
              className={optionClass}
              role="menuitemradio"
              aria-checked={selectedProjectId === ""}
              data-active={selectedProjectId === "" || undefined}
              onClick={() => {
                onChangeProject("");
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <Layers3 size={18} aria-hidden="true" />
              <span className={copyClass}>
                <strong className={nameClass}>
                  {t("settings.aiAllProjects")}
                </strong>
                <span className={subClass}>
                  {t("topbar.assetCount", { count: totalAssets })}
                </span>
              </span>
              <span className={countClass}>{totalAssets}</span>
              <Check
                size={15}
                className={cn(
                  checkClass,
                  selectedProjectId === "" && checkVisibleClass,
                )}
                aria-hidden="true"
              />
            </button>

            {filteredProjects.map((proj) => {
              const isSelected = selectedProjectId === proj.id;
              return (
                <button
                  key={proj.id}
                  type="button"
                  className={optionClass}
                  role="menuitemradio"
                  aria-checked={isSelected}
                  data-active={isSelected || undefined}
                  onClick={() => {
                    onChangeProject(proj.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <ProjectAvatar
                    iconImage={proj.iconImage}
                    className={cn(avatarClass, "[&_svg]:size-[18px]")}
                  />
                  <span className={copyClass}>
                    <strong className={nameClass}>{proj.name}</strong>
                    <span className={subClass}>{proj.path}</span>
                  </span>
                  <span className={countClass}>{proj.assetCount}</span>
                  <Check
                    size={15}
                    className={cn(checkClass, isSelected && checkVisibleClass)}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
