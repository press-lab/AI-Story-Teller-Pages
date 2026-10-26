/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestAppUrl } from "./appUpdate";

afterEach(() => vi.unstubAllGlobals());

describe("app update navigation", () => {
  it("bypasses the document cache and preserves the deployment path, other parameters and hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '<div id="root"></div>' });
    vi.stubGlobal("fetch", fetchMock);
    const href = "https://example.com/AI-Story-Teller-Pages/?foo=bar&app-update=old#menu";
    const first = await getLatestAppUrl(href);
    const second = await getLatestAppUrl(first);
    const url = new URL(first);
    expect(url.pathname).toBe("/AI-Story-Teller-Pages/");
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.hash).toBe("#menu");
    expect(url.searchParams.getAll("app-update")).toHaveLength(1);
    expect(url.searchParams.get("app-update")).not.toBe("old");
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledWith(first, { cache: "no-store", signal: expect.any(AbortSignal) });
  });

  it("keeps the current app open on server errors, offline failures, and non-app pages", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(getLatestAppUrl("https://example.com/")).rejects.toThrow("503");
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(getLatestAppUrl("https://example.com/")).rejects.toThrow("offline");
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => "maintenance" });
    await expect(getLatestAppUrl("https://example.com/")).rejects.toThrow("did not return the app");
  });
});
