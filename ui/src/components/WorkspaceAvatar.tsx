import { cn } from "@/lib/cn";

type WorkspaceAvatarProps = {
  name: string;
  iconImage?: string;
  className?: string;
};

function workspaceInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "A";
}

export function WorkspaceAvatar({
  name,
  iconImage,
  className,
}: WorkspaceAvatarProps) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-g-md bg-g-surface-3 text-g-ink font-g-display text-[13px] font-[590]",
        className,
      )}
      aria-hidden="true"
    >
      {iconImage ? (
        <img src={iconImage} alt="" className="size-full object-cover" />
      ) : (
        workspaceInitial(name)
      )}
    </span>
  );
}
