import { describe, expect, it } from "vitest";
import {
  buildIncomeReport,
  classifyIncome,
  type IncomeEntry,
} from "@/lib/income-report";

const entry = (over: Partial<IncomeEntry> = {}): IncomeEntry => ({
  date: "2026-01-15",
  description: "ขายหน้าร้าน",
  amount: 100,
  channel: "โอน",
  ...over,
});

// ช่วง default ของหน้ารายงาน = ทั้งปี
const FROM = "2026-01-01";
const TO = "2026-12-31";
const build = (entries: IncomeEntry[], from = FROM, to = TO) =>
  buildIncomeReport(entries, from, to);

describe("classifyIncome — ลำดับ priority", () => {
  it("keyword โอนชนะ prefix หน้าร้าน: 'ขายหน้าร้าน true money' → โอน", () => {
    expect(classifyIncome("ขายหน้าร้าน true money", "สด")).toBe("transfer");
  });

  it("keyword เดลิ (รวมสะกดเพี้ยน) → เดลิ", () => {
    expect(classifyIncome("grab", "โอน")).toBe("delivery");
    expect(classifyIncome("ยอดขาย EGEST", "โอน")).toBe("delivery");
    expect(classifyIncome("โอนเข้า foodpand", "โอน")).toBe("delivery");
  });

  it("ขึ้นต้นขายหน้าร้าน (รวมสะกดเพี้ยน): channel สด/เงินสด → เงินสด, อื่น → โอน", () => {
    expect(classifyIncome("ขายหน้าร้าน", "สด")).toBe("cash");
    expect(classifyIncome("ขายหน้าร้าน", "เงินสด")).toBe("cash");
    expect(classifyIncome("ขายหน้าร้าน", "โอน")).toBe("transfer");
    expect(classifyIncome("ขานหน้าร้าน", "สด")).toBe("cash");
    expect(classifyIncome("ขายน้าร้าน", " เงินสด ")).toBe("cash");
  });

  it("ไม่เข้ากติกาใด → ยังไม่จัดประเภท", () => {
    expect(classifyIncome("ของแปลก", "โอน")).toBe("uncategorized");
  });
});

describe("buildIncomeReport — โอนคืนลูกค้า (refund)", () => {
  it("แถวติดลบหักออกจากช่องโอนถูกเดือน + บันทึกใน refund/refundTotal", () => {
    const r = build([
      entry({ date: "2026-04-10", description: "ขายหน้าร้าน", amount: 500 }),
      entry({ date: "2026-04-20", description: "โอนคืนลูกค้า", amount: -156 }),
    ]);
    expect(r.months[3]!.transfer).toBe(344);
    expect(r.months[3]!.refund).toBe(156);
    expect(r.months[3]!.total).toBe(344);
    expect(r.refundTotal).toBe(156);
    expect(r.transferTotal).toBe(344);
  });

  it("โอนคืนลูกค้าที่เผลอบันทึกเป็นบวก → ยังไม่จัดประเภท", () => {
    const r = build([entry({ description: "โอนคืนลูกค้า", amount: 50 })]);
    expect(r.uncategorizedItems).toEqual([
      { item: "โอนคืนลูกค้า", amount: 50, count: 1 },
    ]);
    expect(r.months[0]!.refund).toBe(0);
    expect(r.transferTotal).toBe(0);
  });

  it("ช่องโอนติดลบได้เมื่อ refund มากกว่ารายรับโอน — ห้าม clamp เป็น 0", () => {
    const r = build([
      entry({ description: "ขายหน้าร้าน", amount: 40 }),
      entry({ description: "โอนคืนลูกค้า", amount: -100 }),
    ]);
    expect(r.months[0]!.transfer).toBe(-60);
    expect(r.months[0]!.total).toBe(-60);
    expect(r.grandTotal).toBe(-60);
  });
});

