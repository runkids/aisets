import type { ReactNode } from "react";
import {
  IconButton,
  SegmentedControl,
  Tabs,
  Tooltip,
  type SegmentedControlItem,
} from "./ui";

export type BrowseToggleItem<T extends string> = SegmentedControlItem<T>;

type BrowseIconToggleGroupProps<T extends string> = {
  value: T;
  items: Array<BrowseToggleItem<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
};

export function BrowseIconToggleGroup<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
}: BrowseIconToggleGroupProps<T>) {
  return (
    <SegmentedControl
      variant="icon"
      value={value}
      items={items}
      onChange={onChange}
      ariaLabel={ariaLabel}
    />
  );
}

type BrowseTextToggleGroupProps<T extends string> = {
  value: T;
  items: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
};

export function BrowseTextToggleGroup<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className,
}: BrowseTextToggleGroupProps<T>) {
  return (
    <SegmentedControl
      variant="text"
      value={value}
      items={items}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}

export function BrowseSizeToggleGroup<T extends string>(
  props: Omit<BrowseTextToggleGroupProps<T>, "className">,
) {
  return (
    <SegmentedControl
      variant="fixed"
      value={props.value}
      items={props.items}
      onChange={props.onChange}
      ariaLabel={props.ariaLabel}
    />
  );
}

type BrowseActionToggleProps = {
  active: boolean;
  label: string;
  onToggle: () => void;
  children: ReactNode;
};

export function BrowseActionToggle({
  active,
  label,
  onToggle,
  children,
}: BrowseActionToggleProps) {
  return (
    <Tooltip label={label}>
      <IconButton active={active} onClick={onToggle} aria-label={label}>
        {children}
      </IconButton>
    </Tooltip>
  );
}

type BrowseStatusBarProps<T extends string> = {
  value: T;
  items: Array<SegmentedControlItem<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
};

export function BrowseStatusBar<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
}: BrowseStatusBarProps<T>) {
  return (
    <Tabs
      value={value}
      items={items}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className="max-w-full overflow-x-auto"
    />
  );
}
