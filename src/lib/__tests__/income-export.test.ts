import { describe, expect, it } from "vitest";
import {
  INCOME_DETAIL_SHEET,
  INCOME_SUMMARY_SHEET,
  buildIncomeWorkbook,
  incomeDetailRows,
} from "@/lib/income-export";
import {
  CASH_LABEL,
  DELIVERY_LABEL,
  INCOME_UNCATEGORIZED_LABEL,
  TRANSFER_LABEL,
  type IncomeEntry,
} from "@/lib/income-report";

const entry = (over: Partial<IncomeEntry> = {}): IncomeEntry => ({
  date: "2026-01-15",
  description: "ขายหน้าร้าน",
  amount: 100,
  channel: "โอน",
  ...over,
});

describe("incomeDetailRows — ชีตรายละเอียด", () => {
  it("กรองช่วง เรียงตามวันที่ ป้ายประเภทตามกติกา แถวลบทั่วไปไม่ลงชีต", () => {
    const rows = incomeDetailRows(
      [
        entry({ date: "2026-03-01", description: "grab", amount: 20 }),
        entry({ date: "2026-01-05", amount: 10, channel: "สด" }),
        entry({ date: "2025-12-31", amount: 99 }), // นอกช่วง
        entry({ date: "2026-02-01", description: "lineman", amount: -50 }), // รายจ่าย
        entry({ date: "2026-02-10", description: "ของแปลก", amount: 5 }),
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-01-05", "2026-02-10", "2026-03-01"]);
    expect(rows.map((r) => r.category)).toEqual([
      CASH_LABEL,
      INCOME_UNCATEGORIZED_LABEL,
      DELIVERY_LABEL,
    ]);
  });

  it("โอนคืนลูกค้า (ลบ) ลงใต้ป้ายช่องโอนด้วยจำนวนเงินติดลบ — SUMIFS หักให้เอง", () => {
    const rows = incomeDetailRows(
      [entry({ description: "โอนคืนลูกค้า", amount: -156 })],
      "2026-01-01",
      "2026-12-31",
    );
    expect(rows).toEqual([
      {
        category: TRANSFER_LABEL,
        date: "2026-01-15",
        description: "โอนคืนลูกค้า",
        amount: -156,
        channel: "โอน",
      },
    ]);
  });
});

describe("buildIncomeWorkbook — ไฟล์ .xlsx", () => {
  const bytes = buildIncomeWorkbook(
    [
      entry({ channel: "สด" }),
      entry({ description: "grab", amount: 300 }),
      entry({ description: "ของแปลก", amount: 5 }),
      entry({ description: "โอนคืนลูกค้า", amount: -7 }),
    ],
    "2026-01-01",
    "2026-12-31",
  );
  // entry ทุกไฟล์เป็น STORED (ไม่บีบอัด) → decode ทั้งก้อนแล้วค้นข้อความ XML ได้ตรง ๆ
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  it("เป็นไฟล์ zip (ขึ้นต้น PK) และมีส่วนประกอบ xlsx ครบ", () => {
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    for (const name of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/styles.xml",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("มีชื่อชีตทั้งสอง สูตร SUMIFS และสั่งคำนวณใหม่ตอนเปิดไฟล์", () => {
    expect(text).toContain(INCOME_SUMMARY_SHEET);
    expect(text).toContain(INCOME_DETAIL_SHEET);
    expect(text).toContain("SUMIFS(");
    expect(text).toContain('fullCalcOnLoad="1"');
  });

  it("หัวคอลัมน์ครบ (รวมยังไม่จัดประเภท) และแถว refund เป็นค่าลบในชีตรายละเอียด", () => {
    expect(text).toContain(TRANSFER_LABEL);
    expect(text).toContain(DELIVERY_LABEL);
    expect(text).toContain(CASH_LABEL);
    expect(text).toContain(INCOME_UNCATEGORIZED_LABEL);
    expect(text).toContain("รวมทั้งช่วง");
    expect(text).toContain("<v>-7</v>");
    // & ในสูตรต้อง escape เป็น &amp; (ไฟล์ต้องเป็น XML ที่ valid)
    expect(text).toContain("&amp;DATE(2026");
    expect(text).not.toMatch(/<f>[^<]*"&DATE/);
  });

  it("ไม่มีรายรับยังไม่จัดประเภท → ไม่เกิดคอลัมน์นั้น", () => {
    const clean = new TextDecoder().decode(
      buildIncomeWorkbook(
        [entry({ channel: "สด" })],
        "2026-01-01",
        "2026-12-31",
      ),
    );
    // sheet1 (สรุป) ต้องไม่มีหัวคอลัมน์ยังไม่จัดประเภท — เช็คทั้งไฟล์ได้เพราะ
    // ชีตรายละเอียดก็ไม่มีแถว uncategorized เช่นกัน
    expect(clean).not.toContain(INCOME_UNCATEGORIZED_LABEL);
  });
});