describe("buildIncomeReport — แถวติดลบทั่วไป", () => {
  it("รายจ่าย (รวม lineman ติดลบ) ไม่แตะคอลัมน์รายได้ใดเลย", () => {
    const r = build([
      entry({ description: "lineman", amount: -120 }),
      entry({ description: "Makro", amount: -999 }),
      entry({ description: "grab", amount: 300 }),
    ]);
    expect(r.months[0]!.delivery).toBe(300);
    expect(r.months[0]!.transfer).toBe(0);
    expect(r.months[0]!.cash).toBe(0);
    expect(r.uncategorizedTotal).toEqual({ amount: 0, count: 0 });
    expect(r.grandTotal).toBe(300);
  });
});

describe("buildIncomeReport — ยังไม่จัดประเภท", () => {
  it("แถวบวกที่ไม่ match ทุกแถวถูกนับครบ และรวมใน total/grandTotal", () => {
    const r = build([
      entry({ description: "ของแปลก", amount: 10 }),
      entry({ description: "ของแปลก", amount: 20, date: "2026-03-05" }),
      entry({ description: "อีกอย่าง", amount: 5 }),
      entry({ description: "ขายหน้าร้าน", amount: 100, channel: "สด" }),
    ]);
    expect(r.uncategorizedTotal).toEqual({ amount: 35, count: 3 });
    expect(r.months[0]!.uncategorized).toEqual({ amount: 15, count: 2 });
    expect(r.months[2]!.uncategorized).toEqual({ amount: 20, count: 1 });
    expect(r.uncategorizedItems).toEqual([
      { item: "ของแปลก", amount: 30, count: 2 },
      { item: "อีกอย่าง", amount: 5, count: 1 },
    ]);
    expect(r.months[0]!.total).toBe(115);
    expect(r.grandTotal).toBe(135);
  });
});

describe("buildIncomeReport — ปัดเศษ เดือนว่าง และการกรองช่วง", () => {
  it("ปัดด้วย round2: 0.1 + 0.2 ต้องได้ 0.3 เป๊ะ", () => {
    const r = build([
      entry({ description: "grab", amount: 0.1 }),
      entry({ description: "grab", amount: 0.2 }),
    ]);
    expect(r.months[0]!.delivery).toBe(0.3);
    expect(r.grandTotal).toBe(0.3);
  });

  it("ช่วงทั้งปีได้ 12 เดือนเสมอ เดือนไม่มีข้อมูล = 0 ทุกช่อง", () => {
    const r = build([entry({ date: "2026-07-01", channel: "สด" })]);
    expect(r.months).toHaveLength(12);
    for (const [i, m] of r.months.entries()) {
      if (i === 6) continue;
      expect(m.transfer).toBe(0);
      expect(m.delivery).toBe(0);
      expect(m.cash).toBe(0);
      expect(m.uncategorized).toEqual({ amount: 0, count: 0 });
      expect(m.refund).toBe(0);
      expect(m.total).toBe(0);
    }
    expect(r.months[6]!.cash).toBe(100);
    expect(r.months[6]!.total).toBe(100);
  });

  it("นับเฉพาะแถวในช่วง [from, to] (ขอบเขตรวมปลายทั้งสองด้าน)", () => {
    const r = build(
      [
        entry({ date: "2026-01-31", amount: 70, channel: "สด" }),
        entry({ date: "2026-02-01", amount: 30, channel: "สด" }), // นอกช่วง
        entry({ date: "2025-12-31", amount: 99, channel: "สด" }), // นอกช่วง
      ],
      "2026-01-01",
      "2026-01-31",
    );
    expect(r.months).toHaveLength(1);
    expect(r.grandTotal).toBe(70);
  });

  it("ช่วงคร่อมปี: เดือนเรียงตามเวลา ป้ายมีปีกำกับ ยอดลงถูกเดือน", () => {
    const r = build(
      [
        entry({ date: "2025-11-15", description: "grab", amount: 10 }),
        entry({ date: "2026-02-15", description: "ขายหน้าร้าน", amount: 20, channel: "สด" }),
      ],
      "2025-11-01",
      "2026-02-28",
    );
    expect(r.months.map((m) => m.label)).toEqual([
      "พ.ย. 2025", "ธ.ค. 2025", "ม.ค. 2026", "ก.พ. 2026",
    ]);
    expect(r.months[0]!.delivery).toBe(10);
    expect(r.months[3]!.cash).toBe(20);
    expect(r.grandTotal).toBe(30);
  });
});
