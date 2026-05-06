import {
  FileWarning,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Recycle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Mode } from "../ui";
import { titleForMode } from "../ui";
import { TextInputButton, Tooltip } from "./ui";
import { IconButton } from "./ui/Button";

const MODE_ICON: Record<Mode, typeof FolderKanban> = {
  projects: FolderKanban,
  browse: FolderOpen,
  duplicates: Recycle,
  unused: Trash2,
  optimize: Sparkles,
  lint: FileWarning,
  precheck: ShieldCheck,
  settings: Settings,
};

type Props = {
  mode: Mode;
  totalLabel: string;
  working: boolean;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenCmdK?: () => void;
};

export function AppTopbar({
  mode,
  totalLabel,
  working,
  onAddProject,
  onRefresh,
  onOpenCmdK,
}: Props) {
  const { t } = useTranslation();
  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="crumbs-icon" aria-hidden="true">
          {(() => {
            const Icon = MODE_ICON[mode];
            return <Icon size={16} />;
          })()}
        </span>
        <strong className="crumbs-title">{titleForMode(mode)}</strong>
        {totalLabel && (
          <>
            <span className="crumbs-dot" aria-hidden="true">
              ·
            </span>
            <span className="crumbs-meta">{totalLabel}</span>
          </>
        )}
      </div>

      <div className="tb-spacer" />

      <TextInputButton
        className="topbar-search"
        icon={<Search size={14} aria-hidden="true" />}
        suffix={<span className="search-kbd">⌘P</span>}
        value={t("search.placeholderShort")}
        onClick={onOpenCmdK}
        aria-label={t("search.ariaLabel")}
      />

      <Tooltip label={t("action.addProject")} placement="bottom">
        <IconButton
          aria-label={t("action.addProject")}
          onClick={onAddProject}
          disabled={working}
        >
          <FolderPlus size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip label={t("action.rescan")} placement="bottom">
        <IconButton
          aria-label={t("action.rescan")}
          data-loading={working || undefined}
          onClick={onRefresh}
          disabled={working}
        >
          <RefreshCw size={16} />
        </IconButton>
      </Tooltip>
    </header>
  );
}
