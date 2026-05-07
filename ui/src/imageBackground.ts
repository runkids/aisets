import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

export type ImageBackgroundMode = "checker" | "light" | "dark";

export const imageBackgroundModes: ImageBackgroundMode[] = [
  "checker",
  "light",
  "dark",
];

export function normalizeImageBackgroundMode(
  value: unknown,
  fallback: ImageBackgroundMode = "checker",
): ImageBackgroundMode {
  return typeof value === "string" &&
    imageBackgroundModes.includes(value as ImageBackgroundMode)
    ? (value as ImageBackgroundMode)
    : fallback;
}

const imageBackgroundClasses: Record<ImageBackgroundMode, string> = {
  checker: "asset-image-bg-checker",
  light: "asset-image-bg-light",
  dark: "asset-image-bg-dark",
};

export function imageBackgroundClassName(mode: ImageBackgroundMode) {
  return imageBackgroundClasses[mode];
}

type ImageBackgroundContextValue = {
  mode: ImageBackgroundMode;
  setMode: (mode: ImageBackgroundMode) => void;
};

const ImageBackgroundContext = createContext<ImageBackgroundContextValue>({
  mode: "checker",
  setMode: () => undefined,
});

export function ImageBackgroundProvider({
  children,
  mode,
  onModeChange,
}: {
  children: ReactNode;
  mode: ImageBackgroundMode;
  onModeChange: (mode: ImageBackgroundMode) => void;
}) {
  return createElement(
    ImageBackgroundContext.Provider,
    { value: { mode, setMode: onModeChange } },
    children,
  );
}

export function useImageBackgroundMode() {
  return useContext(ImageBackgroundContext).mode;
}

export function useImageBackgroundControls() {
  return useContext(ImageBackgroundContext);
}
