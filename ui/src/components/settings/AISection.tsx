import { isAITagActivityBusy } from "../../activity/aiTagActivity";
import { isVLMOcrActivityBusy } from "../../activity/vlmOcrActivity";
import { isEmbedActivityBusy } from "../../activity/embedActivity";
import type { AISectionProps } from "./aiSectionUtils";
import { AISettingsCard } from "./AISettingsCard";
import { AIOperationsCard } from "./AIOperationsCard";

export function AISection({
  draft,
  settings,
  working,
  aiTagActivity,
  vlmOcrActivity,
  workspaces,
  projects,
  activeWorkspaceId,
  settingActions,
  onUpdateDraft,
  onStartAITag,
  onStopAITag,
  onStartVLMOcr,
  onStopVLMOcr,
  embedActivity,
  onStartEmbed,
  onStopEmbed,
  onNavigate,
}: AISectionProps) {
  const aiBusy =
    isAITagActivityBusy(aiTagActivity) ||
    isVLMOcrActivityBusy(vlmOcrActivity) ||
    isEmbedActivityBusy(embedActivity);

  return (
    <div className="flex flex-col gap-4">
      <AISettingsCard
        draft={draft}
        settings={settings}
        working={working}
        aiBusy={aiBusy}
        settingActions={settingActions}
        onUpdateDraft={onUpdateDraft}
        onNavigate={onNavigate}
      />
      <AIOperationsCard
        draft={draft}
        settings={settings}
        working={working}
        aiBusy={aiBusy}
        aiTagActivity={aiTagActivity}
        vlmOcrActivity={vlmOcrActivity}
        embedActivity={embedActivity}
        workspaces={workspaces}
        projects={projects}
        activeWorkspaceId={activeWorkspaceId}
        onStartAITag={onStartAITag}
        onStopAITag={onStopAITag}
        onStartVLMOcr={onStartVLMOcr}
        onStopVLMOcr={onStopVLMOcr}
        onStartEmbed={onStartEmbed}
        onStopEmbed={onStopEmbed}
      />
    </div>
  );
}
