import { describe, expect, it } from "vitest";
import { resolvePublicAssetUrl } from "./brandAssets";

describe("resolvePublicAssetUrl", () => {
  it("resolves Vite relative-base assets from the manifest location", () => {
    expect(
      resolvePublicAssetUrl("brand/aisets-app-icon.avif", {
        manifestHref: "http://127.0.0.1:3003/site.webmanifest",
        viteBase: "./",
      }),
    ).toBe("http://127.0.0.1:3003/brand/aisets-app-icon.avif");
  });

  it("keeps Go runtime base paths for packaged UI assets", () => {
    expect(
      resolvePublicAssetUrl("brand/aisets-app-icon.avif", {
        runtimeBasePath: "/studio",
        viteBase: "./",
      }),
    ).toBe("/studio/brand/aisets-app-icon.avif");
  });

  it("falls back to root assets when no document manifest exists", () => {
    expect(
      resolvePublicAssetUrl("/brand/aisets-app-icon.avif", { viteBase: "./" }),
    ).toBe("/brand/aisets-app-icon.avif");
  });
});
