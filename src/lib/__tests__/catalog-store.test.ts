import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCatalog } from "@/lib/catalog";

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(), values: vi.fn(), update: vi.fn(), batch: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: { SHEET_ID: "test-sheet", SHEET_NAME: "ledger" } }));
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    sheets: () => ({ spreadsheets: {
      get: mocks.metadata, batchUpdate: mocks.batch,
      values: { get: mocks.values, update: mocks.update },
    } }),
  },
}));
import { readCatalog, saveCatalog, ConflictError } from "@/lib/sheets";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.metadata.mockResolvedValue({ data: { sheets: [] } });
  mocks.update.mockResolvedValue({});
  mocks.batch.mockResolvedValue({});
});
describe("catalog Sheets persistence", () => {
  it("reads defaults without creating or changing any sheet", async () => {
    expect((await readCatalog("test")).catalog).toEqual(defaultCatalog());
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("creates only the settings tab with data in one atomic batch", async () => {
    const { version } = await readCatalog("test");
    await saveCatalog("test", defaultCatalog(), version);
    const requests = mocks.batch.mock.calls[0]?.[0].requestBody.requests;
    expect(requests).toHaveLength(2);
    expect(requests[0].addSheet.properties.title).toBe("ตั้งค่ารายการ");
    expect(requests[1].updateCells.start.sheetId).toBe(requests[0].addSheet.properties.sheetId);
    expect(JSON.parse(requests[1].updateCells.rows[1].values[0].userEnteredValue.stringValue)).toEqual(defaultCatalog());
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates A2 in the settings tab, not ledger rows, and persists aliases", async () => {
    mocks.metadata.mockResolvedValue({ data: { sheets: [{ properties: { title: "ตั้งค่ารายการ", sheetId: 4 } }] } });
    mocks.values.mockResolvedValue({ data: { values: [[JSON.stringify(defaultCatalog())]] } });
    const current = await readCatalog("test");
    const next = { ...current.catalog, items: [{ name: "ค่าเรียกรถ", aliases: ["ค่ารถ"], favorite: true }] };
    const saved = await saveCatalog("test", next, current.version);
    expect(saved.version).not.toBe(current.version);
    expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({ range: "'ตั้งค่ารายการ'!A2", valueInputOption: "RAW" });
    mocks.values.mockResolvedValue({ data: { values: [[JSON.stringify(next)]] } });
    expect(await readCatalog("test")).toEqual(saved);
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it("rejects stale versions and surfaces corruption instead of resetting settings", async () => {
    await expect(saveCatalog("test", defaultCatalog(), "0".repeat(64))).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.batch).not.toHaveBeenCalled();
    mocks.metadata.mockResolvedValue({ data: { sheets: [{ properties: { title: "ตั้งค่ารายการ", sheetId: 4 } }] } });
    mocks.values.mockResolvedValue({ data: { values: [["broken"]] } });
    await expect(readCatalog("test")).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
