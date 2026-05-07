import type { ImgHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { useImageBackgroundMode } from "@/imageBackground";

const assetThumbnailVariants = cva(
  "grid shrink-0 place-items-center overflow-hidden rounded-g-sm border border-g-line",
  {
    variants: {
      size: {
        sm: "size-9 [&_img]:max-h-7 [&_img]:max-w-7",
        md: "size-12 [&_img]:max-h-10 [&_img]:max-w-10",
        lg: "size-16 [&_img]:max-h-14 [&_img]:max-w-14",
        fill: "aspect-square w-full [&_img]:max-h-[85%] [&_img]:max-w-[85%]",
      },
      bg: {
        surface: "bg-g-surface-2",
        checker: "asset-image-bg-checker",
        light: "asset-image-bg-light",
        dark: "asset-image-bg-dark",
      },
    },
    defaultVariants: {
      size: "md",
      bg: "surface",
    },
  },
);

type AssetThumbnailProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> &
  VariantProps<typeof assetThumbnailVariants> & {
    src?: string;
    imageClassName?: string;
  };

export function AssetThumbnail({
  src,
  alt = "",
  size,
  bg,
  className,
  imageClassName,
  loading = "lazy",
  ...props
}: AssetThumbnailProps) {
  const globalBg = useImageBackgroundMode();
  const effectiveBg = bg ?? globalBg;

  return (
    <span
      className={cn(
        assetThumbnailVariants({ size, bg: effectiveBg }),
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

// eslint-disable-next-line react-refresh/only-export-components
export { assetThumbnailVariants };
