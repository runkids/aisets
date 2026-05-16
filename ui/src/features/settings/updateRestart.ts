export async function reloadWhenServerReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    try {
      const response = await fetch(`${window.__BASE_PATH__ ?? ""}/api/health`, {
        cache: "no-store",
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
    } catch {
      /* server is restarting */
    }
  }
}
