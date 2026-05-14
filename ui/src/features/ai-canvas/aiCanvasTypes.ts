import type { Dispatch, SetStateAction } from "react";

export type AIBackendOption = {
  value: string;
  label: string;
  group: string;
  disabled?: boolean;
};

export type WorkingState =
  | "idle"
  | "search"
  | "ai"
  | "aiApplying"
  | "imagePreview"
  | "operation";

export type MentionableImageCard = {
  id: string;
  name: string;
  meta: string;
  src?: string;
};

export type StateSetter<T> = Dispatch<SetStateAction<T>>;
