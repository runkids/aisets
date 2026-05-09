import { FolderKanban } from "lucide-react";
import { cn } from "@/lib/cn";

type ProjectAvatarProps = {
  iconImage?: string;
  className?: string;
};

export function ProjectAvatar({ iconImage, className }: ProjectAvatarProps) {
  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center overflow-hidden rounded-g-md bg-g-surface-2 text-g-ink-2 shadow-g-inset [&_svg]:size-6",
        className,
      )}
      aria-hidden="true"
    >
      {iconImage ? (
        <img src={iconImage} alt="" className="size-full object-cover" />
      ) : (
        <FolderKanban />
      )}
    </span>
  );
}
