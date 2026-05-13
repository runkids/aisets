import {
  FileWarning,
  FolderKanban,
  FolderOpen,
  Gauge,
  History,
  Images,
  MessageSquareCode,
  Recycle,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Mode } from "@/ui";

export type ModeItem = { id: Mode; labelKey: string; icon: ReactNode };

export const MODE_ITEMS: ModeItem[] = [
  {
    id: "projects",
    labelKey: "nav.projects",
    icon: <FolderKanban size={14} />,
  },
  { id: "history", labelKey: "nav.history", icon: <History size={14} /> },
  { id: "browse", labelKey: "nav.browse", icon: <FolderOpen size={14} /> },
  { id: "tags", labelKey: "nav.tags", icon: <Tags size={14} /> },
  { id: "duplicates", labelKey: "nav.duplicates", icon: <Recycle size={14} /> },
  { id: "unused", labelKey: "nav.unused", icon: <Trash2 size={14} /> },
  { id: "optimize", labelKey: "nav.optimize", icon: <Gauge size={14} /> },
  { id: "lint", labelKey: "nav.lint", icon: <FileWarning size={14} /> },
  { id: "precheck", labelKey: "nav.precheck", icon: <ShieldCheck size={14} /> },
  { id: "imageTools", labelKey: "nav.imageTools", icon: <Images size={14} /> },
  { id: "aiCanvas", labelKey: "nav.aiCanvas", icon: <Sparkles size={14} /> },
  {
    id: "prompts",
    labelKey: "nav.prompts",
    icon: <MessageSquareCode size={14} />,
  },
  { id: "settings", labelKey: "nav.settings", icon: <Settings size={14} /> },
];
