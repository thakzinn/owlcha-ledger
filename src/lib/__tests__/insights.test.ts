import { describe, expect, it } from "vitest";
import { buildDashboard, findAnomalies, monthWindow } from "@/lib/insights";
import { defaultCatalog } from "@/lib/catalog";

const row = (date: string, description: string, amount: number, gross: number | null = null) =>
  ({ date, description, amount, channel: "โอน", gross });

describe("owner insights", () => {
  it("compares elapsed days across year boundaries and shorter months", () => {
    expect(monthWindow("2026-01-04")).toMatchObject({ previousStart: "2025-12-01", comparableEnd: "2025-12-04" });
    expect(monthWindow("2024-03-31")).toMatchObject({ previousEnd: "2024-02-29", comparableEnd: "2024-02-29" });
  });
  it("separates real money from gross sales and avoids invented delivery gross", () => {
    const result = buildDashboard([
      row("2026-10-01", "grab", 679, 1000),
      row("2026-10-01", "lineman", 100),
      row("2026-10-01", "น้ำแข็ง", -50),
      row("2026-09-01", "ขายหน้าร้าน", 500),
      row("2026-10-05", "ขายหน้าร้าน", 999),
    ], [], "2026-10-04");
    expect(result.current.received).toBe(779);
    expect(result.current.balance).toBe(729);
    expect(result.current.knownGross).toBe(1000);
    expect(result.current.missingGross).toBe(1);
    expect(result.current.fees).toBe(321);
    expect(result.previous.received).toBe(500);
  });
  it("flags missing days only within the requested elapsed range", () => {
    const issues = findAnomalies([row("2026-10-02", "น้ำแข็ง", -20)], [], defaultCatalog(), "2026-10-01", "2026-10-05", "2026-10-03");
    expect(issues.filter(i => i.kind === "missing-day").map(i => i.date)).toEqual(["2026-10-01", "2026-10-03"]);
  });
  it("routes uncategorized income and expenses to their own reports", () => {
    const issues = findAnomalies([
      row("2026-10-01", "รายการไม่ทราบประเภท", 50),
      row("2026-10-01", "ค่าเรียกรถ", -20),
    ], [], defaultCatalog(), "2026-10-01", "2026-10-01", "2026-10-04");
    expect(issues.filter(i => i.kind === "uncategorized").map(i => i.report)).toEqual(["income", "expenses"]);
  });
  it("flags duplicates, zero, unnamed, uncategorized, aliases and unknown delivery gross without altering data", () => {
    const catalog = { ...defaultCatalog(), items: [{ name: "ค่าเรียกรถ", aliases: ["ค่ารถ"], favorite: false }] };
    const entries = [
      row("2026-10-01", "ค่ารถ", -50), row("2026-10-01", "ค่ารถ", -50),
      row("2026-10-01", "", 0), row("2026-10-01", "grab", 50),
      row("2026-10-01", "lineman", 100, 80),
    ];
    const issues = findAnomalies(entries, [], catalog, "2026-10-01", "2026-10-01", "2026-10-04");
    for (const kind of ["duplicate", "zero", "unnamed", "uncategorized", "alias", "estimated", "gross-invalid"]) {
      expect(issues.some(i => i.kind === kind)).toBe(true);
    }
    expect(entries[0]?.description).toBe("ค่ารถ");
  });
});
