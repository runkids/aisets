type PublicAssetEnv = {
  manifestHref?: string;
  runtimeBasePath?: string;
  viteBase?: string;
};

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export function resolvePublicAssetUrl(path: string, env: PublicAssetEnv = {}) {
  const cleanPath = path.replace(/^\/+/, "");

  if (env.runtimeBasePath) {
    return `${withTrailingSlash(env.runtimeBasePath.replace(/\/$/, ""))}${cleanPath}`;
  }

  if (env.manifestHref) {
    return new URL(cleanPath, new URL(".", env.manifestHref)).toString();
  }

  const viteBase = env.viteBase || "/";
  if (viteBase === "." || viteBase === "./") return `/${cleanPath}`;

  return `${withTrailingSlash(viteBase)}${cleanPath}`;
}

function currentPublicAssetEnv(): PublicAssetEnv {
  if (typeof window === "undefined") {
    return { viteBase: import.meta.env.BASE_URL || "/" };
  }

  return {
    manifestHref: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
      ?.href,
    runtimeBasePath: window.__BASE_PATH__,
    viteBase: import.meta.env.BASE_URL || "/",
  };
}

export const aisetsAppIconUrl = resolvePublicAssetUrl(
  "brand/aisets-app-icon.avif",
  currentPublicAssetEnv(),
);
