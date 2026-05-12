import { IMAGE_TOOLS_BASKET_KEY } from "../../imageToolsBasket";
import {
  AI_TAG_LAST_RUN_KEY,
  clearLastRun,
  EMBED_LAST_RUN_KEY,
  VLM_OCR_LAST_RUN_KEY,
} from "./aiSectionUtils";

const RESET_LOCAL_STORAGE_KEYS = [
  "aisets-browse-state",
  "aisets-cmd-history",
  AI_TAG_LAST_RUN_KEY,
  VLM_OCR_LAST_RUN_KEY,
  EMBED_LAST_RUN_KEY,
];

const RESET_SESSION_STORAGE_KEYS = [
  IMAGE_TOOLS_BASKET_KEY,
  "aisets.optimize.estimates.v2",
];

function removeStorageKeys(storage: Storage | undefined, keys: string[]) {
  if (!storage) return;
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore unavailable storage (private mode, denied access).
    }
  }
}

async function clearAisetsCacheStorage() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const names = await window.caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("aisets-"))
        .map((name) => window.caches.delete(name)),
    );
  } catch {
    // CacheStorage may be unavailable or blocked.
  }
}

export async function clearDatabaseResetBrowserCache() {
  if (typeof window === "undefined") return;
  clearLastRun(AI_TAG_LAST_RUN_KEY);
  clearLastRun(VLM_OCR_LAST_RUN_KEY);
  clearLastRun(EMBED_LAST_RUN_KEY);
  removeStorageKeys(window.localStorage, RESET_LOCAL_STORAGE_KEYS);
  removeStorageKeys(window.sessionStorage, RESET_SESSION_STORAGE_KEYS);
  await clearAisetsCacheStorage();
}
