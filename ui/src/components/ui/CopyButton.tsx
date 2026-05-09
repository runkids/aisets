import { useState, useEffect } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

const copyButtonVariants = cva(
  [
    "inline-flex cursor-pointer items-center justify-center rounded-g-sm text-g-ink-3",
    "transition-[background,color] duration-[120ms] ease-g",
    "hover:bg-g-surface-3 hover:text-g-ink",
  ],
  {
    variants: {
      size: {
        sm: "size-6 [&_svg]:size-3.5",
        md: "size-7 [&_svg]:size-4",
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
        copied && "text-g-green hover:text-g-green",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        copyText(value);
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
