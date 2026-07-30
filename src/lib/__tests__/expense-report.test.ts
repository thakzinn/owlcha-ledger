import { describe, expect, it } from "vitest";
import {
  buildExpenseReport,
  monthsInRange,
  type CategoryMappingInput,
  type ExpenseEntry,
} from "@/lib/expense-report";

const entry = (over: Partial<ExpenseEntry> = {}): ExpenseEntry => ({
  date: "2026-01-15",
  description: "Makro",
  amount: -100,
  ...over,
});

const mapping = (over: Partial<CategoryMappingInput> = {}): CategoryMappingInput => ({
  category: "Makro",
  item: "Makro",
  counted: true,
  note: "",
  ...over,
});

// ช่วง default ของหน้ารายงาน = ทั้งปี
const FROM = "2026-01-01";
const TO = "2026-12-31";
const build = (
  entries: ExpenseEntry[],
  mappings: CategoryMappingInput[],
  from = FROM,
  to = TO,
) => buildExpenseReport(entries, mappings, from, to);

describe("buildExpenseReport — การจับคู่รายการ", () => {
  it("จับคู่แบบ exact หลัง trim ทั้งสองฝั่ง", () => {
    const r = build([entry({ description: " Makro " })], [mapping({ item: " Makro " })]);
    expect(r.months[0]!.cells[0]).toBe(100);
    expect(r.uncategorizedTotal.count).toBe(0);
  });

  it("case-sensitive: ตัวพิมพ์ต่างกันถือเป็นคนละรายการ", () => {
    const r = build([entry({ description: "makro" })], [mapping({ item: "Makro" })]);
    expect(r.months[0]!.cells[0]).toBe(0);
    expect(r.uncategorizedItems).toEqual([{ item: "makro", amount: 100, count: 1 }]);
  });

  it("ชื่อซ้ำหลายแถว: ใช้แถวบนสุด และรายงานใน duplicateItems", () => {
    const r = build(
      [entry({ description: "แก้ว", amount: -50 })],
      [
        mapping({ category: "OWL", item: "แก้ว" }),
        mapping({ category: "บรรจุภัณฑ์", item: "แก้ว" }),
      ],
    );
    expect(r.categories).toEqual(["OWL"]); // หมวดที่มีเฉพาะแถวซ้ำ (แพ้ first-wins) ไม่เกิดคอลัมน์
    expect(r.months[0]!.cells[0]).toBe(50);
    expect(r.duplicateItems).toEqual(["แก้ว"]);
  });

  it("แถวบวก (รายรับ) ไม่ถูกนับเลยแม้ชื่อตรง mapping", () => {
    const r = build([entry({ amount: 500 }), entry({ amount: -100 })], [mapping()]);
    expect(r.grandTotal).toBe(100);
    expect(r.months[0]!.cells[0]).toBe(100);
  });
});

describe("buildExpenseReport — นับเป็นค่าใช้จ่าย = FALSE", () => {
  const falseMapping = mapping({
    category: "หักจากรายได้",
    item: "โอนคืนลูกค้า",
    counted: false,
  });

  it("ไม่รวมในยอดหมวด/ยอดรวม แต่เข้า notCounted แยกต่างหาก", () => {
    const r = build(
      [
        entry({ description: "โอนคืนลูกค้า", amount: -156 }),
        entry({ description: "Makro", amount: -100 }),
      ],
      [mapping(), falseMapping],
    );
    expect(r.grandTotal).toBe(100);
    expect(r.categoryTotals).toEqual([100]);
    expect(r.months[0]!.notCounted).toBe(156);
    expect(r.notCountedTotal).toBe(156);
    expect(r.uncategorizedTotal.count).toBe(0);
  });

  it("หมวดที่มีแต่แถว counted=false ไม่เกิดคอลัมน์", () => {
    const r = build([], [falseMapping]);
    expect(r.categories).toEqual([]);
  });
});

describe("buildExpenseReport — ยังไม่จัดหมวด", () => {
  it("แถวติดลบที่ไม่ match ทุกแถวถูกนับครบ (ยอด + จำนวนรายการ)", () => {
    const r = build(
      [
        entry({ description: "ของแปลก", amount: -10 }),
        entry({ description: "ของแปลก", amount: -20, date: "2026-03-05" }),
        entry({ description: "อีกอย่าง", amount: -5 }),
      ],
      [mapping()],
    );
    expect(r.uncategorizedTotal).toEqual({ amount: 35, count: 3 });
    expect(r.months[0]!.uncategorized).toEqual({ amount: 15, count: 2 });
    expect(r.months[2]!.uncategorized).toEqual({ amount: 20, count: 1 });
    expect(r.uncategorizedItems).toEqual([
      { item: "ของแปลก", amount: 30, count: 2 },
      { item: "อีกอย่าง", amount: 5, count: 1 },
    ]);
  });

  it("ยอดยังไม่จัดหมวดรวมอยู่ใน total ของเดือนและ grandTotal", () => {
    const r = build(
      [entry({ description: "ไม่มีในแท็บ", amount: -40 }), entry({ amount: -60 })],
      [mapping()],
    );
    expect(r.months[0]!.total).toBe(100);
    expect(r.grandTotal).toBe(100);
  });
});

