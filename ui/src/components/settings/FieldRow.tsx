import type { ReactNode } from "react";
import { Button } from "../ui";

export function FieldRow({
  label,
  description,
  align = "center",
  children,
}: {
  label: string;
  description?: string;
  icon?: ReactNode;
  align?: "center" | "start";
  children: ReactNode;
}) {
  return (
    <div
      className={
        align === "start"
          ? "grid grid-cols-1 items-start gap-3 py-4 min-[1200px]:grid-cols-[minmax(0,1fr)_auto] min-[1200px]:gap-8"
          : "grid grid-cols-1 items-center gap-3 py-4 min-[1200px]:grid-cols-[minmax(0,1fr)_auto] min-[1200px]:gap-8"
      }
    >
      <div className="min-w-0">
        <span className="block font-g text-g-body font-[510] leading-[1.4] tracking-g-ui text-g-ink">
          {label}
        </span>
        {description && (
          <p className="mt-0.5 max-w-[48ch] font-g text-g-ui font-normal tracking-g-ui text-g-ink-3">
            {description}
          </p>
        )}
      </div>
      <div className="flex min-w-0 justify-start min-[1200px]:min-w-[280px] min-[1200px]:justify-end">
        {children}
      </div>
    </div>
  );
}

export function SectionHeading(props: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  void props;
  return null;
}

export function SettingsActions({
  disabled,
  onSave,
  onReset,
  saveLabel,
  resetLabel,
}: {
  disabled: boolean;
  onSave: () => void;
  onReset: () => void;
  saveLabel: string;
  resetLabel: string;
}) {
  return (
    <div className="flex gap-2 py-4">
      <Button variant="primary" onClick={onSave} disabled={disabled}>
        {saveLabel}
      </Button>
      <Button variant="ghost" onClick={onReset} disabled={disabled}>
        {resetLabel}
      </Button>
    </div>
  );
}
