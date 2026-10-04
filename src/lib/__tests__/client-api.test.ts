import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), fetch: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: mocks.signOut }));

const denied = () => Response.json({
  error: { code: "SHEET_ACCESS", message: "Sheet access denied" },
}, { status: 403 });

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.signOut.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe("sheet access reauthentication", () => {
  it("signs out and redirects to login without consuming the response body", async () => {
    const { request } = await import("@/lib/client-api");
    const response = denied();
    const init = { method: "POST", body: "{}" };
    mocks.fetch.mockResolvedValue(response);
    expect(await request("/api/entries", init)).toBe(response);
    expect(mocks.fetch).toHaveBeenCalledWith("/api/entries", init);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith({
      redirectTo: "/login?reason=sheet-access",
    });
    expect(await response.json()).toMatchObject({ error: { code: "SHEET_ACCESS" } });
  });

  it("uses the same handling for JSON requests", async () => {
    const { requestJson } = await import("@/lib/client-api");
    mocks.fetch.mockResolvedValue(denied());
    await expect(requestJson("/api/catalog")).rejects.toThrow("Sheet access denied");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("deduplicates sign-out when multiple API calls fail", async () => {
    const { request } = await import("@/lib/client-api");
    let complete!: () => void;
    mocks.signOut.mockReturnValue(new Promise<void>((resolve) => { complete = resolve; }));
    mocks.fetch.mockImplementation(async () => denied());
    const calls = Promise.all([
      request("/api/entries"), request("/api/expense-categories"), request("/api/catalog"),
    ]);
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    complete();
    await calls;
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    [403, { error: { code: "FORBIDDEN", message: "Forbidden" } }],
    [409, { error: { code: "CONFLICT", message: "Conflict" } }],
    [500, { error: { code: "SHEET_NAME_MISMATCH", message: "Missing tab" } }],
    [200, { entries: [] }],
    [403, { error: null }],
  ])("does not sign out for unrelated responses (%s)", async (status, body) => {
    const { request } = await import("@/lib/client-api");
    mocks.fetch.mockResolvedValue(Response.json(body, { status }));
    const response = await request("/api/entries");
    expect(await response.json()).toEqual(body);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("preserves non-JSON errors", async () => {
    const { request } = await import("@/lib/client-api");
    mocks.fetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    expect(await (await request("/api/entries")).text()).toBe("Forbidden");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("surfaces a failed sign-out and allows retry", async () => {
    const { request } = await import("@/lib/client-api");
    mocks.fetch.mockImplementation(async () => denied());
    mocks.signOut.mockRejectedValueOnce(new Error("Sign-out failed"));
    await expect(request("/api/entries")).rejects.toThrow("Sign-out failed");
    await request("/api/entries");
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
  });
});
