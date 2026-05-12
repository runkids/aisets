import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Tooltip } from "../ui";

type FavoriteButtonProps = {
  favorite: boolean;
  label: string;
  pending?: boolean;
  className?: string;
  onToggle: () => void;
};

const favoriteClassName =
  "bg-g-amber-soft text-g-amber hover:bg-g-amber-soft hover:text-g-amber";

export function FavoriteButton({
  favorite,
  label,
  pending = false,
  className,
  onToggle,
}: FavoriteButtonProps) {
  const icon = (
    <Star
      size={14}
      fill={favorite ? "currentColor" : "none"}
      aria-hidden="true"
    />
  );

  return (
    <Tooltip label={label} placement="top">
      <span className="inline-flex">
        <IconButton
          aria-label={label}
          aria-pressed={favorite}
          aria-disabled={pending}
          data-pending={pending ? "true" : undefined}
          className={cn(favorite && favoriteClassName, className)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (pending) return;
            onToggle();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}
