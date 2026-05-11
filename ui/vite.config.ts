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
  "vendor-editor": [
    "@tiptap/core",
    "@tiptap/extension-placeholder",
    "@tiptap/pm",
    "@tiptap/react",
    "@tiptap/starter-kit",
    "prosemirror-changeset",
    "prosemirror-commands",
    "prosemirror-dropcursor",
    "prosemirror-gapcursor",
    "prosemirror-history",
    "prosemirror-keymap",
    "prosemirror-model",
    "prosemirror-schema-list",
    "prosemirror-state",
    "prosemirror-tables",
    "prosemirror-transform",
    "prosemirror-view",
  ],
};

const appChunkGroups: Record<string, string[]> = {
  "app-shell": [
    "/src/components/shared/AppTopbar.tsx",
    "/src/components/shared/CommandPalette.tsx",
    "/src/components/shared/NavSidebar.tsx",
    "/src/components/shared/ScrollToTop.tsx",
  ],
  "app-data": [
    "/src/api.ts",
    "/src/activity/",
    "/src/appScope.ts",
    "/src/customAssetFilters.ts",
    "/src/imageBackground.ts",
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
    "/src/components/shared/",
  ],
  "feature-browse": ["/src/components/browse/"],
  "feature-drawer": ["/src/components/drawer/"],
  "feature-duplicates": ["/src/components/duplicates/"],
  "feature-lint": ["/src/components/lint/"],
  "feature-optimize": ["/src/components/optimize/"],
  "feature-tags": ["/src/components/tags/"],
  "feature-scan": ["/src/components/scan/"],
  "feature-projects": ["/src/components/project/"],
  "feature-history": ["/src/scanHistory.ts"],
  "feature-settings": ["/src/components/settings/"],
  "feature-prompts": ["/src/components/prompts/"],
  "feature-dashboard": ["/src/components/dashboard/"],
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
    port: Number(process.env.AISETS_UI_PORT) || 5174,
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      "/api": `http://127.0.0.1:${process.env.AISETS_PORT || "19520"}`,
    },
  },
});
