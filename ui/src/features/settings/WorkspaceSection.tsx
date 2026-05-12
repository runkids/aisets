import {
  ArrowLeftRight,
  CheckCircle2,
  FolderKanban,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { Workspace } from "@/types";
import { Badge, Button, Card, ConfirmDialog, TextInput } from "@/components/ui";
import { WorkspaceAvatar } from "@/components/project/WorkspaceAvatar";
import { FieldRow, SectionHeading, sectionIcon } from "./index";
import {
  activeWorkspaceBadgeClass,
  rowActionButtonClass,
  rowActionDangerButtonClass,
  switchWorkspaceButtonClass,
  workspaceRowActionRevealClass,
} from "./constants";
import type { SettingsDraft } from "./types";
import { WorkspaceDialog } from "./WorkspaceDialog";

type WorkspaceSectionProps = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  draft: SettingsDraft;
  defaultRootPlaceholder: string;
  defaultRootCurrentPath: string;
  working: boolean;
  settingActions: ReactNode;
  onUpdateDraft: (updater: (current: SettingsDraft) => SettingsDraft) => void;
  onAddWorkspace: (value: { name: string; iconImage: string }) => void;
  onRenameWorkspace: (
    workspaceId: string,
    value: { name: string; iconImage: string },
  ) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  addWorkspacePending: boolean;
  renameWorkspacePending: boolean;
  removeWorkspacePending: boolean;
};

