export async function getLatestAppUrl(href: string): Promise<string> {
  const url = new URL(href);
  // A new navigation URL bypasses Safari's cached Home Screen document.
  url.searchParams.set("app-update", crypto.randomUUID());
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.href, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`The app server returned HTTP ${response.status}.`);
    const html = await response.text();
    if (!/id=["']root["']/.test(html)) throw new Error("The server did not return the app.");
    return url.href;
  } finally {
    window.clearTimeout(timeout);
  }
}
