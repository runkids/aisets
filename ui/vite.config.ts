import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const vendorChunkGroups: Record<string, string[]> = {
  "vendor-react": ["react", "react-dom", "scheduler"],
  "vendor-router": ["react-router", "react-router-dom"],
  "vendor-query": ["@tanstack/react-query", "@tanstack/react-virtual"],
  "vendor-radix": ["radix-ui", "@radix-ui/react-tooltip"],
  "vendor-i18n": [
    "i18next",
    "i18next-browser-languagedetector",
    "react-i18next",
  ],
  "vendor-icons": ["lucide-react"],
  "vendor-ui": ["class-variance-authority", "clsx", "tailwind-merge"],
};

const appChunkGroups: Record<string, string[]> = {
  "app-shell": [
    "/src/components/AppTopbar.tsx",
    "/src/components/CommandPalette.tsx",
    "/src/components/NavSidebar.tsx",
    "/src/components/ScrollToTop.tsx",
  ],
  "app-data": [
    "/src/api.ts",
    "/src/appScope.ts",
    "/src/customAssetFilters.ts",
    "/src/imageBackground.ts",
    "/src/ocrActivity.ts",
    "/src/ocrSearch.ts",
    "/src/ocrStatus.ts",
    "/src/projectScanIntent.ts",
    "/src/queries.ts",
    "/src/types.ts",
    "/src/ui.ts",
    "/src/useDebouncedValue.ts",
  ],
  "app-i18n": ["/src/i18n/"],
  "app-ui": [
    "/src/components/ui/",
    "/src/components/BatchConfirmModal.tsx",
    "/src/components/BatchPreviewModal.tsx",
    "/src/components/DirectoryPickerModal.tsx",
    "/src/components/OCRStatusBadge.tsx",
    "/src/components/PreviewModal.tsx",
    "/src/components/ProjectAvatar.tsx",
    "/src/components/ProjectSwitcher.tsx",
    "/src/components/ToastProvider.tsx",
    "/src/components/WorkspaceAvatar.tsx",
  ],
  "feature-assets": [
    "/src/components/AssetDrawer",
    "/src/components/AssetCard.tsx",
    "/src/components/AssetList.tsx",
    "/src/components/ComparePanel.tsx",
    "/src/components/SimilarCompare.tsx",
  ],
  "feature-browse": [
    "/src/components/Browse",
    "/src/components/FilterRail.tsx",
  ],
  "feature-duplicates": [
    "/src/components/DuplicatesView.tsx",
    "/src/components/duplicateGroupViews.ts",
  ],
  "feature-lint": ["/src/components/LintView.tsx"],
  "feature-optimize": ["/src/components/OptimizeView.tsx"],
  "feature-precheck": ["/src/components/PreCheckView.tsx"],
  "feature-projects": [
    "/src/components/ProjectDialog.tsx",
    "/src/components/ProjectsView.tsx",
  ],
  "feature-history": [
    "/src/components/ScanHistoryView.tsx",
    "/src/scanHistory.ts",
  ],
  "feature-settings": [
    "/src/components/settings/",
    "/src/components/SettingsView.tsx",
  ],
};

function normalizeModuleId(id: string): string {
  return id.replaceAll("\\", "/");
}

function chunkFromModuleId(
  id: string,
  chunkGroups: Record<string, string[]>,
): string | undefined {
  const normalizedId = normalizeModuleId(id);

  for (const [chunkName, matchers] of Object.entries(chunkGroups)) {
    const matches = matchers.some((matcher) => {
      if (matcher.endsWith("/")) return normalizedId.includes(matcher);
      return normalizedId.endsWith(matcher);
    });

    if (matches) return chunkName;
  }

  return undefined;
}

function packageNameFromModuleId(id: string): string | undefined {
  const normalizedId = normalizeModuleId(id);
  const nodeModulesIndex = normalizedId.lastIndexOf("/node_modules/");

  if (nodeModulesIndex === -1) return undefined;

  const packagePath = normalizedId.slice(
    nodeModulesIndex + "/node_modules/".length,
  );
  const [firstSegment, secondSegment] = packagePath.split("/");

  if (!firstSegment) return undefined;
  if (firstSegment.startsWith("@")) return `${firstSegment}/${secondSegment}`;

  return firstSegment;
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const packageName = packageNameFromModuleId(id);

          if (packageName) {
            for (const [chunkName, packages] of Object.entries(
              vendorChunkGroups,
            )) {
              if (packages.includes(packageName)) return chunkName;
            }

            return "vendor";
          }

          return chunkFromModuleId(id, appChunkGroups);
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5174,
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      "/api": "http://127.0.0.1:19520",
    },
  },
});
