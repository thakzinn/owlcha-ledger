import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { defaultCatalog } from "@/lib/catalog";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), rate: vi.fn(), readCatalog: vi.fn(), saveCatalog: vi.fn(),
  usage: vi.fn(), range: vi.fn(), categories: vi.fn(),
}));
vi.mock("@/lib/guard", () => ({ requireSession: mocks.guard }));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: mocks.rate }));
vi.mock("@/lib/sheets", () => ({
  readCatalog: mocks.readCatalog, saveCatalog: mocks.saveCatalog, descriptionUsage: mocks.usage,
  getRange: mocks.range, readCategoryMappings: mocks.categories,
  ConflictError: class ConflictError extends Error {},
  SheetAccessError: class SheetAccessError extends Error {},
  SheetNotFoundError: class SheetNotFoundError extends Error {},
}));
import { GET as getCatalog, PUT as putCatalog } from "@/app/api/catalog/route";
import { GET as getInsights } from "@/app/api/insights/route";
import { GET as getRange } from "@/app/api/entries/range/route";
import { ConflictError } from "@/lib/sheets";

const version = "a".repeat(64);
const request = (path: string, body?: unknown) => new NextRequest(`http://localhost:3000${path}`, body === undefined ? undefined : {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, email: "test@example.test", token: { accessToken: "test" } });
  mocks.rate.mockReturnValue(true);
  mocks.readCatalog.mockResolvedValue({ catalog: defaultCatalog(), version });
  mocks.saveCatalog.mockResolvedValue({ catalog: defaultCatalog(), version });
  mocks.usage.mockResolvedValue([]);
  mocks.range.mockResolvedValue({ entries: [] });
  mocks.categories.mockResolvedValue({ exists: false });
});

describe("feature route contracts", () => {
  it("guards every new route before reading or writing", async () => {
    mocks.guard.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await getCatalog(request("/api/catalog"))).status).toBe(401);
    expect((await putCatalog(request("/api/catalog", {}))).status).toBe(401);
    expect((await getInsights(request("/api/insights"))).status).toBe(401);
    expect(mocks.readCatalog).not.toHaveBeenCalled();
    expect(mocks.saveCatalog).not.toHaveBeenCalled();
  });
  it("reads and saves the versioned catalog, rejects ambiguous aliases", async () => {
    const result = await getCatalog(request("/api/catalog"));
    expect(await result.json()).toEqual({ catalog: defaultCatalog(), version, usage: [] });
    expect((await putCatalog(request("/api/catalog", { catalog: defaultCatalog(), baseVersion: version }))).status).toBe(200);
    const catalog = { ...defaultCatalog(), items: [
      { name: "ค่าเรียกรถ", aliases: ["ค่ารถ"], favorite: true },
      { name: "ค่ารถ", aliases: [], favorite: false },
    ] };
    expect((await putCatalog(request("/api/catalog", { catalog, baseVersion: version }))).status).toBe(400);
    expect(mocks.saveCatalog).toHaveBeenCalledTimes(1);
  });
  it("keeps stale settings as a conflict, not a silent overwrite", async () => {
    mocks.saveCatalog.mockRejectedValue(new ConflictError());
    expect((await putCatalog(request("/api/catalog", { catalog: defaultCatalog(), baseVersion: version }))).status).toBe(409);
  });
  it("reports category availability, validates ranges and rate limits", async () => {
    const response = await getInsights(request("/api/insights?from=2026-10-01&to=2026-10-04"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ categoriesAvailable: false, dashboard: { current: { received: 0 } } });
    expect((await getInsights(request("/api/insights?from=2026-10-04&to=2026-10-01"))).status).toBe(400);
    mocks.rate.mockReturnValue(false);
    expect((await getCatalog(request("/api/catalog"))).status).toBe(429);
    expect((await getInsights(request("/api/insights"))).status).toBe(429);
  });
  it("keeps the existing range response unchanged unless catalog is requested", async () => {
    expect(await (await getRange(request("/api/entries/range?from=2026-10-01&to=2026-10-04"))).json()).toEqual({ entries: [] });
    expect(mocks.readCatalog).not.toHaveBeenCalled();
    expect(await (await getRange(request("/api/entries/range?from=2026-10-01&to=2026-10-04&catalog=true"))).json()).toHaveProperty("catalog", defaultCatalog());
  });
});
