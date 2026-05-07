import { useState, useEffect } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

const copyButtonVariants = cva(
  [
    "inline-flex cursor-pointer items-center justify-center text-g-ink-3 hover:text-g-ink-2",
    "transition-colors duration-[120ms] ease-g",
  ],
  {
    variants: {
      size: {
        sm: "size-4 [&_svg]:size-3.5",
        md: "size-5 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

type CopyButtonProps = VariantProps<typeof copyButtonVariants> & {
  value: string;
  label?: string;
  className?: string;
};

function CopyButton({
  value,
  label = "Copy",
  size,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        copyButtonVariants({ size }),
        copied && "text-g-green",
        className,
      )}
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

/* eslint-disable react-refresh/only-export-components */
export { CopyButton, copyButtonVariants, type CopyButtonProps };
/* eslint-enable react-refresh/only-export-components */