export function WorkspaceSection({
  workspaces,
  activeWorkspaceId,
  draft,
  defaultRootPlaceholder,
  defaultRootCurrentPath,
  working,
  settingActions,
  onUpdateDraft,
  onAddWorkspace,
  onRenameWorkspace,
  onRemoveWorkspace,
  onSwitchWorkspace,
  addWorkspacePending,
  renameWorkspacePending,
  removeWorkspacePending,
}: WorkspaceSectionProps) {
  const { t } = useTranslation();
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(
    null,
  );
  const [removeWorkspaceId, setRemoveWorkspaceId] = useState<string | null>(
    null,
  );

  const workspaceBeingRenamed = workspaces.find(
    (workspace) => workspace.id === renameWorkspaceId,
  );
  const workspaceBeingRemoved = workspaces.find(
    (workspace) => workspace.id === removeWorkspaceId,
  );

  function handleAddWorkspace(value: { name: string; iconImage: string }) {
    onAddWorkspace(value);
    setAddWorkspaceOpen(false);
  }

  function handleRenameWorkspace(value: { name: string; iconImage: string }) {
    if (!workspaceBeingRenamed) return;
    onRenameWorkspace(workspaceBeingRenamed.id, value);
    setRenameWorkspaceId(null);
  }

  function handleRemoveWorkspace() {
    if (!workspaceBeingRemoved) return;
    onRemoveWorkspace(workspaceBeingRemoved.id);
    setRemoveWorkspaceId(null);
  }

  return (
    <>
      <Card
        className="overflow-hidden border border-g-line rounded-g-md bg-g-surface shadow-g-sm hover:border-g-line hover:shadow-g-sm"
        padding="none"
      >
        <SectionHeading
          title={t("settings.section.workspace")}
          description={t("settings.workspaceDesc")}
          icon={sectionIcon("workspace")}
        />
        <div className="px-6 pt-5 pb-2 md:px-8">
          <div className="mb-4">
            <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
              {t("settings.workspaces")}
            </span>
            <p className="mt-0.5 max-w-[60ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
              {t("settings.workspacesHint")}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5">
            <div className="grid gap-2.5" role="list">
              {workspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId;
                const summary = t("settings.workspaceProjects", {
                  count: workspace.projectCount,
                });

                return (
                  <div
                    key={workspace.id}
                    role="listitem"
                    className={cn(
                      "group relative flex flex-col gap-2 rounded-g-lg border px-4 py-3 shadow-g-sm transition-[background,border-color,box-shadow] duration-[120ms] ease-g sm:flex-row sm:items-center",
                      isActive
                        ? "border-g-line-strong bg-g-surface-2"
                        : "border-g-line bg-g-surface hover:bg-g-surface-2 hover:border-g-line-strong focus-within:bg-g-surface-2",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
                      <WorkspaceAvatar
                        name={workspace.name}
                        iconImage={workspace.iconImage}
                        className="text-g-ink-2"
                      />
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate font-g-display text-g-body leading-[1.3] tracking-[-0.013em] text-g-ink",
                            isActive ? "font-[590]" : "font-[510]",
                          )}
                        >
                          {workspace.name}
                        </span>
                        <span className="block font-g-mono text-g-chip tracking-g-mono text-g-ink-3">
                          {summary}
                        </span>
                      </span>
                    </div>
                    <div className="relative flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                      <div className={workspaceRowActionRevealClass}>
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={<Pencil size={13} />}
                          disabled={working}
                          className={rowActionButtonClass}
                          onClick={() => setRenameWorkspaceId(workspace.id)}
                        >
                          {t("action.edit")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={<Trash2 size={13} />}
                          disabled={working || workspaces.length <= 1}
                          className={rowActionDangerButtonClass}
                          onClick={() => setRemoveWorkspaceId(workspace.id)}
                        >
                          {t("action.delete")}
                        </Button>
                      </div>
                      {isActive && (
                        <Badge
                          tone="line"
                          className={activeWorkspaceBadgeClass}
                        >
                          <CheckCircle2 aria-hidden="true" />
                          {t("settings.activeWorkspace")}
                        </Badge>
                      )}
                      {!isActive && (
                        <Button
                          variant="secondary"
                          size="sm"
                          leadingIcon={<ArrowLeftRight size={13} />}
                          disabled={working}
                          className={switchWorkspaceButtonClass}
                          onClick={() => void onSwitchWorkspace(workspace.id)}
                        >
                          {t("settings.switchWorkspaceAction")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus size={13} />}
              disabled={working}
              className="self-start"
              onClick={() => setAddWorkspaceOpen(true)}
            >
              {t("settings.addWorkspace")}
            </Button>
          </div>
          <div className="my-5 border-t border-g-line" />
          <FieldRow
            label={t("settings.defaultRoot")}
            description={t("settings.defaultRootHint")}
            icon={<FolderKanban size={15} />}
            align="start"
          >
            <div className="flex w-full flex-col gap-1.5 min-[1200px]:w-[560px]">
              <TextInput
                type="text"
                disabled={working}
                value={draft.defaultProjectRoot}
                onChange={(event) =>
                  onUpdateDraft((prev) => ({
                    ...prev,
                    defaultProjectRoot: event.target.value,
                  }))
                }
                placeholder={defaultRootPlaceholder}
                className="w-full"
              />
              {defaultRootCurrentPath && (
                <p className="break-all text-left font-g-mono text-g-caption tracking-g-mono text-g-ink-3 min-[1200px]:text-right">
                  {defaultRootCurrentPath}
                </p>
              )}
            </div>
          </FieldRow>
          {settingActions}
        </div>
      </Card>
      <WorkspaceDialog
        open={addWorkspaceOpen}
        loading={addWorkspacePending}
        onConfirm={handleAddWorkspace}
        onCancel={() => setAddWorkspaceOpen(false)}
      />
      <WorkspaceDialog
        open={Boolean(workspaceBeingRenamed)}
        workspace={workspaceBeingRenamed}
        loading={renameWorkspacePending}
        onConfirm={handleRenameWorkspace}
        onCancel={() => setRenameWorkspaceId(null)}
      />
      <ConfirmDialog
        open={Boolean(workspaceBeingRemoved)}
        variant="danger"
        title={t("settings.removeWorkspace")}
        message={t("settings.removeWorkspaceConfirm", {
          name: workspaceBeingRemoved?.name ?? "",
        })}
        confirmText={t("action.delete")}
        cancelText={t("common.cancel")}
        loading={removeWorkspacePending}
        onConfirm={handleRemoveWorkspace}
        onCancel={() => setRemoveWorkspaceId(null)}
      />
    </>
  );
}
