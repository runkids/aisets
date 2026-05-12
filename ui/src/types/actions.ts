export type ActionPreview = {
  id: string;
  type: string;
  projectId: string;
  changes: Array<{
    file: string;
    line: number;
    oldSpecifier: string;
    newSpecifier: string;
  }>;
  deletes: string[];
  blockers: Array<{ file: string; line: number; code: string; reason: string }>;
  canApply: boolean;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type APIErrorBody = {
  error: {
    code: string;
    message: string;
    params?: Record<string, unknown>;
  };
};

export type DirectoryListing = {
  path: string;
  parent: string;
  directories: Array<{ name: string; path: string }>;
};

export type BatchResult = {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: string[];
  appliedAt: string;
};

export type RenameRules = {
  lowercase?: boolean;
  replaceChars?: Record<string, string>;
  prefix?: string;
  suffix?: string;
  customBaseNames?: Record<string, string>;
};