describe("buildExpenseReport — ปัดเศษและเดือนว่าง", () => {
  it("ปัดด้วย round2: 0.1 + 0.2 ต้องได้ 0.3 เป๊ะ", () => {
    const r = build([entry({ amount: -0.1 }), entry({ amount: -0.2 })], [mapping()]);
    expect(r.months[0]!.cells[0]).toBe(0.3);
    expect(r.grandTotal).toBe(0.3);
  });

  it("เศษ float สะสมหลายรายการยังปัดถูก (ระดับเซลล์)", () => {
    const amounts = [-2.055, -1.005, -0.615]; // ค่าที่ float แทนไม่ตรงเป๊ะ
    const r = build(
      amounts.map((amount) => entry({ amount })),
      [mapping()],
    );
    expect(r.months[0]!.cells[0]).toBe(3.68); // 2.055+1.005+0.615 = 3.675 → half-up
  });

  it("ช่วงทั้งปีได้ 12 เดือนเสมอ เดือนไม่มีข้อมูล = 0 ทั้งแถว", () => {
    const r = build([entry({ date: "2026-07-01" })], [mapping()]);
    expect(r.months).toHaveLength(12);
    expect(r.months.map((m) => m.label)).toEqual([
      "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
      "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
    ]);
    for (const [i, m] of r.months.entries()) {
      if (i === 6) continue;
      expect(m.total).toBe(0);
      expect(m.cells).toEqual([0]);
      expect(m.uncategorized).toEqual({ amount: 0, count: 0 });
      expect(m.notCounted).toBe(0);
    }
    expect(r.months[6]!.total).toBe(100);
  });
});

describe("buildExpenseReport — ลำดับคอลัมน์และการกรองช่วง", () => {
  it("ลำดับหมวด = ปรากฏครั้งแรกในแท็บ บน→ล่าง", () => {
    const r = build(
      [],
      [
        mapping({ category: "OWL", item: "แก้ว" }),
        mapping({ category: "ค่าเช่า", item: "ค่าเช่าตลาด" }),
        mapping({ category: "OWL", item: "ชีส1" }),
        mapping({ category: "ค่าจ้าง", item: "ค่าจ้างพนักงาน" }),
      ],
    );
    expect(r.categories).toEqual(["OWL", "ค่าเช่า", "ค่าจ้าง"]);
  });

  it("นับเฉพาะแถวในช่วง [from, to] (ขอบเขตรวมปลายทั้งสองด้าน)", () => {
    const r = build(
      [
        entry({ date: "2026-01-31", amount: -70 }),
        entry({ date: "2026-02-01", amount: -30 }), // นอกช่วง
        entry({ date: "2025-12-31", amount: -99 }), // นอกช่วง
      ],
      [mapping()],
      "2026-01-01",
      "2026-01-31",
    );
    expect(r.months).toHaveLength(1);
    expect(r.grandTotal).toBe(70);
  });

  it("ช่วงคร่อมปี: เดือนเรียงตามเวลาและป้ายมีปีกำกับ", () => {
    const r = build(
      [
        entry({ date: "2025-12-15", amount: -10 }),
        entry({ date: "2026-01-15", amount: -20 }),
      ],
      [mapping()],
      "2025-12-01",
      "2026-01-31",
    );
    expect(r.months.map((m) => m.label)).toEqual(["ธ.ค. 2025", "ม.ค. 2026"]);
    expect(r.months[0]!.cells[0]).toBe(10);
    expect(r.months[1]!.cells[0]).toBe(20);
    expect(r.grandTotal).toBe(30);
  });
});

describe("monthsInRange", () => {
  it("ช่วงกลางเดือนนับเดือนที่คาบเกี่ยวครบ", () => {
    expect(monthsInRange("2026-03-15", "2026-05-02").map((m) => m.month)).toEqual([
      3, 4, 5,
    ]);
  });
  it("ปีเดียวไม่ใส่ปีในป้าย คร่อมปีใส่ปีทุกเดือน", () => {
    expect(monthsInRange("2026-01-01", "2026-02-01")[0]!.label).toBe("ม.ค.");
    expect(monthsInRange("2025-12-01", "2026-01-01")[0]!.label).toBe("ธ.ค. 2025");
  });
});
