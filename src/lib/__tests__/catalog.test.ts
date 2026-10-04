import { describe, expect, it } from "vitest";
import { catalogSchema, defaultCatalog, canonicalName, suggestItems, prepareReportEntries, expandCategoryMappings } from "@/lib/catalog";
import { buildExpenseReport } from "@/lib/expense-report";
import { detailRows } from "@/lib/expense-export";

const catalog = {
  ...defaultCatalog(),
  items: [{ name: "ค่าเรียกรถ", aliases: ["เรียกรถ", "ค่ารถ"], favorite: true }],
};

describe("item catalog", () => {
  it("resolves confirmed aliases without changing unknown names", () => {
    expect(canonicalName(" ค่ารถ ", catalog.items)).toBe("ค่าเรียกรถ");
    expect(canonicalName("รถพนักงาน", catalog.items)).toBe("รถพนักงาน");
  });
  it("suggests aliases and similar names, never silently merges", () => {
    expect(suggestItems("ค่ารถ", catalog.items, ["ค่าเรียกรถ"])[0]?.name).toBe("ค่าเรียกรถ");
    expect(suggestItems("เรียกรถ", [], ["ค่าเรียกรถ"])[0]?.name).toBe("ค่าเรียกรถ");
    expect(suggestItems("น้ำแข็ง", catalog.items, ["ค่าเรียกรถ"])).toEqual([]);
  });
  it("rejects ambiguous aliases and invalid recurring entries", () => {
    expect(catalogSchema.safeParse({ ...catalog, items: [...catalog.items, { name: "ค่ารถ", aliases: [], favorite: false }] }).success).toBe(false);
    expect(catalogSchema.safeParse({ ...catalog, recurring: [{ type: "expense", description: "", channel: "โอน", amount: "" }] }).success).toBe(false);
    expect(catalogSchema.safeParse({ ...catalog, recurring: [{ type: "expense", description: "ค่าเรียกรถ", channel: "โอน", amount: "1.234" }] }).success).toBe(false);
  });
  it("keeps raw history and category exclusions while grouping report names", () => {
    const raw = [{ date: "2026-10-01", description: "ค่ารถ", amount: -100, channel: "โอน", gross: null }];
    const result = prepareReportEntries(raw, catalog);
    expect(result[0]?.description).toBe("ค่าเรียกรถ");
    expect(result[0]?.originalDescription).toBe("ค่ารถ");
    expect(raw[0]?.description).toBe("ค่ารถ");
  });
  it("groups historical aliases consistently in category report and export", () => {
    const raw = [
      { date: "2026-10-01", description: "ค่ารถ", amount: -100 },
      { date: "2026-10-02", description: "เรียกรถ", amount: -200 },
    ];
    const mappings = expandCategoryMappings([{ item: "ค่ารถ", category: "เดินทาง", counted: true, note: "" }], catalog);
    const entries = prepareReportEntries(raw, catalog);
    const report = buildExpenseReport(entries, mappings, "2026-10-01", "2026-10-31");
    expect(report.categoryTotals).toEqual([300]);
    expect(report.uncategorizedTotal.amount).toBe(0);
    expect(detailRows(entries, mappings, "2026-10-01", "2026-10-31").every(r => r.description === "ค่าเรียกรถ" && r.category === "เดินทาง")).toBe(true);
    const excluded = expandCategoryMappings([{ item: "ค่ารถ", category: "ไม่นับ", counted: false, note: "" }], catalog);
    expect(buildExpenseReport(entries, excluded, "2026-10-01", "2026-10-31").notCountedTotal).toBe(300);
  });
});
