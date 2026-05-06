import type { ImgHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type AssetThumbnailSize = "sm" | "md" | "lg" | "fill";
type AssetThumbnailBg = "surface" | "checker" | "light" | "dark";

type AssetThumbnailProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string;
  size?: AssetThumbnailSize;
  bg?: AssetThumbnailBg;
  imageClassName?: string;
};

const sizeClassNames: Record<AssetThumbnailSize, string> = {
  sm: "size-9 [&_img]:max-h-7 [&_img]:max-w-7",
  md: "size-12 [&_img]:max-h-10 [&_img]:max-w-10",
  lg: "size-16 [&_img]:max-h-14 [&_img]:max-w-14",
  fill: "aspect-square w-full [&_img]:max-h-[85%] [&_img]:max-w-[85%]",
};

const bgClassNames: Record<AssetThumbnailBg, string> = {
  surface: "bg-g-surface-2",
  checker:
    "bg-[repeating-conic-gradient(var(--g-surface-3)_0_25%,var(--g-canvas)_0_50%)] bg-[length:14px_14px]",
  light: "bg-white",
  dark: "bg-g-canvas",
};

export function AssetThumbnail({
  src,
  alt = "",
  size = "md",
  bg = "surface",
  className,
  imageClassName,
  loading = "lazy",
  ...props
}: AssetThumbnailProps) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-g-sm border border-g-line",
        sizeClassNames[size],
        bgClassNames[bg],
        className,
      )}
      aria-hidden={alt === "" ? true : undefined}
    >
      {src && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          className={cn("object-contain", imageClassName)}
          {...props}
        />
      )}
    </span>
  );
}
